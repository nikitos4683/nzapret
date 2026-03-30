#!/system/bin/sh
# nzapret — service.sh
# Module entry point (Magisk boot) or manual start (CLI manual).
# Loads profile, configures iptables, starts nfqws2.

MODDIR=${0%/*}
IPT="iptables -w"
IP6T="ip6tables -w"
CHAIN="nzapret_out"
LOGFILE="$MODDIR/nzapret.log"
EVENTLOG="$MODDIR/nzapret-events.log"
LISTS="$MODDIR/lists"
USER_LIST_FILE="$LISTS/list-user.txt"
GENERAL_LIST_FILE="$LISTS/list-general.txt"
GOOGLE_LIST_FILE="$LISTS/list-google.txt"
PAYLOADS="$MODDIR/payloads"
LUA_DIR="$MODDIR/lua"
PAYLOAD_QUIC_FILE="$PAYLOADS/quic_initial_www_google_com.bin"
PAYLOAD_TLS_FILE="$PAYLOADS/tls_clienthello_www_google_com.bin"
BIN="$MODDIR/bin/nfqws2"
PROFILE_DIR="$MODDIR/profiles"
ACTIVE_PROFILE_FILE="$PROFILE_DIR/profile.current"
DEFAULT_PROFILE="default"
PROCESS_NAME="nfqws2"
START_MODE="${1:-boot}"

# Utilities
log_event() {
    _etype="$1"; shift
    _ets=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ets" "$_etype" "$*" >> "$EVENTLOG"
}

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# Emergency exit: rolls back iptables and kills nfqws2 to prevent unstable state.
fail() {
    log_event ERROR "$*"
    cleanup_tables 2>/dev/null
    killall "$PROCESS_NAME" 2>/dev/null
    exit 1
}

require_cmd() {
    has_cmd "$1" || fail "missing command: $1"
}

require_file() {
    [ -f "$1" ] || fail "missing file: $1"
}

ensure_runtime_layout() {
    mkdir -p "$PROFILE_DIR" "$LISTS" || fail "mkdir -p failed"
    ensure_user_list_file
}

ensure_user_list_file() {
    [ -f "$USER_LIST_FILE" ] || : > "$USER_LIST_FILE" || fail "cannot create $USER_LIST_FILE"
}

# Iptables helpers
ipt_run() {
    $IPT "$@" || fail "iptables $*"
}

ip6t_run() {
    $IP6T "$@" || fail "ip6tables $*"
}

check_jump_rule() {
    _tbl="$1"
    _hook="$2"
    $_tbl -t mangle -C "$_hook" -j "$CHAIN" >/dev/null 2>&1
}

remove_jump_rules() {
    _tbl="$1"
    _hook="$2"
    while check_jump_rule "$_tbl" "$_hook"; do
        $_tbl -t mangle -D "$_hook" -j "$CHAIN" >/dev/null 2>&1
    done
}

# Safe idempotent cleanup of nzapret_out chains.
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

# Profiles
get_active_profile() {
    if [ -f "$ACTIVE_PROFILE_FILE" ]; then
        _pname=$(head -n 1 "$ACTIVE_PROFILE_FILE" 2>/dev/null | tr -d '\r\n')
        [ -n "$_pname" ] && {
            echo "$_pname"
            return
        }
    fi
    echo "$DEFAULT_PROFILE"
}

get_active_profile_config() {
    echo "$PROFILE_DIR/$(get_active_profile).conf"
}

# Sets: PROFILE_LABEL, QUEUE_NUM, TCP_PORTS, UDP_PORTS.
load_profile() {
    ACTIVE_PROFILE=$(get_active_profile)
    PROFILE_CONFIG=$(get_active_profile_config)
    require_file "$PROFILE_CONFIG"

    PROFILE_LABEL="$ACTIVE_PROFILE"
    QUEUE_NUM=""
    TCP_PORTS=""
    UDP_PORTS=""

    # Parsing the profile sequentially
    while file_line=""; IFS= read -r file_line || [ -n "$file_line" ]; do
        case "$file_line" in
            \#\ profile:*)
                PROFILE_LABEL=$(printf '%s' "$file_line" | sed 's/^# profile:[[:space:]]*//')
                ;;
            --qnum=*)
                QUEUE_NUM="${file_line#--qnum=}"
                ;;
            --filter-tcp=*)
                _p="${file_line#--filter-tcp=}"
                if [ -z "$TCP_PORTS" ]; then
                    TCP_PORTS="$_p"
                else
                    TCP_PORTS="$TCP_PORTS,$_p"
                fi
                ;;
            --filter-udp=*)
                _p="${file_line#--filter-udp=}"
                if [ -z "$UDP_PORTS" ]; then
                    UDP_PORTS="$_p"
                else
                    UDP_PORTS="$UDP_PORTS,$_p"
                fi
                ;;
        esac
    done < "$PROFILE_CONFIG"

    [ -n "$PROFILE_LABEL" ] || PROFILE_LABEL="$ACTIVE_PROFILE"
    [ -n "$QUEUE_NUM" ] || fail "profile $ACTIVE_PROFILE: missing --qnum"
    [ -n "$TCP_PORTS" ] || [ -n "$UDP_PORTS" ] \
        || fail "profile $ACTIVE_PROFILE: no --filter-tcp or --filter-udp found"
}

