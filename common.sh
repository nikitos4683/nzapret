#!/system/bin/sh
# nzapret — common.sh
# Shared POSIX sh constants and helpers sourced by service.sh, uninstall.sh and
# system/bin/nzapret. Sourced, not executed: the caller must set MODDIR first.

# --- Paths and names ---
LISTS="$MODDIR/lists"
GENERAL_LIST_FILE="$LISTS/list-general.txt"
GOOGLE_LIST_FILE="$LISTS/list-google.txt"
USER_LIST_FILE="$LISTS/list-user.txt"
PROFILE_DIR="$MODDIR/profiles"
ACTIVE_PROFILE_FILE="$PROFILE_DIR/profile.current"
BIN="$MODDIR/bin/nfqws2"
NZTG_BIN="$MODDIR/bin/nztg"
LOGFILE="$MODDIR/nzapret.log"
EVENTLOG="$MODDIR/nzapret-events.log"
PRIVATE_DNS_INIT_FILE="$MODDIR/.private_dns_initialized"
TGPROXY_CONF="$MODDIR/tgproxy.conf"
TG_SECRET_FILE="$MODDIR/.tg_secret"
TG_LINK_FILE="$MODDIR/.tg_link"
TG_LOGFILE="$MODDIR/nztg.log"

CHAIN="nzapret_out"
PROCESS_NAME="nfqws2"
TG_PROCESS_NAME="nztg"
DEFAULT_PROFILE="default"
DEFAULT_PRIVATE_DNS_HOSTNAME="geohide.ru"

# --- Generic ---
log_event() {
    _etype="$1"; shift
    _ets=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ets" "$_etype" "$*" >> "$EVENTLOG"
}

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

trim_value() {
    printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

# Keep the previous run's log as <file>.prev and start a fresh one.
rotate_log() {
    [ -f "$1" ] && mv -f "$1" "$1.prev" 2>/dev/null
    : > "$1" 2>/dev/null
}

# Files nfqws2 needs besides the profile itself (one path per line).
list_required_files() {
    printf '%s\n' \
        "$BIN" \
        "$GENERAL_LIST_FILE" \
        "$GOOGLE_LIST_FILE" \
        "$MODDIR/lua/zapret-lib.lua" \
        "$MODDIR/lua/zapret-antidpi.lua" \
        "$MODDIR/payloads/quic_initial_www_google_com.bin" \
        "$MODDIR/payloads/tls_clienthello_www_google_com.bin"
}

# --- IPv6 detection ---
# Informational only: whether the current network currently has working IPv6.
# The firewall does NOT gate on this (IPv6 availability is volatile and changes
# after boot / on network switches); it gates on ip6tables capability instead.
ipv6_network_available() {
    has_cmd ip || return 1
    ip -6 addr show scope global 2>/dev/null | grep -q 'inet6 ' || return 1
    ip -6 route get 2606:4700:4700::1111 >/dev/null 2>&1
}

# Whether ip6tables can manage mangle rules (a static device capability).
# This is the sole gate for bringing up the IPv6 firewall: idle IPv6 NFQUEUE
# rules cost nothing when there is no IPv6 traffic, and are already in place to
# protect IPv6 that appears later.
ip6tables_supported() {
    has_cmd ip6tables || return 1
    ip6tables -w -t mangle -L >/dev/null 2>&1
}

# --- Firewall ---
# check_jump_rule <iptables|ip6tables> <hook>
check_jump_rule() {
    "$1" -w -t mangle -C "$2" -j "$CHAIN" >/dev/null 2>&1
}

# teardown_chain <iptables|ip6tables>: remove every jump to the chain (so
# repeated starts/stops never leave duplicates behind), then drop the chain.
teardown_chain() {
    for _th in OUTPUT FORWARD; do
        while check_jump_rule "$1" "$_th"; do
            "$1" -w -t mangle -D "$_th" -j "$CHAIN" >/dev/null 2>&1 || break
        done
    done
    "$1" -w -t mangle -F "$CHAIN" >/dev/null 2>&1
    "$1" -w -t mangle -X "$CHAIN" >/dev/null 2>&1
}

# Idempotent cleanup of the nzapret_out chains in both families.
cleanup_tables() {
    has_cmd iptables && teardown_chain iptables
    has_cmd ip6tables && teardown_chain ip6tables
}

# --- Profiles ---
get_active_profile() {
    _pname=""
    [ -f "$ACTIVE_PROFILE_FILE" ] && _pname=$(head -n 1 "$ACTIVE_PROFILE_FILE" 2>/dev/null | tr -d '\r\n')
    echo "${_pname:-$DEFAULT_PROFILE}"
}

profile_config_file() {
    echo "$PROFILE_DIR/$1.conf"
}

# User-facing label from the `# profile:` header, falling back to the name.
get_profile_label() {
    _plabel=$(grep -m 1 '^# profile:' "$(profile_config_file "$1")" 2>/dev/null \
        | sed 's/^# profile:[[:space:]]*//')
    echo "${_plabel:-$1}"
}

# --- Android global settings ---
read_global_setting() {
    has_cmd settings || return 1
    _value=$(settings get global "$1" 2>/dev/null | tr -d '\r')
    case "$_value" in
        ""|"null") return 1 ;;
    esac
    printf '%s' "$_value"
}

