# Linux Agent

The Linux agent is a native bash/Python based collector that uses `/proc`, `df`, `uname`, `ip`, `ss`, and the system OS metadata to send a normalized heartbeat to the Django API.

## Install

```bash
sudo cp agents/linux/system-health-agent.sh /usr/local/bin/system-health-agent
sudo chmod +x /usr/local/bin/system-health-agent
sudo AGENT_KEY=LINUX-01 SERVER_URL=http://192.168.8.63:8000 ./agents/linux/install-agent.sh
```

## Configuration

```bash
sudo cat /etc/system-monitoring-health/config
```

Example:

```bash
SERVER_URL="http://192.168.8.63:8000"
AGENT_KEY="LINUX-01"
INTERVAL_SECONDS="30"
VERIFY_TLS="false"
```

## Service

```bash
sudo systemctl status system-health-agent
sudo journalctl -u system-health-agent -f
```

## Uninstall

```bash
sudo ./agents/linux/uninstall-agent.sh
```