# Reads profile args and starts nfqws2 in background.
# Outputs the PID of the started process.
start_nfqws2_from_profile() {
    _cfg=$(get_active_profile_config)
    [ -f "$_cfg" ] || fail "profile config not found: $_cfg"

    set --
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            ""|\#*|\;*) continue ;;
        esac
        set -- "$@" "$_line"
    done < "$_cfg"

    [ "$#" -gt 0 ] || fail "profile $(get_active_profile) has no nfqws2 arguments"
    "$BIN" "$@" >> "$LOGFILE" 2>&1 &
    echo $!
}

# Firewall: NFQUEUE rules with multiport limit handling
add_nfqueue_rule() {
    _tbl="$1"
    _proto="$2"
    _ports="$3"

    [ -n "$_ports" ] || return 0
    _cur_ports=""
    _cur_weight=0

    _old_ifs=$IFS
    IFS=','
    set -- $_ports
    IFS=$_old_ifs

    for _entry in "$@"; do
        _entry=$(printf '%s' "$_entry" | tr -d '[:space:]' | sed 's/-/:/g')
        [ -n "$_entry" ] || continue

        case "$_entry" in
            *:*) _eweight=2 ;;
            *)   _eweight=1 ;;
        esac

        if [ $((_cur_weight + _eweight)) -gt 15 ] && [ -n "$_cur_ports" ]; then
            $_tbl -t mangle -A "$CHAIN" -p "$_proto" -m multiport --dports "$_cur_ports" \
                -j NFQUEUE --queue-num "$QUEUE_NUM" --queue-bypass \
                || fail "$_tbl add $_proto ports $_cur_ports"
            _cur_ports=""
            _cur_weight=0
        fi

        _cur_ports="${_cur_ports:+$_cur_ports,}$_entry"
        _cur_weight=$((_cur_weight + _eweight))
    done

    [ -n "$_cur_ports" ] || return 0
    $_tbl -t mangle -A "$CHAIN" -p "$_proto" -m multiport --dports "$_cur_ports" \
        -j NFQUEUE --queue-num "$QUEUE_NUM" --queue-bypass \
        || fail "$_tbl add $_proto ports $_cur_ports"
}

list_required_files() {
    printf '%s\n' \
        "$BIN" \
        "$GENERAL_LIST_FILE" \
        "$GOOGLE_LIST_FILE" \
        "$LUA_DIR/zapret-lib.lua" \
        "$LUA_DIR/zapret-antidpi.lua" \
        "$PAYLOAD_QUIC_FILE" \
        "$PAYLOAD_TLS_FILE"
}

