param(
    [string]$ConfigPath = "$PSScriptRoot\..\..\agent\config.json"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ConfigPath)) {
    $ConfigPath = Join-Path $PSScriptRoot '..\..\agent\config.json'
}

$config = if (Test-Path $ConfigPath) { Get-Content $ConfigPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ serverUrl = 'http://127.0.0.1:8000'; agentKey = ''; intervalSeconds = 30 } }
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
            linkSpeedMbps = $null
            gateway = $gateways | Select-Object -First 1
            dnsServers = $dns
            interfaceIndex = [int]$adapter.ifIndex
        }
    }
    $active = $adapters | Where-Object { $_.status -eq 'Up' -and $_.gateway } | Select-Object -First 1
    if (-not $active) { $active = $adapters | Where-Object status -eq 'Up' | Select-Object -First 1 }
    return @{
        adapters = $adapters
        activeAdapter = if ($active) { $active.name } else { $null }
        gateway = if ($active) { $active.gateway } else { $null }
        dns = if ($active) { @($active.dnsServers) } else { @() }
        connected = [bool]$active
        connectivity = @{ lan = [bool]$active; gateway = [bool]$active; dns = [bool]($active -and $active.dnsServers.Count -gt 0); internet = $true }
        latency = @{ gatewayMs = $null; internetMs = $null; packetLossPercent = $null }
        packetLossPercent = $null
        traffic = @{ bytesSent = $null; bytesReceived = $null; packetsSent = $null; packetsReceived = $null; uploadBytesPerSecond = $null; downloadBytesPerSecond = $null; utilizationPercent = $null }
        linkSpeedMbps = $null
        status = if ($active) { 'HEALTHY' } else { 'CRITICAL' }
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-UpsTelemetry {
    return @{
        detected = $false
        available = $false
        name = 'N/A'
        manufacturer = 'N/A'
        model = 'N/A'
        batteryStatus = 'N/A'
        chargePercent = 'N/A'
        remainingRuntimeSeconds = $null
        inputVoltage = 'N/A'
        outputVoltage = 'N/A'
        batteryVoltage = 'N/A'
        powerSource = 'N/A'
        status = 'NOT_DETECTED'
        batteryHealth = 'N/A'
        estimatedRuntimeSeconds = $null
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
}

function Invoke-Heartbeat {
    $hostname = [System.Net.Dns]::GetHostName()
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $memory = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Select-Object -First 1
    $network = Get-NetworkTelemetry
    $payload = @{
        hostname = $hostname
        platform = 'windows'
        ipAddress = ((Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress)
        os = if ($os) { [string]$os.Caption } else { 'Windows' }
        osVersion = if ($os) { [string]$os.Version } else { 'N/A' }
        osBuildNumber = if ($os) { [string]$os.BuildNumber } else { 'N/A' }
        osArchitecture = if ($computer) { [string]$computer.SystemType } else { 'N/A' }
        agentVersion = '1.5.0'
        collectedAt = [DateTime]::UtcNow.ToString('o')
        cpu = @{ usagePercent = 0; count = if ($cpu) { 1 } else { 0 } }
        memory = @{ totalBytes = if ($memory) { [double]$memory.TotalVisibleMemorySize * 1024 } else { 0 }; usedBytes = 0; freeBytes = 0; usagePercent = 0 }
        disks = @(@{ mount = if ($disk) { [string]$disk.DeviceID } else { 'C:' }; totalBytes = if ($disk) { [double]$disk.Size } else { 0 }; usedBytes = if ($disk) { [double]$disk.Size - [double]$disk.FreeSpace } else { 0 }; freeBytes = if ($disk) { [double]$disk.FreeSpace } else { 0 }; usedPercent = 0 })
        uptime = @{ seconds = if ($os) { [int]$os.LastBootUpTime } else { 0 } }
        network = $network
        firewall = Get-FirewallTelemetry
        antivirus = Get-AntivirusTelemetry
        listeningPorts = @()
        systemHealth = @{ status = 'HEALTHY' }
        heartbeat = @{ collectedAt = [DateTime]::UtcNow.ToString('o') }
    }

    $serverUrl = if ($config.serverUrl) { [string]$config.serverUrl } else { 'http://127.0.0.1:8000' }
    $agentKey = if ($config.agentKey) { [string]$config.agentKey } else { $env:AGENT_KEY }
    if (-not $agentKey) { throw 'No agent key configured.' }
    $url = $serverUrl.TrimEnd('/') + '/api/heartbeat'
    $jsonBody = $payload | ConvertTo-Json -Depth 12
    Invoke-RestMethod -Uri $url -Method Post -Headers @{ 'X-Agent-Key' = $agentKey; 'Content-Type' = 'application/json' } -Body $jsonBody | Out-Null
}

try {
    Invoke-Heartbeat
} catch {
    Write-Error $_
    exit 1
}
