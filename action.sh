#!/system/bin/sh
# action.sh for Magisk/KernelSU
# Quick toggle action: Start/Stop nzapret service

MODDIR=${0%/*}
CLI="$MODDIR/system/bin/nzapret"

echo "=== nzapret Action ==="
echo ""

if [ -f "$CLI" ]; then
    # Check status using the CLI
    if "$CLI" status | grep -q '\[ON\]'; then
        echo "[*] Service is currently RUNNING."
        "$CLI" stop
    else
        echo "[*] Service is currently STOPPED."
        "$CLI" start
    fi

    echo ""
    echo "[*] Current Status:"
    "$CLI" status | grep -E 'nfqws:|iptables|Active profile:'
else
    echo "[-] Error: CLI utility not found at $CLI"
    exit 1
fi

echo ""
echo "=== Done ==="
