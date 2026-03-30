#!/system/bin/sh
# nzapret — uninstall.sh
# Called by Magisk during module removal.
# Stops nfqws2 and wipes iptables chains.

MODDIR=${0%/*}
IPT="iptables -w"
IP6T="ip6tables -w"
CHAIN="nzapret_out"
LOGFILE="$MODDIR/nzapret.log"
EVENTLOG="$MODDIR/nzapret-events.log"
PROCESS_NAME="nfqws2"

log() {
    echo "[nzapret] $*" >> "$LOGFILE"
}

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# Silent exit if command is missing (system might be in minimal state during uninstall).
require_cmd() {
    has_cmd "$1" || exit 0
}

check_jump_rule() {
    _tbl="$1"
    _hook="$2"
    $_tbl -t mangle -C "$_hook" -j "$CHAIN" >/dev/null 2>&1
}

# Remove every jump to the custom chain to stay idempotent across repeated stops.
remove_jump_rules() {
    _tbl="$1"
    _hook="$2"
    while check_jump_rule "$_tbl" "$_hook"; do
        $_tbl -t mangle -D "$_hook" -j "$CHAIN" >/dev/null 2>&1
    done
}

# Removes all jump rules in a loop to ensure no duplicates.
cleanup_tables() {
    remove_jump_rules "$IPT" OUTPUT
    remove_jump_rules "$IPT" FORWARD
    $IPT -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IPT -t mangle -X "$CHAIN" >/dev/null 2>&1

    remove_jump_rules "$IP6T" OUTPUT
    remove_jump_rules "$IP6T" FORWARD
    $IP6T -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IP6T -t mangle -X "$CHAIN" >/dev/null 2>&1
}

write_stop_event() {
    _ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ts" "STOP" "service stopped" >> "$EVENTLOG"
}

# Best-effort process stop first, then firewall cleanup below.
killall "$PROCESS_NAME" 2>/dev/null

# Dependencies check
require_cmd iptables
require_cmd ip6tables

cleanup_tables
log "service uninstalled"
write_stop_event
