# nzapret — customize.sh
# Magisk/KernelSU install-time customization hook.

SKIPUNZIP=1
MODULE_ID="nzapret"
BIN_DIR="$MODPATH/bin"
NFQWS_BIN_DIR="$BIN_DIR/nfqws2"
TGWSPROXY_BIN_DIR="$BIN_DIR/tgwsproxy"
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

# Locates and caches the currently active profile identifier from either the staging
# directory or the live module path to preserve it across module upgrades and reinstalls.
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

# Backs up the mutable personal hostlist before the installation archive is extracted.
# Vital during module updates because Magisk/KernelSU may stage the new installation
# while the live data is still located at /data/adb/modules/nzapret.
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

# Cleans and validates the network mode string, returning an empty string if invalid.
normalize_network_mode() {
    _mode=$(printf '%s' "$1" | tr -d '\r\n')
    case "$_mode" in
        "auto"|"ipv4-only") echo "$_mode" ;;
        *) echo "" ;;
    esac
}

# Backs up the user's selected network stack mode (auto/ipv4-only) before the installation
# wipe, similar to how the user list is preserved.
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

# Ensures all necessary structural directories exist before dropping artifacts into them.
prepare_directories() {
    mkdir -p "$BIN_DIR" "$NFQWS_BIN_DIR" "$TGWSPROXY_BIN_DIR" "$LISTS_DIR" "$PROFILE_DIR"
}

# Recovers the user's personal hostlist from the backup made during extraction.
# On a completely fresh install, it ensures an empty file exists to prevent startup errors.
restore_user_list() {
    if [ -f "$PRESERVED_USER_LIST_FILE" ]; then
        cat "$PRESERVED_USER_LIST_FILE" > "$USER_LIST_FILE" || abort "! Failed to restore user list"
    fi
    [ -f "$USER_LIST_FILE" ] || : > "$USER_LIST_FILE"
    rm -f "$PRESERVED_USER_LIST_FILE"
}

# Recovers the user's selected network stack mode from the backup made during extraction.
restore_network_mode() {
    if [ -f "$PRESERVED_NETWORK_MODE_FILE" ]; then
        _mode=$(normalize_network_mode "$(head -n 1 "$PRESERVED_NETWORK_MODE_FILE" 2>/dev/null)")
        if [ -n "$_mode" ]; then
            printf '%s\n' "$_mode" > "$NETWORK_MODE_FILE" || abort "! Failed to restore network mode"
        fi
    fi
    rm -f "$PRESERVED_NETWORK_MODE_FILE"
}

# Writes the previously cached profile identifier back into the state file
# so the module boots with the same profile that was active before the update.
restore_active_profile() {
    if [ -n "$PRESERVED_PROFILE" ]; then
        printf '%s\n' "$PRESERVED_PROFILE" > "$ACTIVE_PROFILE_FILE" || abort "! Failed to restore active profile"
    fi
}

# Identifies the correct architecture-specific binary and renames it to the
# canonical path expected by the runtime. Aborts if the architecture is unsupported.
select_required_arch_binary() {
    _dir="$1"
    _name="$2"
    if [ -f "$_dir/$_name-$ARCH" ]; then
        mv "$_dir/$_name-$ARCH" "$_dir/$_name"
    else
        abort "! Unsupported architecture for $_name: $ARCH"
    fi
}

# Renames the correct architecture-specific binary if it exists.
# If no supported variant exists, silently removes all variants since it is strictly optional.
select_optional_arch_binary() {
    _dir="$1"
    _name="$2"
    [ -d "$_dir" ] || return 0
    if [ -f "$_dir/$_name-$ARCH" ]; then
        mv "$_dir/$_name-$ARCH" "$_dir/$_name"
        return 0
    fi
    rm -f "$_dir"/"$_name"-*
    return 0
}

# Orchestrates the selection of all platform-specific executable binaries.
select_arch_binaries() {
    select_required_arch_binary "$NFQWS_BIN_DIR" "nfqws2"
    select_optional_arch_binary "$TGWSPROXY_BIN_DIR" "tgwsproxy"
}

# Deletes all non-selected architecture variants from the target directory to save
# space and keep the module payload clean.
cleanup_unused_binaries_in_dir() {
    _dir="$1"
    _name="$2"
    [ -d "$_dir" ] || return 0
    for _bin_file in "$_dir"/*; do
        [ -e "$_bin_file" ] || continue
        [ "$_bin_file" = "$_dir/$_name" ] && continue
        rm -f "$_bin_file"
    done
}

# Removes left-over files from older module versions to prevent structural drift.
cleanup_legacy_bin_layout() {
    rm -f "$BIN_DIR"/nfqws2-*
    rm -f "$BIN_DIR"/tgwsproxy-*
    rm -f "$BIN_DIR/nfqws2"
    rm -f "$BIN_DIR/tgwsproxy"
}

# Bundles all cleanup tasks to purge unneeded legacy artifacts and unused arch binaries.
cleanup_unused_binaries() {
    cleanup_unused_binaries_in_dir "$NFQWS_BIN_DIR" "nfqws2"
    cleanup_unused_binaries_in_dir "$TGWSPROXY_BIN_DIR" "tgwsproxy"
    cleanup_legacy_bin_layout
}

# Strictly defines filesystem permissions. Scripts are made executable, ensuring
# the Core/CLI commands work correctly without manual chmod interventions.
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

# ==================================
# Module Assembly and Finalization
# ==================================
# Rebuild the module layout from the fresh payload, restore mutable state,
# clean up space, and lock down runtime scripts.
prepare_directories
restore_user_list
restore_network_mode
restore_active_profile
select_arch_binaries
cleanup_unused_binaries
configure_permissions
