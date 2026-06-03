#!/system/bin/sh
# nzapret — common.sh
# Shared POSIX sh helpers sourced by service.sh and system/bin/nzapret.
# Contains only side-effect-free helpers that both files need identically.
# Callers must define their path constants (EVENTLOG, NETWORK_MODE_FILE,
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

# --- Network mode ---
normalize_network_mode() {
    case "$1" in
        ""|"auto") echo "auto" ;;
        "ipv4-only") echo "ipv4-only" ;;
        *) echo "" ;;
    esac
}

ipv6_network_available() {
    has_cmd ip || return 1
    ip -6 addr show scope global 2>/dev/null | grep -q 'inet6 ' || return 1
    ip -6 route get 2606:4700:4700::1111 >/dev/null 2>&1
}

detect_default_network_mode() {
    if ipv6_network_available; then
        echo "auto"
        return
    fi
    echo "ipv4-only"
}

get_configured_network_mode() {
    if [ -f "$NETWORK_MODE_FILE" ]; then
        _mode=$(head -n 1 "$NETWORK_MODE_FILE" 2>/dev/null | tr -d '\r\n')
        _mode=$(normalize_network_mode "$_mode")
        [ -n "$_mode" ] || _mode=$(detect_default_network_mode)
        echo "$_mode"
        return
    fi
    detect_default_network_mode
}

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
