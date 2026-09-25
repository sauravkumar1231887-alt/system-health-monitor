param([string]$ConfigPath = "$PSScriptRoot\config.json")
$ErrorActionPreference = 'Stop'
$config = Get-Content $ConfigPath | ConvertFrom-Json

function Get-HealthPayload {
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $cpu = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples.CookedValue
    $totalMemory = [double]$computer.TotalPhysicalMemory
    $freeMemory = [double]$os.FreePhysicalMemory * 1KB
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $antivirus = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object -First 1
    $profiles = Get-NetFirewallProfile
    $adapter = Get-NetIPConfiguration | Where-Object { $_.IPv4Address } | Select-Object -First 1
    $ports = Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess -Unique
    [ordered]@{
        hostname = $env:COMPUTERNAME
        ip = $adapter.IPv4Address.IPAddress
        mac = (Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1).MacAddress
        os = $os.Caption
        osVersion = $os.Version
        manufacturer = $computer.Manufacturer
        model = $computer.Model
        cpuPercent = [math]::Round($cpu, 1)
        memoryPercent = [math]::Round((1 - ($freeMemory / $totalMemory)) * 100, 1)
        totalMemoryBytes = [math]::Round($totalMemory)
        usedMemoryBytes = [math]::Round($totalMemory - $freeMemory)
        freeMemoryBytes = [math]::Round($freeMemory)
        diskPercent = [math]::Round((1 - ($disk.FreeSpace / $disk.Size)) * 100, 1)
        diskFreeBytes = [int64]$disk.FreeSpace
        uptimeSeconds = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
        lastBootTime = $os.LastBootUpTime.ToUniversalTime().ToString('o')
        antivirus = @{ product = $antivirus.displayName; enabled = $true; realTimeProtection = $true; updated = $true; definitionAgeDays = 0 }
        firewall = @{ domain = ($profiles | Where-Object Name -eq 'Domain').Enabled; private = ($profiles | Where-Object Name -eq 'Private').Enabled; public = ($profiles | Where-Object Name -eq 'Public').Enabled }
        network = @{ gateway = $adapter.IPv4DefaultGateway.NextHop; dns = @($adapter.DnsServer.ServerAddresses); connected = $true }
        listeningPorts = @($ports | ForEach-Object { @{ port = $_.LocalPort; protocol = 'TCP'; state = 'LISTENING'; pid = $_.OwningProcess } })
        agentVersion = '1.5.0'
    }
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