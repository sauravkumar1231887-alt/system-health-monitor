#!/usr/bin/env bash
set -u

SERVER_URL="${SERVER_URL:-http://127.0.0.1:8000}"
AGENT_KEY="${AGENT_KEY:-}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
CONFIG_PATH="${CONFIG_PATH:-/Library/Application Support/SystemMonitoringHealth/config}"

if [ -f "$CONFIG_PATH" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_PATH"
fi

if [ -z "$AGENT_KEY" ]; then
  echo "AGENT_KEY is required." >&2
  exit 1
fi

python3 - "$SERVER_URL" "$AGENT_KEY" <<'PY'
import json
import os
import socket
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

server_url = sys.argv[1].rstrip('/')
agent_key = sys.argv[2]


def run(*args):
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return ''


def get_network():
    iface = run('route', '-n', 'get', 'default')
    if iface:
        lines = iface.splitlines()
        name = next((line.split()[-1] for line in lines if 'interface:' in line.lower()), '')
    else:
        name = ''
    ipv4 = run('ipconfig', 'getifaddr', 'en0') or run('ipconfig', 'getifaddr', 'en1') or ''
    mac = run('ifconfig', name) if name else ''
    mac = next((line.split()[-1] for line in mac.splitlines() if 'ether' in line.lower()), '')
    dns = []
    for line in run('scutil', '--dns').splitlines():
        if line.strip().startswith('nameserver'):
            dns.append(line.split()[-1])
    return {
        'activeInterface': name,
        'macAddress': mac,
        'ipv4': [ipv4] if ipv4 else [],
        'ipv6': [],
        'gateway': run('netstat', '-rn', '|', 'grep', 'default').split()[1] if 'default' in run('netstat', '-rn') else '',
        'dns': dns,
        'connected': bool(name),
        'status': 'HEALTHY' if name else 'OFFLINE',
        'latency': {'gatewayMs': None, 'internetMs': None, 'packetLossPercent': None},
        'traffic': {'bytesSent': 0, 'bytesReceived': 0, 'packetsSent': 0, 'packetsReceived': 0, 'uploadBytesPerSecond': 0, 'downloadBytesPerSecond': 0, 'utilizationPercent': 0},
    }


def get_os():
    version = run('sw_vers', '-productVersion') or 'unknown'
    build = run('sw_vers', '-buildVersion') or 'unknown'
    return {'name': 'macOS', 'version': version, 'build': build, 'kernel': run('uname', '-r') or 'unknown', 'architecture': run('uname', '-m') or 'unknown'}


def get_mem():
    vm_stat = run('vm_stat')
    pages_inactive = 0
    pages_free = 0
    pages_active = 0
    for line in vm_stat.splitlines():
        if 'Pages free' in line:
            pages_free = int(line.split()[-1].strip('.'))
        elif 'Pages active' in line:
            pages_active = int(line.split()[-1].strip('.'))
        elif 'Pages inactive' in line:
            pages_inactive = int(line.split()[-1].strip('.'))
    total = 0
    for line in run('sysctl', 'hw.memsize').splitlines():
        if 'hw.memsize' in line:
            total = int(line.split()[-1])
    used = pages_active * 4096 + pages_inactive * 4096
    free = pages_free * 4096
    percent = round((used / total) * 100, 2) if total else 0
    return {'totalBytes': total, 'usedBytes': used, 'freeBytes': free, 'usedPercent': percent}


def get_cpu():
    load = run('uptime')
    try:
        load_avg = load.split('load averages:')[-1].strip().split(',')
    except Exception:
        load_avg = ['0.00', '0.00', '0.00']
    return {'usagePercent': 0, 'loadAverage': {'1m': float(load_avg[0].strip()), '5m': float(load_avg[1].strip()), '15m': float(load_avg[2].strip())}, 'count': int(run('sysctl', '-n', 'hw.ncpu') or 1)}


def get_disks():
    rows = []
    out = run('df', '-Pk')
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        mount = parts[-1]
        total = int(parts[1]) * 1024
        used = int(parts[2]) * 1024
        free = int(parts[3]) * 1024
        rows.append({'mount': mount, 'totalBytes': total, 'usedBytes': used, 'freeBytes': free, 'usedPercent': round((used / total) * 100, 2) if total else 0})
    return rows


payload = {
    'hostname': socket.gethostname(),
    'platform': 'macos',
    'ipAddress': run('ipconfig', 'getifaddr', 'en0') or run('ipconfig', 'getifaddr', 'en1') or '',
    'os': 'macOS',
    'osVersion': get_os()['version'],
    'osBuildNumber': get_os()['build'],
    'osArchitecture': get_os()['architecture'],
    'agentVersion': '2.0.0',
    'collectedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'cpu': get_cpu(),
    'memory': get_mem(),
    'disks': get_disks(),
    'uptime': {'seconds': int(float(run('sysctl', '-n', 'kern.boottime').split('=')[-1].strip() or 0))},
    'network': get_network(),
    'firewall': {'name': 'macOS Application Firewall', 'enabled': True, 'status': 'enabled'},
    'security': {'name': 'Not detected', 'status': 'UNKNOWN'},
    'listeningPorts': [],
    'systemHealth': {'status': 'HEALTHY'},
    'heartbeat': {'collectedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},
}

req = urllib.request.Request(
    server_url + '/api/heartbeat',
    method='POST',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json', 'X-Agent-Key': agent_key},
)

with urllib.request.urlopen(req, timeout=15) as response:
    response.read()
PY
