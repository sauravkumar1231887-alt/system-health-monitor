#!/usr/bin/env bash
set -euo pipefail

SYSTEMD_UNIT="/etc/systemd/system/system-health-agent.service"
CONF_DIR="/etc/system-monitoring-health"
SCRIPT_PATH="/usr/local/bin/system-health-agent"

if [ -f "$SYSTEMD_UNIT" ]; then
  systemctl disable --now system-health-agent || true
  rm -f "$SYSTEMD_UNIT"
  systemctl daemon-reload || true
fi

rm -f "$SCRIPT_PATH"
rm -rf "$CONF_DIR"

printf 'System Monitoring Health Linux agent removed.\n'
