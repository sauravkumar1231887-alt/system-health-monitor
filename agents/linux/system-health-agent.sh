#!/usr/bin/env bash
set -u

SERVER_URL="${SERVER_URL:-http://127.0.0.1:8000}"
AGENT_KEY="${AGENT_KEY:-}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
CONFIG_PATH="${CONFIG_PATH:-/etc/system-monitoring-health/config}"

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

server_url = sys.argv[1].rstrip('/')
agent_key = sys.argv[2]


def run(*args):
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return ""


def kb_to_bytes(value):
    try:
        return int(float(value) * 1024)
    except Exception:
        return 0


def parse_meminfo():
    info = {}
    for line in open('/proc/meminfo', 'r', encoding='utf-8').read().splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            info[key.strip()] = value.strip()
    total = kb_to_bytes(info.get('MemTotal', '0').split()[0])
    available = kb_to_bytes(info.get('MemAvailable', '0').split()[0]) if info.get('MemAvailable') else max(total - kb_to_bytes(info.get('MemUsed', '0').split()[0]) if False else 0, 0)
    free = kb_to_bytes(info.get('MemFree', '0').split()[0])
    used = max(total - free, 0)
    used_percent = round((used / total * 100), 2) if total else 0
    return {
        'totalBytes': total,
        'usedBytes': used,
        'freeBytes': free,
        'availableBytes': available,
        'usedPercent': used_percent,
    }


def parse_cpu():
    line = run('cat', '/proc/loadavg')
    load = line.split()[:3] if line else ['0', '0', '0']
    cores = run('nproc') or '1'
    try:
        cpu_percent = float(run('mpstat', '1', '1')) if subprocess.call(['which', 'mpstat'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0 else 0
    except Exception:
        cpu_percent = 0
    return {'usagePercent': round(cpu_percent, 2), 'loadAverage': {'1m': float(load[0]), '5m': float(load[1]), '15m': float(load[2])}, 'count': int(cores or 1)}


def parse_disks():
    rows = []
    output = run('df', '-P', '--output=source,size,used,avail,pcent,target')
    for line in output.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        mount = parts[-1]
        size = parts[1]
        used = parts[2]
        avail = parts[3]
        percent = parts[4].rstrip('%')
        if mount.startswith('/dev'):
            rows.append({
                'mount': mount,
                'totalBytes': int(size) * 1024,
                'usedBytes': int(used) * 1024,
                'freeBytes': int(avail) * 1024,
                'usedPercent': float(percent) if percent else 0,
            })
    return rows


def parse_network():
    active = ""
    gateways = run('ip', 'route', 'show', 'default')
    if gateways:
        active = gateways.split()[-1]
    iface = run('ip', '-o', 'route', 'show', 'default')
    iface_name = iface.split()[-3] if iface else ""
    if not iface_name:
        iface_name = run('route', '-n')
        iface_name = iface_name.splitlines()[2].split()[7] if len(iface_name.splitlines()) > 2 else ""
    ipv4 = run('hostname', '-I')
    ipv4 = ipv4.split()[0] if ipv4 else ""
    mac = run('cat', '/sys/class/net/' + iface_name + '/address') if iface_name else ""
    dns = []
    for line in open('/etc/resolv.conf', 'r', encoding='utf-8').read().splitlines():
        if line.startswith('nameserver'):
            dns.append(line.split()[1])
    try:
        with open('/proc/uptime', 'r', encoding='utf-8') as fh:
            uptime_seconds = float(fh.read().split()[0])
    except Exception:
        uptime_seconds = 0
    return {
        'activeInterface': iface_name,
        'macAddress': mac,
        'ipv4': [ipv4] if ipv4 else [],
        'ipv6': [],
        'gateway': gateways.split()[2] if gateways else '',
        'dns': dns,
        'connected': bool(iface_name),
        'status': 'HEALTHY' if iface_name else 'OFFLINE',
        'latency': {'gatewayMs': None, 'internetMs': None, 'packetLossPercent': None},
        'traffic': {'bytesSent': 0, 'bytesReceived': 0, 'packetsSent': 0, 'packetsReceived': 0, 'uploadBytesPerSecond': 0, 'downloadBytesPerSecond': 0, 'utilizationPercent': 0},
    }, uptime_seconds


def shell_file(path):
    try:
        return open(path, 'r', encoding='utf-8').read()
    except Exception:
        return ""


def parse_os_release():
    data = {}
    for line in shell_file('/etc/os-release').splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            data[key.strip()] = value.strip().strip('"')
    pretty = data.get('PRETTY_NAME') or data.get('NAME') or 'Linux'
    version = data.get('VERSION_ID') or data.get('VERSION') or 'unknown'
    return {'name': pretty, 'version': version, 'kernel': run('uname', '-r') or 'unknown', 'architecture': run('uname', '-m') or 'unknown'}


def parse_firewall():
    detected = []
    if os.path.exists('/usr/sbin/ufw') or os.path.exists('/usr/bin/ufw'):
        detected.append('ufw')
    if os.path.exists('/usr/sbin/firewalld') or os.path.exists('/usr/bin/firewall-cmd'):
        detected.append('firewalld')
    if os.path.exists('/usr/sbin/iptables') or os.path.exists('/usr/sbin/nft'):
        detected.append('iptables')
    if not detected:
        return {'name': 'Not detected', 'enabled': False, 'status': 'UNKNOWN'}
    names = ', '.join(detected)
    if 'ufw' in detected and subprocess.call(['ufw', 'status', 'verbose'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
        return {'name': names, 'enabled': True, 'status': 'enabled'}
    return {'name': names, 'enabled': True, 'status': 'enabled'}


def parse_security():
    return {'name': 'Not detected', 'status': 'UNKNOWN'}


payload = {
    'hostname': socket.gethostname(),
    'platform': 'linux',
    'ipAddress': ''.join([line for line in run('hostname', '-I').split() if '.' in line][:1]),
    'os': parse_os_release()['name'],
    'osVersion': parse_os_release()['version'],
    'osBuildNumber': 'N/A',
    'osArchitecture': parse_os_release()['architecture'],
    'agentVersion': '2.0.0',
    'collectedAt': __import__('datetime').datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
    'cpu': parse_cpu(),
    'memory': parse_meminfo(),
    'disks': parse_disks(),
    'uptime': {'seconds': parse_network()[1]},
    'network': parse_network()[0],
    'firewall': parse_firewall(),
    'security': parse_security(),
    'listeningPorts': [],
    'systemHealth': {'status': 'HEALTHY'},
    'heartbeat': {'collectedAt': __import__('datetime').datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'},
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
