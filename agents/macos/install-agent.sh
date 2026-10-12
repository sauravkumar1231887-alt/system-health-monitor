#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:8000}"
AGENT_KEY="${AGENT_KEY:-}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
PLIST_PATH="/Library/LaunchDaemons/com.systemmonitoringhealth.agent.plist"
CONF_DIR="/Library/Application Support/SystemMonitoringHealth"
CONFIG_PATH="$CONF_DIR/config"
SCRIPT_PATH="/Library/Application Support/SystemMonitoringHealth/system-health-agent.sh"

if [ -z "$AGENT_KEY" ]; then
  echo "AGENT_KEY is required. Example: AGENT_KEY=MAC-01 ./install-agent.sh" >&2
  exit 1
fi

mkdir -p "$CONF_DIR"
cat > "$CONFIG_PATH" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_KEY="$AGENT_KEY"
INTERVAL_SECONDS="$INTERVAL_SECONDS"
VERIFY_TLS="false"
EOF

install -m 0755 "$(dirname "$0")/system-health-agent.sh" "$SCRIPT_PATH"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.systemmonitoringhealth.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Library/Application Support/SystemMonitoringHealth/system-health-agent.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Library/Application Support/SystemMonitoringHealth</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

printf '\nConfiguration written to %s\n' "$CONFIG_PATH"
printf 'Service enabled: %s\n' "$PLIST_PATH"
printf 'Logs: log show --predicate "process == \"system-health-agent.sh\""\n'
