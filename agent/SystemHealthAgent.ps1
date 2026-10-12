param([string]$ConfigPath = "$PSScriptRoot\config.json")
$ErrorActionPreference = 'Stop'
$config = Get-Content $ConfigPath | ConvertFrom-Json
$script:PreviousNetworkSample = $null

function Get-ResourceStatus([Nullable[double]]$Value) {
    if ($null -eq $Value) { return 'UNKNOWN' }
    if ($Value -ge 90) { return 'CRITICAL' }
    if ($Value -ge 80) { return 'WARNING' }
    return 'HEALTHY'
}

function Get-CpuTemperature {
    foreach ($namespace in @('root/OpenHardwareMonitor', 'root/LibreHardwareMonitor')) {
        try {
            $sensor = Get-CimInstance -Namespace $namespace -ClassName Sensor -ErrorAction Stop |
                Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU|Core' } |
                Select-Object -First 1
            if ($null -ne $sensor -and $sensor.Value -ge 0 -and $sensor.Value -le 150) {
                return [math]::Round([double]$sensor.Value, 1)
            }
        } catch {}
    }
    return 'N/A'
}

function Get-AntivirusTelemetry {
    try {
        $defender = Get-MpComputerStatus -ErrorAction Stop
        $signatureDate = $defender.AntivirusSignatureLastUpdated
        $signatureAge = if ($signatureDate) { [math]::Max(0, [math]::Floor(((Get-Date) - $signatureDate).TotalDays)) } else { $null }
        return @{
            name = 'Microsoft Defender'
            product = 'Microsoft Defender'
            enabled = [bool]$defender.AntivirusEnabled
            realTimeProtection = [bool]$defender.RealTimeProtectionEnabled
            updated = if ($null -eq $signatureAge) { $null } else { $signatureAge -le 7 }
            definitionsUpToDate = if ($null -eq $signatureAge) { $null } else { $signatureAge -le 7 }
            signatureVersion = [string]$defender.AntivirusSignatureVersion
            lastDefinitionUpdate = if ($signatureDate) { $signatureDate.ToUniversalTime().ToString('o') } else { $null }
            definitionAgeDays = $signatureAge
        }
    } catch {
        try {
            $product = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop |
                Select-Object -First 1
            if ($product) {
                return @{ name = $product.displayName; product = $product.displayName; enabled = $null; realTimeProtection = $null; updated = $null; definitionsUpToDate = $null; signatureVersion = $null; lastDefinitionUpdate = $null; definitionAgeDays = $null }
            }
        } catch {}
    }
    return @{ name = 'Unknown'; product = 'Unknown'; enabled = $null; realTimeProtection = $null; updated = $null; definitionsUpToDate = $null; signatureVersion = $null; lastDefinitionUpdate = $null; definitionAgeDays = $null }
}

function Get-FirewallTelemetry {
    $profiles = @{}
    try {
        $available = @(Get-NetFirewallProfile -ErrorAction Stop)
        foreach ($name in @('Domain', 'Private', 'Public')) {
            $profile = $available | Where-Object Name -eq $name | Select-Object -First 1
            $profiles[$name.ToLowerInvariant()] = if ($profile) { [bool]$profile.Enabled } else { $null }
        }
    } catch {
        $profiles = @{ domain = $null; private = $null; public = $null }
    }
    $enabledProfiles = @($profiles.Values | Where-Object { $_ -eq $true }).Count
    $knownProfiles = @($profiles.Values | Where-Object { $null -ne $_ }).Count
    $profiles['overallStatus'] = if ($knownProfiles -lt 3) { 'WARNING' } elseif ($enabledProfiles -eq 3) { 'HEALTHY' } elseif ($enabledProfiles -eq 0) { 'CRITICAL' } else { 'WARNING' }
    return $profiles
}

function Get-PingStatistics([string]$Target) {
    if (-not $Target) { return $null }
    $ping = New-Object System.Net.NetworkInformation.Ping
    $samples = @()
    try {
        1..3 | ForEach-Object {
            try {
                $result = $ping.Send($Target, 900)
                if ($result.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                    $samples += [double]$result.RoundtripTime
                }
            } catch {}
        }
    } finally {
        $ping.Dispose()
    }
    return @{
        reachable = ($samples.Count -gt 0)
        latencyMs = if ($samples.Count) { [math]::Round(($samples | Measure-Object -Average).Average, 1) } else { $null }
        packetLossPercent = [math]::Round((1 - ($samples.Count / 3)) * 100, 1)
    }
}

