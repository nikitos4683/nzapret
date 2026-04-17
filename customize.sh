SKIPUNZIP=1
MODULE_ID="nzapret"
BIN_DIR="$MODPATH/bin"
LISTS_DIR="$MODPATH/lists"
PROFILE_DIR="$MODPATH/profiles"
ACTIVE_PROFILE_FILE="$MODPATH/profiles/profile.current"
NETWORK_MODE_FILE="$PROFILE_DIR/network.mode"
USER_LIST_FILE="$LISTS_DIR/list-user.txt"
LIVE_MODULE_DIR="/data/adb/modules/$MODULE_ID"
UPDATE_MODULE_DIR="/data/adb/modules_update/$MODULE_ID"
PRESERVED_USER_LIST_FILE="$MODPATH/.list-user.install.bak"
PRESERVED_NETWORK_MODE_FILE="$MODPATH/.network-mode.install.bak"
PRESERVED_PROFILE=""

# Preserve the selected profile across module upgrades/reinstalls.
read_preserved_profile() {
    PRESERVED_PROFILE=""
    for _profile_candidate in \
        "$ACTIVE_PROFILE_FILE" \
        "$LIVE_MODULE_DIR/profiles/profile.current" \
        "$UPDATE_MODULE_DIR/profiles/profile.current"
    do
        [ -f "$_profile_candidate" ] || continue
        IFS= read -r PRESERVED_PROFILE < "$_profile_candidate" || PRESERVED_PROFILE=""
        PRESERVED_PROFILE=$(printf '%s' "$PRESERVED_PROFILE" | tr -d '\r')
        [ -n "$PRESERVED_PROFILE" ] && return
    done
}

# Save the mutable personal list before unzip overwrites module files.
# During updates, Magisk/KernelSU may install into a staging directory while the
# previously installed module still lives under /data/adb/modules/nzapret.
preserve_user_list() {
    rm -f "$PRESERVED_USER_LIST_FILE"
    for _list_candidate in \
        "$USER_LIST_FILE" \
        "$LIVE_MODULE_DIR/lists/list-user.txt" \
        "$UPDATE_MODULE_DIR/lists/list-user.txt"
    do
        [ -f "$_list_candidate" ] || continue
        [ "$_list_candidate" = "$PRESERVED_USER_LIST_FILE" ] && continue
        cat "$_list_candidate" > "$PRESERVED_USER_LIST_FILE" || abort "! Failed to preserve user list"
        return
    done
}

normalize_network_mode() {
    _mode=$(printf '%s' "$1" | tr -d '\r\n')
    case "$_mode" in
        "auto"|"ipv4-only") echo "$_mode" ;;
        *) echo "" ;;
    esac
}

preserve_network_mode() {
    rm -f "$PRESERVED_NETWORK_MODE_FILE"
    for _mode_candidate in \
        "$NETWORK_MODE_FILE" \
        "$LIVE_MODULE_DIR/profiles/network.mode" \
        "$UPDATE_MODULE_DIR/profiles/network.mode"
    do
        [ -f "$_mode_candidate" ] || continue
        _mode=$(normalize_network_mode "$(head -n 1 "$_mode_candidate" 2>/dev/null)")
        [ -n "$_mode" ] || continue
        printf '%s\n' "$_mode" > "$PRESERVED_NETWORK_MODE_FILE" || abort "! Failed to preserve network mode"
        return
    done
}

prepare_directories() {
    mkdir -p "$BIN_DIR" "$LISTS_DIR" "$PROFILE_DIR"
}

# Restore the preserved personal list, or create the shipped empty file on fresh install.
restore_user_list() {
    if [ -f "$PRESERVED_USER_LIST_FILE" ]; then
        cat "$PRESERVED_USER_LIST_FILE" > "$USER_LIST_FILE" || abort "! Failed to restore user list"
    fi
    [ -f "$USER_LIST_FILE" ] || : > "$USER_LIST_FILE"
    rm -f "$PRESERVED_USER_LIST_FILE"
}

restore_network_mode() {
    if [ -f "$PRESERVED_NETWORK_MODE_FILE" ]; then
        _mode=$(normalize_network_mode "$(head -n 1 "$PRESERVED_NETWORK_MODE_FILE" 2>/dev/null)")
        if [ -n "$_mode" ]; then
            printf '%s\n' "$_mode" > "$NETWORK_MODE_FILE" || abort "! Failed to restore network mode"
        fi
    fi
    rm -f "$PRESERVED_NETWORK_MODE_FILE"
}

# Restore the previous active profile pointer if one existed.
restore_active_profile() {
    if [ -n "$PRESERVED_PROFILE" ]; then
        printf '%s\n' "$PRESERVED_PROFILE" > "$ACTIVE_PROFILE_FILE" || abort "! Failed to restore active profile"
    fi
}

# Keep only the selected architecture binary under the canonical runtime name.
select_arch_binary() {
    if [ -f "$BIN_DIR/nfqws2-$ARCH" ]; then
        mv "$BIN_DIR/nfqws2-$ARCH" "$BIN_DIR/nfqws2"
    else
        abort "! Unsupported architecture: $ARCH"
    fi
}

# Strip all unused architecture binaries from the installed module tree.
cleanup_unused_binaries() {
    for _bin_file in "$BIN_DIR"/*; do
        [ -e "$_bin_file" ] || continue
        [ "$_bin_file" = "$BIN_DIR/nfqws2" ] && continue
        rm -f "$_bin_file"
    done
}

configure_permissions() {
    ui_print "- Configuring runtime for $ARCH..."
    set_perm_recursive "$MODPATH" 0 0 0755 0644
    set_perm_recursive "$BIN_DIR" 0 0 0755 0755
    set_perm_recursive "$MODPATH/system/bin" 0 0 0755 0755
    set_perm "$MODPATH/service.sh" 0 0 0755
    set_perm "$MODPATH/uninstall.sh" 0 0 0755
    set_perm "$MODPATH/action.sh" 0 0 0755
}

read_preserved_profile
preserve_user_list
preserve_network_mode

ui_print "- Preparing module files..."
unzip -oq "$ZIPFILE" -x 'META-INF/*' -d "$MODPATH" || abort "! Failed to extract module files"

# Rebuild the module layout from the fresh payload, then restore mutable state.
prepare_directories
restore_user_list
restore_network_mode
restore_active_profile
select_arch_binary
cleanup_unused_binaries
configure_permissions
