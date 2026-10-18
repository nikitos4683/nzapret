#!/system/bin/sh
# nzapret — service.sh
# Module entry point (Magisk boot) or manual start (CLI manual).
# Loads profile, configures iptables, starts nfqws2 and the Telegram proxy.

MODDIR=${0%/*}
START_MODE="${1:-boot}"
IPV6_ENABLED=0
FW_TABLES="iptables"

# Shared constants and helpers (logging, firewall, profiles, Private DNS).
. "$MODDIR/common.sh"

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

# fw <iptables|ip6tables> <args...>: run a mangle-table command or abort.
fw() {
    _fwt="$1"; shift
    "$_fwt" -w -t mangle "$@" || fail "$_fwt -t mangle $*"
}

trim_event_log() {
    [ -f "$EVENTLOG" ] || return 0
    _evtmp=$(tail -n 200 "$EVENTLOG")
    printf '%s\n' "$_evtmp" > "$EVENTLOG"
}

wait_for_boot_completion() {
    if [ "$(getprop sys.boot_completed)" != "1" ]; then
        [ "$START_MODE" = "manual" ] && log_event INFO "manual start before boot completion, waiting"
        until [ "$(getprop sys.boot_completed)" = "1" ]; do
            sleep 1
        done
    fi
    # At boot, give the rest of the system a moment to settle.
    [ "$START_MODE" = "manual" ] || sleep 5
}

ensure_runtime_layout() {
    mkdir -p "$PROFILE_DIR" "$LISTS" || fail "mkdir -p failed"
    [ -f "$USER_LIST_FILE" ] || : > "$USER_LIST_FILE" || fail "cannot create $USER_LIST_FILE"
}

ensure_private_dns_initialized() {
    has_cmd settings || {
        log_event DNS "settings command unavailable, skipping Private DNS initialization"
        return 0
    }

    [ -f "$PRIVATE_DNS_INIT_FILE" ] && return 0

    _host=$(get_private_dns_hostname)
    if [ "$(get_private_dns_mode)" = "hostname" ] && is_valid_private_dns_hostname "$_host"; then
        mark_private_dns_initialized
        log_event DNS "existing Private DNS provider preserved ($_host)"
    elif apply_private_dns_hostname "$DEFAULT_PRIVATE_DNS_HOSTNAME"; then
        mark_private_dns_initialized
        log_event DNS "default Private DNS provider set to $DEFAULT_PRIVATE_DNS_HOSTNAME"
    else
        log_event ERROR "failed to initialize Private DNS provider"
    fi
}

# The firewall stack is decided by ip6tables capability alone, not by the
# current (volatile) IPv6 reachability. When ip6tables works we always lay down
# IPv6 NFQUEUE rules: they are free when no IPv6 traffic exists and already in
# place to protect IPv6 that comes up after boot or after a network switch.
resolve_firewall_stack() {
    if ip6tables_supported; then
        IPV6_ENABLED=1
        FW_TABLES="iptables ip6tables"
        log_event NETWORK "IPv6 firewall enabled (ip6tables available)"
    else
        IPV6_ENABLED=0
        FW_TABLES="iptables"
        log_event NETWORK "IPv6 firewall disabled (ip6tables unavailable)"
    fi
}

# Sets ACTIVE_PROFILE, PROFILE_CONFIG, PROFILE_LABEL, QUEUE_NUM, TCP_PORTS, UDP_PORTS.
load_profile() {
    ACTIVE_PROFILE=$(get_active_profile)
    PROFILE_CONFIG=$(profile_config_file "$ACTIVE_PROFILE")
    require_file "$PROFILE_CONFIG"
    PROFILE_LABEL=$(get_profile_label "$ACTIVE_PROFILE")
    QUEUE_NUM=""
    TCP_PORTS=""
    UDP_PORTS=""

    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            --qnum=*)       QUEUE_NUM="${_line#--qnum=}" ;;
            --filter-tcp=*) TCP_PORTS="${TCP_PORTS:+$TCP_PORTS,}${_line#--filter-tcp=}" ;;
            --filter-udp=*) UDP_PORTS="${UDP_PORTS:+$UDP_PORTS,}${_line#--filter-udp=}" ;;
        esac
    done < "$PROFILE_CONFIG"

    [ -n "$QUEUE_NUM" ] || fail "profile $ACTIVE_PROFILE: missing --qnum"
    [ -n "$TCP_PORTS" ] || [ -n "$UDP_PORTS" ] \
        || fail "profile $ACTIVE_PROFILE: no --filter-tcp or --filter-udp found"
}

add_nfqueue_chunk() {
    fw "$1" -A "$CHAIN" -p "$2" -m multiport --dports "$3" \
        -j NFQUEUE --queue-num "$QUEUE_NUM" --queue-bypass
}

# add_nfqueue_rules <table> <tcp|udp> <ports>: queue a comma-separated port
# list, split into chunks that fit the 15-slot multiport limit (a range = 2).
add_nfqueue_rules() {
    _nt="$1"
    _np="$2"
    _ports=$(printf '%s' "$3" | sed 's/[[:space:]]//g; s/-/:/g')
    [ -n "$_ports" ] || return 0

    _chunk=""
    _weight=0
    _old_ifs=$IFS
    IFS=','
    set -- $_ports
    IFS=$_old_ifs

    for _entry in "$@"; do
        [ -n "$_entry" ] || continue
        case "$_entry" in
            *:*) _eweight=2 ;;
            *)   _eweight=1 ;;
        esac
        if [ $((_weight + _eweight)) -gt 15 ] && [ -n "$_chunk" ]; then
            add_nfqueue_chunk "$_nt" "$_np" "$_chunk"
            _chunk=""
            _weight=0
        fi
        _chunk="${_chunk:+$_chunk,}$_entry"
        _weight=$((_weight + _eweight))
    done

    [ -z "$_chunk" ] || add_nfqueue_chunk "$_nt" "$_np" "$_chunk"
}

setup_firewall() {
    for _t in $FW_TABLES; do
        fw "$_t" -N "$CHAIN"
        fw "$_t" -I OUTPUT -j "$CHAIN"
        fw "$_t" -I FORWARD -j "$CHAIN"

        # Bypass nfqws2-generated fake packets to avoid loops and needless requeueing.
        fw "$_t" -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN

        # Skip loopback and common VPN/tunnel interfaces.
        # Only -o is used because this chain is attached to OUTPUT and FORWARD.
        for _ifpat in lo tun+ wg+ tap+; do
            fw "$_t" -A "$CHAIN" -o "$_ifpat" -j RETURN
        done

        add_nfqueue_rules "$_t" tcp "$TCP_PORTS"
        add_nfqueue_rules "$_t" udp "$UDP_PORTS"

        check_jump_rule "$_t" OUTPUT || fail "$_t OUTPUT jump missing after apply"
        check_jump_rule "$_t" FORWARD || fail "$_t FORWARD jump missing after apply"
    done
}

# Pass every non-comment profile line to nfqws2 as one argument.
start_nfqws2() {
    set --
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            ""|\#*|\;*) continue ;;
            --bind-fix6) [ "$IPV6_ENABLED" = "1" ] || continue ;;
        esac
        set -- "$@" "$_line"
    done < "$PROFILE_CONFIG"

    [ "$#" -gt 0 ] || fail "profile $ACTIVE_PROFILE has no nfqws2 arguments"
    "$BIN" "$@" >> "$LOGFILE" 2>&1 &
    _pid=$!
    sleep 1
    kill -0 "$_pid" 2>/dev/null || fail "nfqws2 exited immediately, see $LOGFILE"
    log_event NFQWS2 "started (pid: $_pid)"
}

# Start the Telegram MTProto proxy (nztgproxy) alongside nfqws2.
# Non-fatal: DPI bypass must come up even if the Telegram proxy fails.
start_tgproxy() {
    [ -f "$NZTG_BIN" ] || {
        log_event TGPROXY "binary missing, skipping Telegram proxy"
        return 0
    }
    chmod +x "$NZTG_BIN" 2>/dev/null
    ensure_tgproxy_conf

    killall "$TG_PROCESS_NAME" 2>/dev/null
    rotate_log "$TG_LOGFILE"

    # tg_build_args emits space-free, CLI-validated tokens; word-splitting is intended.
    # shellcheck disable=SC2046
    "$NZTG_BIN" $(tg_build_args) --secret-file "$TG_SECRET_FILE" --link-file "$TG_LINK_FILE" >> "$TG_LOGFILE" 2>&1 &
    _tgpid=$!
    sleep 1
    if kill -0 "$_tgpid" 2>/dev/null; then
        log_event TGPROXY "started (pid: $_tgpid)"
    else
        log_event ERROR "nztgproxy failed to start, see $TG_LOGFILE"
    fi
}

rotate_log "$LOGFILE"
trim_event_log

log_event START "service started (mode: $START_MODE)"

wait_for_boot_completion

require_cmd iptables
require_cmd killall
ensure_runtime_layout
ensure_private_dns_initialized
resolve_firewall_stack

for _file in $(list_required_files); do
    require_file "$_file"
done
chmod +x "$BIN" || fail "chmod +x $BIN"

load_profile
log_event PROFILE "loaded $ACTIVE_PROFILE ($PROFILE_LABEL)"

# Replace any previous instance.
killall "$PROCESS_NAME" 2>/dev/null
cleanup_tables

setup_firewall
log_event IPTABLES "chains created, rules applied from profile $ACTIVE_PROFILE"

start_nfqws2
start_tgproxy
