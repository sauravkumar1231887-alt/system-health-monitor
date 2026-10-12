# macOS Agent

The macOS agent uses native tools such as `sysctl`, `sw_vers`, `vm_stat`, `df`, `route`, `ifconfig`, and `scutil` to report telemetry in a normalized heartbeat format.

## Install

```bash
sudo AGENT_KEY=MAC-01 SERVER_URL=http://192.168.8.63:8000 ./agents/macos/install-agent.sh
```

## Configuration

```bash
sudo cat /Library/Application\ Support/SystemMonitoringHealth/config
```

Example:

```bash
SERVER_URL="http://192.168.8.63:8000"
AGENT_KEY="MAC-01"
INTERVAL_SECONDS="30"
VERIFY_TLS="false"
```

## Service

```bash
sudo launchctl list | grep systemmonitoringhealth
sudo log show --predicate 'process == "system-health-agent.sh"'
```

## Uninstall

```bash
sudo ./agents/macos/uninstall-agent.sh
```