function Test-DnsConnectivity([string]$Server) {
    if (-not $Server) { return $false }
    try {
        $null = Resolve-DnsName -Name 'www.msftconnecttest.com' -Server $Server -DnsOnly -QuickTimeout -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Test-InternetConnectivity {
    $client = New-Object System.Net.Sockets.TcpClient
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $connect = $client.ConnectAsync('www.msftconnecttest.com', 80)
        if (-not $connect.Wait(1800)) { return $null }
        if (-not $client.Connected) { return $null }
        $watch.Stop()
        return [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
    } catch {
        return $null
    } finally {
        $client.Dispose()
    }
}

function Convert-LinkSpeedToMbps([string]$Value) {
    if ($Value -match '^\s*([\d.]+)\s*(Kbps|Mbps|Gbps)') {
        $speed = [double]$Matches[1]
        switch ($Matches[2]) {
            'Kbps' { return $speed / 1000 }
            'Gbps' { return $speed * 1000 }
            default { return $speed }
        }
    }
    return $null
}

function Get-NetworkTelemetry {
    $adapters = @()
    $adapterConfigs = @(Get-NetIPConfiguration -All -ErrorAction SilentlyContinue)
    $netAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)
    foreach ($adapter in $netAdapters) {
        $configuration = $adapterConfigs | Where-Object InterfaceIndex -eq $adapter.ifIndex | Select-Object -First 1
        $ipv4 = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress)
        $ipv6 = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -ne '::1' -and $_.IPAddress -notlike 'fe80:*' } | ForEach-Object IPAddress)
        $gateways = @($configuration.IPv4DefaultGateway | ForEach-Object NextHop)
        $dns = @($configuration.DnsServer.ServerAddresses | Where-Object { $_ })
        $adapters += @{
            name = $adapter.Name
            interfaceName = $adapter.Name
            adapterName = $adapter.InterfaceDescription
            description = $adapter.InterfaceDescription
            status = [string]$adapter.Status
            macAddress = $adapter.MacAddress
            ipv4 = $ipv4
            ipv6 = $ipv6
            linkSpeedMbps = Convert-LinkSpeedToMbps ([string]$adapter.LinkSpeed)
            gateway = $gateways | Select-Object -First 1
            dnsServers = $dns
            interfaceIndex = [int]$adapter.ifIndex
        }
    }

    $active = $adapters | Where-Object { $_.status -eq 'Up' -and $_.gateway } | Select-Object -First 1
    if (-not $active) { $active = $adapters | Where-Object status -eq 'Up' | Select-Object -First 1 }
    $gatewayStats = if ($active.gateway) { Get-PingStatistics ([string]$active.gateway) } else { $null }
    $dnsConnected = if ($active.dnsServers.Count) { Test-DnsConnectivity ([string]$active.dnsServers[0]) } else { $false }
    $internetLatency = if ($active) { Test-InternetConnectivity } else { $null }

    $traffic = $null
    if ($active) {
        try {
            $stats = Get-NetAdapterStatistics -Name $active.name -ErrorAction Stop
            $sampleTime = Get-Date
            $sent = [double]$stats.SentBytes
            $received = [double]$stats.ReceivedBytes
            $sentPackets = [double]$stats.SentUnicastPackets
            $receivedPackets = [double]$stats.ReceivedUnicastPackets
            $uploadRate = $null
            $downloadRate = $null
            if ($script:PreviousNetworkSample -and $script:PreviousNetworkSample.name -eq $active.name) {
                $elapsed = ($sampleTime - $script:PreviousNetworkSample.time).TotalSeconds
                if ($elapsed -gt 0) {
                    $uploadRate = [math]::Max(0, ($sent - $script:PreviousNetworkSample.sent) / $elapsed)
                    $downloadRate = [math]::Max(0, ($received - $script:PreviousNetworkSample.received) / $elapsed)
                }
            }
            $utilization = $null
            if ($null -ne $active.linkSpeedMbps -and $active.linkSpeedMbps -gt 0 -and $null -ne $uploadRate -and $null -ne $downloadRate) {
                $utilization = [math]::Min(100, [math]::Round((($uploadRate + $downloadRate) * 8 / ($active.linkSpeedMbps * 1000000)) * 100, 2))
            }
            $traffic = @{
                bytesSent = $sent
                bytesReceived = $received
                packetsSent = $sentPackets
                packetsReceived = $receivedPackets
                uploadBytesPerSecond = if ($null -eq $uploadRate) { $null } else { [math]::Round($uploadRate, 1) }
                downloadBytesPerSecond = if ($null -eq $downloadRate) { $null } else { [math]::Round($downloadRate, 1) }
                utilizationPercent = $utilization
            }
            $script:PreviousNetworkSample = @{ name = $active.name; time = $sampleTime; sent = $sent; received = $received }
        } catch { $traffic = $null }
    }

    $packetLoss = if ($gatewayStats) { $gatewayStats.packetLossPercent } else { $null }
    $status = 'HEALTHY'
    if (-not $active -or ($gatewayStats -and -not $gatewayStats.reachable)) {
        $status = 'CRITICAL'
    } elseif (-not $dnsConnected -or $null -eq $internetLatency -or ($gatewayStats.latencyMs -gt 150) -or ($packetLoss -gt 0) -or ($active.linkSpeedMbps -gt 0 -and $active.linkSpeedMbps -lt 100)) {
        $status = 'WARNING'
    }
    return @{
        adapters = $adapters
        activeAdapter = if ($active) { $active.name } else { $null }
        gateway = if ($active) { $active.gateway } else { $null }
        dns = if ($active) { @($active.dnsServers) } else { @() }
        connected = [bool]$active
        connectivity = @{
            lan = [bool]$active
            gateway = if ($gatewayStats) { $gatewayStats.reachable } else { $false }
            dns = $dnsConnected
            internet = ($null -ne $internetLatency)
        }
        latency = @{
            gatewayMs = if ($gatewayStats) { $gatewayStats.latencyMs } else { $null }
            internetMs = $internetLatency
            packetLossPercent = $packetLoss
        }
        packetLossPercent = $packetLoss
        traffic = $traffic
        linkSpeedMbps = if ($active) { $active.linkSpeedMbps } else { $null }
        status = $status
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-UpsTelemetry {
    $batteries = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
    $upsBattery = $batteries | Where-Object { $_.Name -match '(?i)\bUPS\b|uninterruptible|battery backup' } | Select-Object -First 1
    $pnpUps = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)\bUPS\b|uninterruptible|battery backup' } | Select-Object -First 1
    if (-not $upsBattery -and -not $pnpUps) {
        return @{
            detected = $false; available = $false; name = 'N/A'; manufacturer = 'N/A'; model = 'N/A'
            batteryStatus = 'N/A'; chargePercent = 'N/A'; remainingRuntimeSeconds = $null
            inputVoltage = 'N/A'; outputVoltage = 'N/A'; batteryVoltage = 'N/A'
            powerSource = 'N/A'; status = 'NOT_DETECTED'; batteryHealth = 'N/A'
            estimatedRuntimeSeconds = $null; updatedAt = [DateTime]::UtcNow.ToString('o')
        }
    }

    $charge = if ($upsBattery -and $upsBattery.EstimatedChargeRemaining -ge 0 -and $upsBattery.EstimatedChargeRemaining -le 100) { [int]$upsBattery.EstimatedChargeRemaining } else { 'N/A' }
    $runtime = if ($upsBattery -and $upsBattery.EstimatedRunTime -gt 0 -and $upsBattery.EstimatedRunTime -lt 10080) { [int]$upsBattery.EstimatedRunTime * 60 } else { $null }
    $batteryStatus = if ($upsBattery.Status) { [string]$upsBattery.Status } else { 'N/A' }
    $batteryState = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
    $powerSource = if ($batteryState -and $batteryState.PowerOnline) { 'AC' } elseif ($batteryState -and $batteryState.Discharging) { 'BATTERY' } else { 'N/A' }
    $status = 'UNKNOWN'
    if ($charge -is [int] -and $charge -le 20) { $status = 'LOW_BATTERY' }
    elseif ($powerSource -eq 'BATTERY') { $status = 'ON_BATTERY' }
    elseif ($powerSource -eq 'AC') { $status = 'ONLINE' }
    $voltage = if ($batteryState -and $batteryState.Voltage -gt 0) { [math]::Round([double]$batteryState.Voltage / 1000, 2) } else { 'N/A' }
    return @{
        detected = $true; available = [bool]$upsBattery
        name = if ($upsBattery) { [string]$upsBattery.Name } else { [string]$pnpUps.Name }
        manufacturer = if ($upsBattery) { [string]$upsBattery.Manufacturer } elseif ($pnpUps) { [string]$pnpUps.Manufacturer } else { 'N/A' }
        model = if ($upsBattery) { [string]$upsBattery.DeviceID } else { 'N/A' }
        batteryStatus = $batteryStatus; chargePercent = $charge
        remainingRuntimeSeconds = $runtime; estimatedRuntimeSeconds = $runtime
        inputVoltage = 'N/A'; outputVoltage = 'N/A'; batteryVoltage = $voltage
        powerSource = $powerSource; status = $status
        batteryHealth = if ($upsBattery -and $upsBattery.Status) { [string]$upsBattery.Status } else { 'N/A' }
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-HealthPayload {
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $cpu = $null
    try { $cpu = [math]::Round([double](Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples.CookedValue, 1) } catch {}
    $totalMemory = [double]$computer.TotalPhysicalMemory
    $freeMemory = [double]$os.FreePhysicalMemory * 1KB
    $memoryPercent = if ($totalMemory -gt 0) { [math]::Round((1 - ($freeMemory / $totalMemory)) * 100, 1) } else { $null }
    $disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue)
    $primaryDisk = $disks | Where-Object DeviceID -eq 'C:' | Select-Object -First 1
    if (-not $primaryDisk) { $primaryDisk = $disks | Select-Object -First 1 }
    $diskPercent = if ($primaryDisk -and $primaryDisk.Size -gt 0) { [math]::Round((1 - ($primaryDisk.FreeSpace / $primaryDisk.Size)) * 100, 1) } else { $null }
    $adapterTelemetry = Get-NetworkTelemetry
    $activeAdapter = Get-NetAdapter -Name $adapterTelemetry.activeAdapter -ErrorAction SilentlyContinue | Select-Object -First 1
    $firewall = Get-FirewallTelemetry
    $antivirus = Get-AntivirusTelemetry
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue | Select-Object -First 1
        @{
            port = [int]$_.LocalPort; protocol = 'TCP'; localAddress = [string]$_.LocalAddress
            process = if ($process) { $process.ProcessName } else { 'N/A' }
            pid = [int]$_.OwningProcess; state = [string]$_.State
        }
    })
    $network = $adapterTelemetry
    $ups = Get-UpsTelemetry
    $cpuUsage = if ($null -eq $cpu) { 'N/A' } else { $cpu }
    $memoryUsage = if ($null -eq $memoryPercent) { 'N/A' } else { $memoryPercent }
    $diskUsage = if ($null -eq $diskPercent) { 'N/A' } else { $diskPercent }
    $diskHealth = @()
    try { $diskHealth = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { @{ name = $_.FriendlyName; status = [string]$_.HealthStatus } }) } catch {}
    $usedMemory = if ($totalMemory -gt 0) { [math]::Max(0, $totalMemory - $freeMemory) } else { $null }
    $bootTime = $os.LastBootUpTime.ToUniversalTime().ToString('o')
    $osArchitecture = [string]$os.OSArchitecture
    $uptime = [math]::Max(0, [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds))
    $ipv4 = if ($activeAdapter -and $adapterTelemetry.adapters) {
        ($adapterTelemetry.adapters | Where-Object name -eq $activeAdapter.Name | Select-Object -First 1).ipv4 | Select-Object -First 1
    } else { $null }
    $systemHealth = @{
        cpu = @{ usagePercent = $cpuUsage; temperatureC = Get-CpuTemperature; status = Get-ResourceStatus $cpu }
        memory = @{ totalBytes = $totalMemory; usedBytes = $usedMemory; freeBytes = $freeMemory; usagePercent = $memoryUsage; status = Get-ResourceStatus $memoryPercent }
        disk = @{ volumes = @($disks | ForEach-Object {
            @{ drive = [string]$_.DeviceID; name = [string]$_.DeviceID; totalBytes = [double]$_.Size; freeBytes = [double]$_.FreeSpace; usedBytes = [math]::Max(0, [double]$_.Size - [double]$_.FreeSpace); usagePercent = if ($_.Size -gt 0) { [math]::Round((1 - ($_.FreeSpace / $_.Size)) * 100, 1) } else { 'N/A' } }
        }); health = $diskHealth; status = Get-ResourceStatus $diskPercent }
        operatingSystem = @{ hostname = $env:COMPUTERNAME; caption = [string]$os.Caption; name = [string]$os.Caption; version = [string]$os.Version; buildNumber = [string]$os.BuildNumber; architecture = $osArchitecture; uptimeSeconds = $uptime; lastBootTime = $bootTime; ip = $ipv4; agentVersion = '1.6.0' }
        security = @{ antivirus = $antivirus; firewall = $firewall }
        ports = $ports
    }
    $payload = [ordered]@{
        hostname = $env:COMPUTERNAME; ip = $ipv4; ipAddress = $ipv4
        mac = if ($activeAdapter) { $activeAdapter.MacAddress } else { $null }
        os = [string]$os.Caption; osVersion = [string]$os.Version
        osBuildNumber = [string]$os.BuildNumber; osArchitecture = $osArchitecture
        manufacturer = [string]$computer.Manufacturer; model = [string]$computer.Model
        totalMemoryBytes = $totalMemory; usedMemoryBytes = $usedMemory; freeMemoryBytes = $freeMemory
        diskFreeBytes = if ($primaryDisk) { [double]$primaryDisk.FreeSpace } else { $null }
        uptimeSeconds = $uptime; lastBootTime = $bootTime
        antivirus = $antivirus; firewall = $firewall; network = $network
        listeningPorts = $ports; agentVersion = '1.6.0'
        systemHealth = $systemHealth; ups = $ups
        heartbeat = @{ collectedAt = [DateTime]::UtcNow.ToString('o'); agentVersion = '1.6.0' }
    }
    if ($null -ne $cpu) { $payload.cpuPercent = $cpu }
    if ($null -ne $memoryPercent) { $payload.memoryPercent = $memoryPercent }
    if ($null -ne $diskPercent) { $payload.diskPercent = $diskPercent }
    return $payload
}

