#!/system/bin/sh
# nzapret — uninstall.sh
# Called by Magisk during module removal.
# Stops nfqws and wipes iptables chains.

MODDIR=${0%/*}
IPT="iptables -w"
IP6T="ip6tables -w"
CHAIN="nzapret_out"
LOGFILE="$MODDIR/nzapret.log"
EVENTLOG="$MODDIR/nzapret-events.log"

log() {
    echo "[nzapret] $*" >> "$LOGFILE"
}

# Silent exit if command is missing (system might be in minimal state during uninstall).
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || exit 0
}

# Removes all jump rules in a loop to ensure no duplicates.
cleanup_tables() {
    # IPv4
    while $IPT -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1; do
        $IPT -t mangle -D OUTPUT -j "$CHAIN" >/dev/null 2>&1
    done
    while $IPT -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1; do
        $IPT -t mangle -D FORWARD -j "$CHAIN" >/dev/null 2>&1
    done
    $IPT -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IPT -t mangle -X "$CHAIN" >/dev/null 2>&1

    # IPv6
    while $IP6T -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1; do
        $IP6T -t mangle -D OUTPUT -j "$CHAIN" >/dev/null 2>&1
    done
    while $IP6T -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1; do
        $IP6T -t mangle -D FORWARD -j "$CHAIN" >/dev/null 2>&1
    done
    $IP6T -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IP6T -t mangle -X "$CHAIN" >/dev/null 2>&1
}

# Stop nfqws
killall nfqws 2>/dev/null

# Dependencies check
require_cmd iptables
require_cmd ip6tables

# Iptables cleanup
cleanup_tables
log "service uninstalled"
# Write stop event to event log.
_ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
printf '%s %-8s %s\n' "$_ts" "STOP" "service stopped" >> "$EVENTLOG"
