# nzapret — customize.sh
# Magisk/KernelSU install-time customization hook.

SKIPUNZIP=1
MODULE_ID="nzapret"
BIN_DIR="$MODPATH/bin"
BACKUP_DIR="$MODPATH/.install-bak"
PROFILE_POINTER="profiles/profile.current"
# Mutable state carried across updates (paths relative to the module root).
PRESERVED_FILES="lists/list-user.txt tgproxy.conf .tg_secret $PROFILE_POINTER"

# Save mutable state before unzip overwrites module files.
# During updates, Magisk/KernelSU may install into a staging directory while the
# previously installed module still lives under /data/adb/modules/nzapret.
preserve_state() {
    rm -rf "$BACKUP_DIR"
    mkdir -p "$BACKUP_DIR" || abort "! Failed to prepare state backup"
    for _rel in $PRESERVED_FILES; do
        for _dir in "$MODPATH" "/data/adb/modules/$MODULE_ID" "/data/adb/modules_update/$MODULE_ID"; do
            [ -f "$_dir/$_rel" ] || continue
            # An empty profile pointer is not a selection; keep looking.
            [ "$_rel" = "$PROFILE_POINTER" ] && [ -z "$(head -n 1 "$_dir/$_rel" | tr -d '\r')" ] && continue
            cat "$_dir/$_rel" > "$BACKUP_DIR/${_rel##*/}" || abort "! Failed to preserve $_rel"
            break
        done
    done
}

# Put preserved state back over the fresh payload.
restore_state() {
    mkdir -p "$MODPATH/lists" "$MODPATH/profiles"
    for _rel in $PRESERVED_FILES; do
        _bak="$BACKUP_DIR/${_rel##*/}"
        [ -f "$_bak" ] || continue
        cat "$_bak" > "$MODPATH/$_rel" || abort "! Failed to restore $_rel"
    done
    rm -rf "$BACKUP_DIR"
    # Fresh installs get the shipped empty personal list.
    [ -f "$MODPATH/lists/list-user.txt" ] || : > "$MODPATH/lists/list-user.txt"
}

# Keep only the selected architecture binaries under their canonical runtime names.
select_arch_binaries() {
    [ -f "$BIN_DIR/nfqws2-$ARCH" ] || abort "! Unsupported architecture: $ARCH"
    mv -f "$BIN_DIR/nfqws2-$ARCH" "$BIN_DIR/nfqws2"
    [ -f "$BIN_DIR/nztg-$ARCH" ] && mv -f "$BIN_DIR/nztg-$ARCH" "$BIN_DIR/nztg"
    rm -f "$BIN_DIR"/nfqws2-* "$BIN_DIR"/nztg-*
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

preserve_state

ui_print "- Preparing module files..."
unzip -oq "$ZIPFILE" -x 'META-INF/*' -d "$MODPATH" || abort "! Failed to extract module files"

restore_state
select_arch_binaries
configure_permissions
