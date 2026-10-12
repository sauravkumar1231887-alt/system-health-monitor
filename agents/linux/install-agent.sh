#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:8000}"
AGENT_KEY="${AGENT_KEY:-}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
CONF_DIR="/etc/system-monitoring-health"
SERVICE_PATH="/etc/systemd/system/system-health-agent.service"
SCRIPT_PATH="/usr/local/bin/system-health-agent"

if [ -z "$AGENT_KEY" ]; then
  echo "AGENT_KEY is required. Example: AGENT_KEY=SYSTEM-56 ./install-agent.sh" >&2
  exit 1
fi

mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/config" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_KEY="$AGENT_KEY"
INTERVAL_SECONDS="$INTERVAL_SECONDS"
VERIFY_TLS="false"
EOF

install -m 0755 "$(dirname "$0")/system-health-agent.sh" "$SCRIPT_PATH"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=System Monitoring Health Linux Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/system-health-agent
Restart=on-failure
RestartSec=5
Environment=SERVER_URL=$SERVER_URL
Environment=AGENT_KEY=$AGENT_KEY
Environment=INTERVAL_SECONDS=$INTERVAL_SECONDS

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now system-health-agent
systemctl status --no-pager system-health-agent || true

printf '\nConfiguration written to %s\n' "$CONF_DIR/config"
printf 'Service started: %s\n' "$SERVICE_PATH"
printf 'Logs: journalctl -u system-health-agent\n'