function Invoke-Heartbeat {
    $body = Get-HealthPayload | ConvertTo-Json -Depth 8
    Invoke-RestMethod -Uri "$($config.serverUrl)/api/heartbeat" -Method Post -Headers @{ 'X-Agent-Key' = $config.apiKey } -ContentType 'application/json' -Body $body
}

function Invoke-PendingCommands {
    $pending = Invoke-RestMethod -Uri "$($config.serverUrl)/api/agent/commands/poll" -Method Post -Headers @{ 'X-Agent-Key' = $config.apiKey } -ContentType 'application/json' -Body '{}'
    foreach ($command in $pending.commands) {
        $status = 'EXECUTED'
        $error = $null
        try {
            switch ($command.type) {
                'RESTART' { Restart-Computer -Force }
                'SHUTDOWN' { Stop-Computer -Force }
                default { throw "Unknown command rejected: $($command.type)" }
            }
        } catch {
            $status = 'FAILED'
            $error = $_.Exception.Message
        }
        Invoke-RestMethod -Uri "$($config.serverUrl)/api/agent/commands/$($command.id)/result" -Method Post -Headers @{ 'X-Agent-Key' = $config.apiKey } -ContentType 'application/json' -Body (@{ status = $status; error = $error } | ConvertTo-Json)
    }
}

while ($true) {
    try { Invoke-Heartbeat; Invoke-PendingCommands } catch { Write-Warning $_.Exception.Message }
    $interval = if ($config.intervalSeconds) { [int]$config.intervalSeconds } else { 30 }
    Start-Sleep -Seconds $interval
}