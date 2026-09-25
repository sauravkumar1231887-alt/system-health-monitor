param([string]$AgentPath = "$PSScriptRoot\SystemHealthAgent.ps1")
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AgentPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Seconds 30)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'Sentinel System Health Agent' -Action $action -Trigger $trigger -Principal $principal -Force
Write-Host 'Sentinel agent scheduled every 30 seconds.'