rotate_runtime_log() {
    [ -f "$LOGFILE" ] && mv -f "$LOGFILE" "$LOGFILE.prev" 2>/dev/null
    : > "$LOGFILE"
}

trim_event_log() {
    if [ -f "$EVENTLOG" ]; then
        _evtmp=$(tail -n 200 "$EVENTLOG")
        printf '%s\n' "$_evtmp" > "$EVENTLOG"
    fi
}

wait_for_boot_completion() {
    if [ "$START_MODE" = "manual" ]; then
        if [ "$(getprop sys.boot_completed)" != "1" ]; then
            log_event INFO "manual start before boot completion, waiting"
            until [ "$(getprop sys.boot_completed)" = "1" ]; do
                sleep 1
            done
        fi
        return
    fi

    until [ "$(getprop sys.boot_completed)" = "1" ]; do
        sleep 1
    done
    sleep 5
}

verify_required_files() {
    for _file in $(list_required_files); do
        require_file "$_file"
    done
}

apply_bypass_rules() {
    # Bypass nfqws2-generated fake packets to avoid loops and needless requeueing.
    ipt_run  -t mangle -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN
    ip6t_run -t mangle -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN

    # Skip loopback and common VPN/tunnel interfaces.
    # Only -o is used because this chain is attached to OUTPUT and FORWARD.
    for _ifpat in lo tun+ wg+ tap+; do
        ipt_run  -t mangle -A "$CHAIN" -o "$_ifpat" -j RETURN
        ip6t_run -t mangle -A "$CHAIN" -o "$_ifpat" -j RETURN
    done
}

verify_jump_rules() {
    check_jump_rule "$IPT" OUTPUT || fail "iptables OUTPUT jump missing after apply"
    check_jump_rule "$IPT" FORWARD || fail "iptables FORWARD jump missing after apply"
    check_jump_rule "$IP6T" OUTPUT || fail "ip6tables OUTPUT jump missing after apply"
    check_jump_rule "$IP6T" FORWARD || fail "ip6tables FORWARD jump missing after apply"
}

rotate_runtime_log
trim_event_log

log_event START "service started (mode: $START_MODE)"

wait_for_boot_completion

# Check dependencies
require_cmd iptables
require_cmd ip6tables
require_cmd killall
ensure_runtime_layout

# Prepare binaries
require_file "$BIN"
chmod +x "$BIN" || fail "chmod +x $BIN"

# Check required files
verify_required_files

# Load profile
load_profile
log_event PROFILE "loaded $ACTIVE_PROFILE ($PROFILE_LABEL)"

# Stop previous instance
killall "$PROCESS_NAME" 2>/dev/null
cleanup_tables

# Create iptables chains
ipt_run -t mangle -N "$CHAIN"
ipt_run -t mangle -I OUTPUT -j "$CHAIN"
ipt_run -t mangle -I FORWARD -j "$CHAIN"
ip6t_run -t mangle -N "$CHAIN"
ip6t_run -t mangle -I OUTPUT -j "$CHAIN"
ip6t_run -t mangle -I FORWARD -j "$CHAIN"

apply_bypass_rules

# NFQUEUE rules (same ports for IPv4 and IPv6)
add_nfqueue_rule "$IPT"  tcp "$TCP_PORTS"
add_nfqueue_rule "$IP6T" tcp "$TCP_PORTS"
add_nfqueue_rule "$IPT"  udp "$UDP_PORTS"
add_nfqueue_rule "$IP6T" udp "$UDP_PORTS"

verify_jump_rules

log_event IPTABLES "chains created, rules applied from profile $ACTIVE_PROFILE"

# Start nfqws2
NFQWS2_PID=$(start_nfqws2_from_profile)
[ -n "$NFQWS2_PID" ] || fail "nfqws2 did not start"
sleep 1
kill -0 "$NFQWS2_PID" 2>/dev/null || fail "nfqws2 exited immediately, see $LOGFILE"
log_event NFQWS2 "started (pid: $NFQWS2_PID)"