put_global_setting() {
    has_cmd settings || return 1
    settings put global "$1" "$2" >/dev/null 2>&1
}

# --- Private DNS ---
mark_private_dns_initialized() {
    : > "$PRIVATE_DNS_INIT_FILE" 2>/dev/null
}

normalize_private_dns_mode() {
    case "$1" in
        ""|"opportunistic"|"auto") echo "opportunistic" ;;
        "off") echo "off" ;;
        "hostname"|"provider") echo "hostname" ;;
        *) echo "" ;;
    esac
}

normalize_private_dns_hostname() {
    trim_value "$1" | tr '[:upper:]' '[:lower:]'
}

get_private_dns_mode() {
    _mode=$(read_global_setting private_dns_mode || read_global_setting private_dns_default_mode)
    _mode=$(normalize_private_dns_mode "$_mode")
    echo "${_mode:-opportunistic}"
}

get_private_dns_hostname() {
    normalize_private_dns_hostname "$(read_global_setting private_dns_specifier)"
}

is_valid_private_dns_hostname() {
    _host=$(normalize_private_dns_hostname "$1")
    [ -n "$_host" ] || return 1
    [ "${#_host}" -le 253 ] || return 1
    case "$_host" in
        .*|*..*|*.) return 1 ;;
        *[!a-z0-9.-]*) return 1 ;;
    esac

    _old_ifs=$IFS
    IFS='.'
    set -- $_host
    IFS=$_old_ifs

    [ "$#" -ge 2 ] || return 1
    for _label in "$@"; do
        [ "${#_label}" -le 63 ] || return 1
        case "$_label" in
            -*|*-) return 1 ;;
        esac
    done
    return 0
}

# Switch Private DNS to provider-hostname mode (does not mark it initialized).
apply_private_dns_hostname() {
    _pdh=$(normalize_private_dns_hostname "$1")
    is_valid_private_dns_hostname "$_pdh" || return 1
    put_global_setting private_dns_specifier "$_pdh" || return 1
    [ "$(get_private_dns_mode)" = "hostname" ] || put_global_setting private_dns_mode hostname
}

# --- Telegram proxy (nztgproxy) ---
DEFAULT_TG_HOST="127.0.0.1"
DEFAULT_TG_PORT="1443"
DEFAULT_TG_DC_A="2:149.154.167.220"
DEFAULT_TG_DC_B="4:149.154.167.220"

# Write the original defaults if no config exists yet.
ensure_tgproxy_conf() {
    [ -f "$TGPROXY_CONF" ] && return 0
    printf '%s\n' \
        "host=$DEFAULT_TG_HOST" \
        "port=$DEFAULT_TG_PORT" \
        "cf_enabled=1" \
        "cf_domain=" \
        "preresolve_enabled=1" \
        "dc=$DEFAULT_TG_DC_A" \
        "dc=$DEFAULT_TG_DC_B" > "$TGPROXY_CONF" 2>/dev/null
}

# get_tg_conf <key> [default] — first value for a single-value key.
get_tg_conf() {
    _tv=$(grep -m1 "^$1=" "$TGPROXY_CONF" 2>/dev/null | sed "s/^$1=//" | tr -d '\r')
    printf '%s' "${_tv:-$2}"
}

# Emit the `dc=` rules (one per line, without the prefix).
get_tg_dc_lines() {
    grep '^dc=' "$TGPROXY_CONF" 2>/dev/null | sed 's/^dc=//' | tr -d '\r'
}

# Build the nztg argument string from the config (used unquoted for word-split;
# all values are space-free and validated by the CLI before being written).
tg_build_args() {
    printf ' --host %s --port %s' \
        "$(get_tg_conf host "$DEFAULT_TG_HOST")" \
        "$(get_tg_conf port "$DEFAULT_TG_PORT")"
    for _tdc in $(get_tg_dc_lines); do
        printf ' --dc-ip %s' "$_tdc"
    done
    [ "$(get_tg_conf cf_enabled 1)" = "0" ] && printf ' --no-cfproxy'
    for _tcfd in $(get_tg_conf cf_domain ""); do
        printf ' --cfproxy-domain %s' "$_tcfd"
    done
    [ "$(get_tg_conf preresolve_enabled 1)" = "0" ] && printf ' --no-preresolve'
}
