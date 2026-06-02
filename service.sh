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
NETWORK_MODE_FILE="$PROFILE_DIR/network.mode"
PRIVATE_DNS_INIT_FILE="$MODDIR/.private_dns_initialized"
DEFAULT_PROFILE="default"
DEFAULT_PRIVATE_DNS_HOSTNAME="xbox-dns.ru"
PROCESS_NAME="nfqws2"
START_MODE="${1:-boot}"
NETWORK_MODE=""
IPV6_ENABLED=0

# Shared helpers (logging, network mode, IPv6 detection, Private DNS, settings I/O).
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

ensure_runtime_layout() {
    mkdir -p "$PROFILE_DIR" "$LISTS" || fail "mkdir -p failed"
    ensure_user_list_file
    ensure_network_mode_file
}

ensure_user_list_file() {
    [ -f "$USER_LIST_FILE" ] || : > "$USER_LIST_FILE" || fail "cannot create $USER_LIST_FILE"
}

ensure_network_mode_file() {
    _mode=$(get_configured_network_mode)
    if [ ! -f "$NETWORK_MODE_FILE" ]; then
        printf '%s\n' "$_mode" > "$NETWORK_MODE_FILE" || fail "cannot create $NETWORK_MODE_FILE"
        return
    fi

    _raw_mode=$(head -n 1 "$NETWORK_MODE_FILE" 2>/dev/null | tr -d '\r\n')
    if [ "$_raw_mode" != "$_mode" ]; then
        printf '%s\n' "$_mode" > "$NETWORK_MODE_FILE" || fail "cannot normalize $NETWORK_MODE_FILE"
    fi
}

resolve_network_mode() {
    NETWORK_MODE=$(get_configured_network_mode)
    case "$NETWORK_MODE" in
        "ipv4-only")
            IPV6_ENABLED=0
            log_event NETWORK "mode ipv4-only: IPv6 firewall disabled"
            ;;
        *)
            if ipv6_network_available && ip6tables_supported; then
                IPV6_ENABLED=1
                log_event NETWORK "mode auto: IPv4 + IPv6 firewall enabled"
            else
                IPV6_ENABLED=0
                log_event NETWORK "mode auto: IPv6 unavailable, using IPv4-only firewall"
            fi
            ;;
    esac
}

set_private_dns_hostname_mode() {
    _host=$(normalize_private_dns_hostname "$1")
    is_valid_private_dns_hostname "$_host" || return 1
    put_global_setting private_dns_specifier "$_host" || return 1
    _mode=$(get_private_dns_mode)
    if [ "$_mode" != "hostname" ]; then
        put_global_setting private_dns_mode hostname || return 1
    fi
    return 0
}

ensure_private_dns_initialized() {
    has_cmd settings || {
        log_event DNS "settings command unavailable, skipping Private DNS initialization"
        return 0
    }

    [ -f "$PRIVATE_DNS_INIT_FILE" ] && return 0

    _mode=$(get_private_dns_mode)
    _host=$(get_private_dns_hostname)
    if [ "$_mode" = "hostname" ] && is_valid_private_dns_hostname "$_host"; then
        mark_private_dns_initialized
        log_event DNS "existing Private DNS provider preserved ($_host)"
        return 0
    fi

    if set_private_dns_hostname_mode "$DEFAULT_PRIVATE_DNS_HOSTNAME"; then
        mark_private_dns_initialized
        log_event DNS "default Private DNS provider set to $DEFAULT_PRIVATE_DNS_HOSTNAME"
    else
        log_event ERROR "failed to initialize Private DNS provider"
    fi
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

    if has_cmd ip6tables; then
        remove_jump_rules "$IP6T" OUTPUT
        remove_jump_rules "$IP6T" FORWARD
        $IP6T -t mangle -F "$CHAIN" >/dev/null 2>&1
        $IP6T -t mangle -X "$CHAIN" >/dev/null 2>&1
    fi
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
        if [ "$IPV6_ENABLED" != "1" ]; then
            case "$_line" in
                --bind-fix6) continue ;;
            esac
        fi
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
    if [ "$IPV6_ENABLED" = "1" ]; then
        ip6t_run -t mangle -A "$CHAIN" -m mark --mark 0x40000000/0x40000000 -j RETURN
    fi

    # Skip loopback and common VPN/tunnel interfaces.
    # Only -o is used because this chain is attached to OUTPUT and FORWARD.
    for _ifpat in lo tun+ wg+ tap+; do
        ipt_run  -t mangle -A "$CHAIN" -o "$_ifpat" -j RETURN
        if [ "$IPV6_ENABLED" = "1" ]; then
            ip6t_run -t mangle -A "$CHAIN" -o "$_ifpat" -j RETURN
        fi
    done
}

verify_jump_rules() {
    check_jump_rule "$IPT" OUTPUT || fail "iptables OUTPUT jump missing after apply"
    check_jump_rule "$IPT" FORWARD || fail "iptables FORWARD jump missing after apply"
    if [ "$IPV6_ENABLED" = "1" ]; then
        check_jump_rule "$IP6T" OUTPUT || fail "ip6tables OUTPUT jump missing after apply"
        check_jump_rule "$IP6T" FORWARD || fail "ip6tables FORWARD jump missing after apply"
    fi
}

rotate_runtime_log
trim_event_log

log_event START "service started (mode: $START_MODE)"

wait_for_boot_completion

# Check dependencies
require_cmd iptables
require_cmd killall
ensure_runtime_layout
ensure_private_dns_initialized
resolve_network_mode

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
if [ "$IPV6_ENABLED" = "1" ]; then
    ip6t_run -t mangle -N "$CHAIN"
    ip6t_run -t mangle -I OUTPUT -j "$CHAIN"
    ip6t_run -t mangle -I FORWARD -j "$CHAIN"
fi

apply_bypass_rules

# NFQUEUE rules
add_nfqueue_rule "$IPT"  tcp "$TCP_PORTS"
add_nfqueue_rule "$IPT"  udp "$UDP_PORTS"
if [ "$IPV6_ENABLED" = "1" ]; then
    add_nfqueue_rule "$IP6T" tcp "$TCP_PORTS"
    add_nfqueue_rule "$IP6T" udp "$UDP_PORTS"
fi

verify_jump_rules

log_event IPTABLES "chains created, rules applied from profile $ACTIVE_PROFILE"

# Start nfqws2
NFQWS2_PID=$(start_nfqws2_from_profile)
[ -n "$NFQWS2_PID" ] || fail "nfqws2 did not start"
sleep 1
kill -0 "$NFQWS2_PID" 2>/dev/null || fail "nfqws2 exited immediately, see $LOGFILE"
log_event NFQWS2 "started (pid: $NFQWS2_PID)"
