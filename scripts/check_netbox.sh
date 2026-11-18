#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NETBOX_PORT:-8000}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --port)
            PORT="${2:?Missing value for --port}"
            shift 2
            ;;
        *)
            echo "Usage: $0 [--port 8000]"
            exit 2
            ;;
    esac
done

BASE_URL="http://127.0.0.1:${PORT}"

echo "=== NetBox System Health & Diagnostics ==="
echo "Checking backend at $BASE_URL..."

if ! HEALTH_JSON="$(curl -fsS --max-time 3 "$BASE_URL/api/system/health" 2>/dev/null)"; then
    echo "[FAIL] NetBox backend is NOT reachable at $BASE_URL."
    echo "       Start with: ./scripts/start_netbox.sh [--lan]"
    exit 1
fi

python3 - "$HEALTH_JSON" "$BASE_URL" <<'PY'
import json
import sys
import urllib.request

health = json.loads(sys.argv[1])
base_url = sys.argv[2]

print(f"Overall Status : {health.get('overall_status', 'unknown').upper()} (mode={health.get('mode')}, version={health.get('backend_version')})")
print("Components:")
for key, comp in health.get("components", {}).items():
    print(f"  - {comp.get('name', key):35s} : [{comp.get('status', 'unknown').upper():11s}] {comp.get('detail', '')}")

try:
    with urllib.request.urlopen(f"{base_url}/api/system/network", timeout=3) as resp:
        net = json.loads(resp.read().decode("utf-8"))
    print("\nNetwork & Connection:")
    print(f"  Local URL      : {net.get('local_url')}")
    print(f"  WSL2 Mode      : {net.get('wsl_network_mode')} (eth0={net.get('wsl_eth0_ip')})")
    if net.get("recommended_lan_url"):
        print(f"  LAN Client URL : {net.get('recommended_lan_url')}")
    if net.get("wsl_portproxy_command"):
        print("\nWSL 2 NAT Host Forwarding (run in Admin PowerShell if sharing over LAN/Hotspot):")
        print(f"  {net['wsl_portproxy_command']}")
        print(f"  {net['wsl_firewall_command']}")
except Exception as err:
    print(f"\n(Network details skipped: {err})")

try:
    with urllib.request.urlopen(f"{base_url}/api/system/connection", timeout=3) as resp:
        conn = json.loads(resp.read().decode("utf-8"))
    if conn.get("auth_required") and conn.get("pairing_token"):
        print(f"\nHost Pairing Token (give to LAN clients): {conn['pairing_token']}")
except Exception:
    pass
PY
