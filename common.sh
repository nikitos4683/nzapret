#!/system/bin/sh
# nzapret — common.sh
# Shared POSIX sh helpers sourced by service.sh and system/bin/nzapret.
# Contains only side-effect-free helpers that both files need identically.
# Callers must define their path constants (EVENTLOG,
# PRIVATE_DNS_INIT_FILE, DEFAULT_PRIVATE_DNS_HOSTNAME) before sourcing this file.

# --- Generic ---
log_event() {
    _etype="$1"; shift
    _ets=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "----")
    printf '%s %-8s %s\n' "$_ets" "$_etype" "$*" >> "$EVENTLOG"
}

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

trim_setting_value() {
    printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
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
    trim_setting_value "$1" | tr '[:upper:]' '[:lower:]'
}

get_private_dns_mode() {
    _mode=$(read_global_setting private_dns_mode 2>/dev/null || echo "")
    if [ -z "$_mode" ]; then
        _mode=$(read_global_setting private_dns_default_mode 2>/dev/null || echo "")
    fi
    _mode=$(normalize_private_dns_mode "$_mode")
    [ -n "$_mode" ] || _mode="opportunistic"
    echo "$_mode"
}

get_private_dns_hostname() {
    _host=$(read_global_setting private_dns_specifier 2>/dev/null || echo "")
    normalize_private_dns_hostname "$_host"
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
        [ -n "$_label" ] || return 1
        [ "${#_label}" -le 63 ] || return 1
        case "$_label" in
            -*|*-) return 1 ;;
        esac
    done
    return 0
}

# --- Telegram proxy (nztgproxy) ---
# Callers must define TGPROXY_CONF before using these helpers.
DEFAULT_TG_HOST="127.0.0.1"
DEFAULT_TG_PORT="1443"
DEFAULT_TG_DC_A="2:149.154.167.220"
DEFAULT_TG_DC_B="4:149.154.167.220"

# Write the original defaults if no config exists yet.
ensure_tgproxy_conf() {
    [ -f "$TGPROXY_CONF" ] && return 0
    {
        printf 'host=%s\n' "$DEFAULT_TG_HOST"
        printf 'port=%s\n' "$DEFAULT_TG_PORT"
        printf 'cf_enabled=1\n'
        printf 'cf_domain=\n'
        printf 'dc=%s\n' "$DEFAULT_TG_DC_A"
        printf 'dc=%s\n' "$DEFAULT_TG_DC_B"
    } > "$TGPROXY_CONF" 2>/dev/null
}

# get_tg_conf <key> [default] — first value for a single-value key.
get_tg_conf() {
    _tk="$1"; _tdef="$2"
    [ -f "$TGPROXY_CONF" ] || { printf '%s' "$_tdef"; return; }
    _tv=$(grep -m1 "^$_tk=" "$TGPROXY_CONF" 2>/dev/null | sed "s/^$_tk=//" | tr -d '\r')
    [ -n "$_tv" ] || _tv="$_tdef"
    printf '%s' "$_tv"
}

# Emit the `dc=` rules (one per line, without the prefix).
get_tg_dc_lines() {
    [ -f "$TGPROXY_CONF" ] || return 0
    grep '^dc=' "$TGPROXY_CONF" 2>/dev/null | sed 's/^dc=//' | tr -d '\r'
}

# Build the nztg argument string from the config (used unquoted for word-split;
# all values are space-free and validated by the CLI before being written).
tg_build_args() {
    printf ' --host %s --port %s' \
        "$(get_tg_conf host "$DEFAULT_TG_HOST")" \
        "$(get_tg_conf port "$DEFAULT_TG_PORT")"
    get_tg_dc_lines | while IFS= read -r _tdc; do
        [ -n "$_tdc" ] && printf ' --dc-ip %s' "$_tdc"
    done
    [ "$(get_tg_conf cf_enabled 1)" = "0" ] && printf ' --no-cfproxy'
    for _tcfd in $(get_tg_conf cf_domain ""); do
        [ -n "$_tcfd" ] && printf ' --cfproxy-domain %s' "$_tcfd"
    done
}
