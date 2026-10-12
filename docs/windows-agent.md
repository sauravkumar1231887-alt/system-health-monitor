# Windows Agent

The existing PowerShell monitoring agent remains in place and is preserved as-is in the original `agent/` directory.

## Files

- `agent/SystemHealthAgent.ps1`
- `agent/install-agent-task.ps1`
- `agent/config.json`

## Install

```powershell
cd agent
Set-ExecutionPolicy -Scope Process Bypass
./install-agent-task.ps1
```

## Configuration

```json
{
  "serverUrl": "http://192.168.8.63:8000",
  "agentKey": "SYSTEM-56",
  "intervalSeconds": 30
}
```

## Validation

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -match 'SystemHealth' }
```

The existing agent continues to send `X-Agent-Key` heartbeats to `/api/heartbeat` without removing the Windows-specific logic.
