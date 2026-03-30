#!/system/bin/sh
# action.sh for Magisk/KernelSU
# Quick toggle action: Start/Stop nzapret service

MODDIR=${0%/*}
CLI="$MODDIR/system/bin/nzapret"

# KernelSU/Magisk action entrypoint: keep output short and human-readable.
print_header() {
    echo "=== nzapret Action ==="
    echo ""
}

require_cli() {
    [ -f "$CLI" ] || {
        echo "[-] Error: CLI utility not found at $CLI"
        exit 1
    }
}

is_running() {
    "$CLI" status | grep -q 'nfqws2: \[ON\]'
}

# Print the compact status lines most useful after a quick toggle action.
print_status_summary() {
    echo ""
    echo "[*] Current Status:"
    "$CLI" status | grep -E 'nfqws2:|iptables|Active profile:'
}

print_header
require_cli

if is_running; then
    echo "[*] Service is currently RUNNING."
    "$CLI" stop
else
    echo "[*] Service is currently STOPPED."
    "$CLI" start
fi

print_status_summary

echo ""
echo "=== Done ==="
