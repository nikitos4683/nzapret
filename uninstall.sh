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
TG_DIR="$MODDIR/tg"
TGWSPROXY_PID_FILE="$TG_DIR/tgwsproxy.pid"
TGWSPROXY_PROCESS_NAME="tgwsproxy"

log() {
    echo "[nzapret] $*" >> "$LOGFILE"
}

# Checks for external binary availability without emitting an error.
has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# Evaluates whether a jump rule directing traffic to the custom module chain
# exists in the targeted Netfilter hook (OUTPUT, FORWARD).
check_jump_rule() {
    _tbl="$1"
    _hook="$2"
    $_tbl -t mangle -C "$_hook" -j "$CHAIN" >/dev/null 2>&1
}

# Consistently cleans the specified hook by stripping all jump rules referencing
# the given chain. Built around a loop to stay resilient against duplicates.
remove_jump_rules() {
    _tbl="$1"
    _hook="$2"
    while check_jump_rule "$_tbl" "$_hook"; do
        $_tbl -t mangle -D "$_hook" -j "$CHAIN" >/dev/null 2>&1
    done
}

# Flushes the firewall traces left by the service, ensuring a clean network subsystem
# rollback. Deletes both the isolated chain (nzapret_out) and its jumps safely.
cleanup_tables() {
    remove_jump_rules "$IPT" OUTPUT
    remove_jump_rules "$IPT" FORWARD
    $IPT -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IPT -t mangle -X "$CHAIN" >/dev/null 2>&1

    if has_cmd ip6tables; then
        remove_jump_rules "$IP6T" OUTPUT
        remove_jump_rules "$IP6T" FORWARD
        $IP6T -t mangle -F "$CHAIN" >/dev/null 2>&1
        $IP6T -t mangle -X "$CHAIN" >/dev/null 2>&1
    fi
}

# Records the uninstallation or manual stop marker in the shared event log
# for operator visibility (CLI and WebUI).
write_stop_event() {
    _ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ts" "STOP" "service stopped" >> "$EVENTLOG"
}

# Securely parses the PID from the proxy state file.
read_tg_pid() {
    [ -f "$TGWSPROXY_PID_FILE" ] || return 1
    _tg_pid=$(head -n 1 "$TGWSPROXY_PID_FILE" 2>/dev/null | tr -d '\r\n')
    case "$_tg_pid" in
        ""|*[!0-9]*) return 1 ;;
    esac
    printf '%s' "$_tg_pid"
}

# Synchronously blocks until a specific process exits, enforcing a timeout.
# Timeout step is generally 0.1s where POSIX sleep supports it, or falls back to 1s.
wait_for_process_exit() {
    _pid="$1"
    _tries="${2:-20}"
    while kill -0 "$_pid" 2>/dev/null && [ "$_tries" -gt 0 ]; do
        sleep 0.1 2>/dev/null || sleep 1
        _tries=$((_tries - 1))
    done
    ! kill -0 "$_pid" 2>/dev/null
}

# Gracefully stops tgwsproxy via SIGTERM, falling back to SIGKILL.
# Also handles cleaning up the proxy's runtime tracking files.
stop_tgwsproxy() {
    _pid=$(read_tg_pid 2>/dev/null || true)
    if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null; then
        kill "$_pid" 2>/dev/null || true
        if ! wait_for_process_exit "$_pid" 20; then
            kill -9 "$_pid" 2>/dev/null || true
            wait_for_process_exit "$_pid" 5 || true
        fi
    fi

    killall "$TGWSPROXY_PROCESS_NAME" 2>/dev/null || true
    rm -f "$TGWSPROXY_PID_FILE"
}

# ========================
# Main Destruction Path
# ========================
# Stop active processes first to prevent any more packets from accumulating,
# then wipe their supporting firewall integrations.
killall "$PROCESS_NAME" 2>/dev/null
stop_tgwsproxy

if has_cmd iptables; then
    cleanup_tables
else
    log "iptables command missing, skipping firewall cleanup"
fi

log "service uninstalled"
write_stop_event
