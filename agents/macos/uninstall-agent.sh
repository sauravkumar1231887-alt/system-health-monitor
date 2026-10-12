#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="/Library/LaunchDaemons/com.systemmonitoringhealth.agent.plist"
CONF_DIR="/Library/Application Support/SystemMonitoringHealth"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
fi

rm -rf "$CONF_DIR"

printf 'System Monitoring Health macOS agent removed.\n'
