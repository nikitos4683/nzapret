#!/system/bin/sh
# nzapret — service.sh
# Module entry point (Magisk boot) or manual start (CLI manual).
# Loads profile, configures iptables, starts nfqws.

MODDIR=${0%/*}
IPT="iptables -w"
IP6T="ip6tables -w"
CHAIN="nzapret_out"
LOGFILE="$MODDIR/nzapret.log"
EVENTLOG="$MODDIR/nzapret-events.log"
UTILS="$MODDIR/utils"
LISTS="$MODDIR/lists"
PAYLOADS="$MODDIR/payloads"
BIN="$MODDIR/bin/nfqws"
ACTIVE_PROFILE_FILE="$UTILS/profile.current"
PROFILE_DIR="$MODDIR/profiles"
DEFAULT_PROFILE="default"
START_MODE="${1:-boot}"

# Utilities
log_event() {
    _etype="$1"; shift
    _ets=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ets" "$_etype" "$*" >> "$EVENTLOG"
}

# Emergency exit: rolls back iptables and kills nfqws to prevent unstable state.
fail() {
    log_event ERROR "$*"
    cleanup_tables 2>/dev/null
    killall nfqws 2>/dev/null
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

require_file() {
    [ -f "$1" ] || fail "missing file: $1"
}

# Iptables helpers
ipt_run() {
    $IPT "$@" || fail "iptables $*"
}

ip6t_run() {
    $IP6T "$@" || fail "ip6tables $*"
}

# Safe idempotent cleanup of nzapret_out chains.
# Removes all jump rules in a loop to ensure no duplicates.
cleanup_tables() {
    # IPv4: remove all jump rules to $CHAIN from OUTPUT
    while $IPT -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1; do
        $IPT -t mangle -D OUTPUT -j "$CHAIN" >/dev/null 2>&1
    done
    while $IPT -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1; do
        $IPT -t mangle -D FORWARD -j "$CHAIN" >/dev/null 2>&1
    done
    $IPT -t mangle -F "$CHAIN" >/dev/null 2>&1
    $IPT -t mangle -X "$CHAIN" >/dev/null 2>&1

    # IPv6: same as above
    while $IP6T -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1; do
        $IP6T -t mangle -D OUTPUT -j "$CHAIN" >/dev/null 2>&1
    done
    while $IP6T -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1; do
        $IP6T -t mangle -D FORWARD -j "$CHAIN" >/dev/null 2>&1
    done
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

# Sets: PROFILE_LABEL, QUEUE_NUM, TCP_PORTS, UDP_PORTS.
load_profile() {
    ACTIVE_PROFILE=$(get_active_profile)
    PROFILE_CONFIG="$PROFILE_DIR/$ACTIVE_PROFILE.conf"
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

# Reads profile args and starts nfqws in background.
# Outputs the PID of the started process.
start_nfqws_from_profile() {
    _cfg="$PROFILE_DIR/$(get_active_profile).conf"
    [ -f "$_cfg" ] || fail "profile config not found: $_cfg"

    set --
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            ""|\#*|\;*) continue ;;
        esac
        set -- "$@" "$_line"
    done < "$_cfg"

    [ "$#" -gt 0 ] || fail "profile $(get_active_profile) has no nfqws arguments"
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

# Rotate nfqws runtime log — keep previous for debugging.
[ -f "$LOGFILE" ] && mv -f "$LOGFILE" "$LOGFILE.prev" 2>/dev/null
: > "$LOGFILE"

# Trim event log to last 200 entries.
if [ -f "$EVENTLOG" ]; then
    _evtmp=$(tail -n 200 "$EVENTLOG")
    printf '%s\n' "$_evtmp" > "$EVENTLOG"
fi

log_event START "service started (mode: $START_MODE)"

# Wait for system boot
if [ "$START_MODE" = "manual" ]; then
    if [ "$(getprop sys.boot_completed)" != "1" ]; then
        log_event INFO "manual start before boot completion, waiting"
        until [ "$(getprop sys.boot_completed)" = "1" ]; do
            sleep 1
        done
    fi
else
    until [ "$(getprop sys.boot_completed)" = "1" ]; do
        sleep 1
    done
    sleep 5
fi

# Check dependencies
require_cmd iptables
require_cmd ip6tables
require_cmd killall
mkdir -p "$UTILS" "$PROFILE_DIR" "$LISTS" || fail "mkdir -p failed"

# Prepare binaries
require_file "$BIN"
chmod +x "$BIN" || fail "chmod +x $BIN"

# Check required files
require_file "$LISTS/list-general.txt"
require_file "$LISTS/list-google.txt"
require_file "$PAYLOADS/quic_initial_www_google_com.bin"
require_file "$PAYLOADS/tls_clienthello_www_google_com.bin"

# Load profile
load_profile
log_event PROFILE "loaded $ACTIVE_PROFILE ($PROFILE_LABEL)"

# Stop previous instance
killall nfqws 2>/dev/null
cleanup_tables

# Create iptables chains
ipt_run -t mangle -N "$CHAIN"
ipt_run -t mangle -I OUTPUT -j "$CHAIN"
ipt_run -t mangle -I FORWARD -j "$CHAIN"
ip6t_run -t mangle -N "$CHAIN"
ip6t_run -t mangle -I OUTPUT -j "$CHAIN"
ip6t_run -t mangle -I FORWARD -j "$CHAIN"

# Bypass nfqws generated fake packets (prevent routing loop & overhead)
ipt_run  -t mangle -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN
ip6t_run -t mangle -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN

# RETURN rules for loopback and VPN (tun+).
# Only -o (output interface) used as chain is connected to OUTPUT and FORWARD.
ipt_run  -t mangle -A "$CHAIN" -o lo   -j RETURN
ip6t_run -t mangle -A "$CHAIN" -o lo   -j RETURN
ipt_run  -t mangle -A "$CHAIN" -o tun+ -j RETURN
ip6t_run -t mangle -A "$CHAIN" -o tun+ -j RETURN

# NFQUEUE rules (same ports for IPv4 and IPv6)
add_nfqueue_rule "$IPT"  tcp "$TCP_PORTS"
add_nfqueue_rule "$IP6T" tcp "$TCP_PORTS"
add_nfqueue_rule "$IPT"  udp "$UDP_PORTS"
add_nfqueue_rule "$IP6T" udp "$UDP_PORTS"

# Verify jump rule is present
$IPT  -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1 || fail "iptables OUTPUT jump missing after apply"
$IPT  -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1 || fail "iptables FORWARD jump missing after apply"
$IP6T -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1 || fail "ip6tables OUTPUT jump missing after apply"
$IP6T -t mangle -C FORWARD -j "$CHAIN" >/dev/null 2>&1 || fail "ip6tables FORWARD jump missing after apply"

log_event IPTABLES "chains created, rules applied from profile $ACTIVE_PROFILE"

# Start nfqws
NFQWS_PID=$(start_nfqws_from_profile)
[ -n "$NFQWS_PID" ] || fail "nfqws did not start"
sleep 1
kill -0 "$NFQWS_PID" 2>/dev/null || fail "nfqws exited immediately, see $LOGFILE"
log_event NFQWS "started (pid: $NFQWS_PID)"
