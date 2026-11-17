#!/usr/bin/env bash
# Read-only environment audit script for NetBox (Phase 0+)

set -u

PASS=0
WARN=0
FAIL=0

ok()   { printf "[OK]   %s\n" "$1"; PASS=$((PASS + 1)); }
warn() { printf "[WARN] %s\n" "$1"; WARN=$((WARN + 1)); }
fail() { printf "[FAIL] %s\n" "$1"; FAIL=$((FAIL + 1)); }

echo "=== NetBox Environment Check ==="
printf "Date: %s\n" "$(date -Is)"
printf "Host: %s\n" "$(hostname)"
printf "Kernel: %s\n" "$(uname -r)"

if [ -r /etc/os-release ]; then
    . /etc/os-release
    printf "OS: %s\n" "${PRETTY_NAME:-unknown}"
fi

# WSL 1 vs WSL 2 check
KERNEL_REL="$(uname -r)"
if echo "$KERNEL_REL" | grep -qi "WSL2"; then
    ok "Running on WSL 2 kernel ($KERNEL_REL)"
elif echo "$KERNEL_REL" | grep -qi "Microsoft"; then
    warn "Running on WSL 1 kernel ($KERNEL_REL) — Phase 0 works, but WSL 2 is required before Phase 1+"
else
    ok "Linux kernel detected ($KERNEL_REL)"
fi

check_cmd() {
    local cmd="$1"
    local required_phase0="$2"
    local label="$3"
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$label: $(command -v "$cmd")"
    else
        if [ "$required_phase0" = "required" ]; then
            fail "$label: missing (required for Phase 0)"
        else
            warn "$label: missing (needed in later phases)"
        fi
    fi
}

echo ""
echo "--- Toolchain & Utilities ---"
check_cmd gcc required "GCC compiler"
check_cmd g++ optional "G++ compiler"
check_cmd make required "GNU Make"
check_cmd gdb optional "GDB debugger"
check_cmd strace optional "strace (Phase 2 verification)"
check_cmd curl optional "curl"
check_cmd git required "Git"
check_cmd python3 optional "Python 3"
check_cmd ip required "iproute2 (ip)"
check_cmd ping required "iputils-ping (ping)"
check_cmd tcpdump optional "tcpdump (Phase 4 packet capture)"

# Python ensurepip / venv check
if command -v python3 >/dev/null 2>&1; then
    if python3 -m ensurepip --version >/dev/null 2>&1; then
        ok "Python ensurepip/venv support: available"
    else
        warn "Python ensurepip/venv support: missing (install python3-venv after sudo apt update)"
    fi
fi

# Node.js check (Linux native vs Windows interop)
if command -v node >/dev/null 2>&1; then
    NODE_PATH="$(command -v node)"
    if echo "$NODE_PATH" | grep -q "^/mnt/"; then
        warn "node resolves to Windows path ($NODE_PATH); native Linux Node.js deferred to Phase 1"
    else
        ok "Linux node: $NODE_PATH ($(node --version 2>/dev/null || true))"
    fi
else
    warn "Linux node not installed (intentionally deferred to Phase 1)"
fi

# dpkg partial install check
if command -v dpkg >/dev/null 2>&1; then
    if [ -z "$(dpkg --audit 2>/dev/null)" ]; then
        ok "dpkg database clean (no partial/broken packages)"
    else
        fail "dpkg --audit reported issues"
    fi
fi

# Loopback ping check
if ping -c 1 -W 1 127.0.0.1 >/dev/null 2>&1; then
    ok "Loopback networking (127.0.0.1) reachable"
else
    fail "Loopback ping to 127.0.0.1 failed"
fi

# APT index freshness check
if [ -d /var/lib/apt/lists ]; then
    LATEST_APT=$(stat -c '%Y' /var/lib/apt/lists/*InRelease 2>/dev/null | sort -nr | head -n 1 || true)
    if [ -n "$LATEST_APT" ]; then
        NOW=$(date +%s)
        AGE_DAYS=$(( (NOW - LATEST_APT) / 86400 ))
        if [ "$AGE_DAYS" -gt 14 ]; then
            warn "APT package lists are ${AGE_DAYS} days old — run 'sudo apt update' before installing packages"
        else
            ok "APT package lists updated ${AGE_DAYS} days ago"
        fi
    fi
fi

echo ""
printf "Summary: %d OK, %d WARN, %d FAIL\n" "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
