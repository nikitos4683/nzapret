SKIPUNZIP=1
BIN_DIR="$MODPATH/bin"
LISTS_DIR="$MODPATH/lists"
PROFILE_DIR="$MODPATH/profiles"
ACTIVE_PROFILE_FILE="$MODPATH/profiles/profile.current"
USER_LIST_FILE="$LISTS_DIR/list-user.txt"
PRESERVED_USER_LIST_FILE="$MODPATH/.list-user.install.bak"
PRESERVED_PROFILE=""

# Preserve the selected profile across module upgrades/reinstalls.
read_preserved_profile() {
    if [ -f "$ACTIVE_PROFILE_FILE" ]; then
        IFS= read -r PRESERVED_PROFILE < "$ACTIVE_PROFILE_FILE" || PRESERVED_PROFILE=""
    fi
    PRESERVED_PROFILE=$(printf '%s' "$PRESERVED_PROFILE" | tr -d '\r')
}

# Save the mutable personal list before unzip overwrites module files.
preserve_user_list() {
    rm -f "$PRESERVED_USER_LIST_FILE"
    if [ -f "$USER_LIST_FILE" ]; then
        cat "$USER_LIST_FILE" > "$PRESERVED_USER_LIST_FILE" || abort "! Failed to preserve user list"
    fi
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

# Restore the previous active profile pointer if one existed.
restore_active_profile() {
    if [ -n "$PRESERVED_PROFILE" ]; then
        printf '%s\n' "$PRESERVED_PROFILE" > "$ACTIVE_PROFILE_FILE" || abort "! Failed to preserve active profile"
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

ui_print "- Preparing module files..."
unzip -oq "$ZIPFILE" -x 'META-INF/*' -d "$MODPATH" || abort "! Failed to extract module files"

# Rebuild the module layout from the fresh payload, then restore mutable state.
prepare_directories
restore_user_list
restore_active_profile
select_arch_binary
cleanup_unused_binaries
configure_permissions
