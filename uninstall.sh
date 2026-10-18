#!/system/bin/sh
# nzapret — uninstall.sh
# Called by Magisk during module removal and by `nzapret stop`.
# Stops nfqws2 and nztg, then wipes the iptables chains.

MODDIR=${0%/*}

# Shared constants and helpers (logging, firewall cleanup).
. "$MODDIR/common.sh"

# Best-effort process stop first, then firewall cleanup.
killall "$PROCESS_NAME" 2>/dev/null
killall "$TG_PROCESS_NAME" 2>/dev/null

if has_cmd iptables; then
    cleanup_tables
else
    echo "[nzapret] iptables command missing, skipping firewall cleanup" >> "$LOGFILE"
fi

echo "[nzapret] service stopped" >> "$LOGFILE"
log_event STOP "service stopped"
