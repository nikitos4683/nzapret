SKIPUNZIP=1

ui_print "- Preparing module files..."
unzip -oq "$ZIPFILE" -x 'META-INF/*' -d "$MODPATH" || abort "! Failed to extract module files"

mkdir -p "$MODPATH/bin"

if [ -f "$MODPATH/bin/nfqws-$ARCH" ]; then
    mv "$MODPATH/bin/nfqws-$ARCH" "$MODPATH/bin/nfqws"
else
    abort "! Unsupported architecture: $ARCH"
fi

rm -f "$MODPATH"/bin/nfqws-*

ui_print "- Configuring runtime for $ARCH..."
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm_recursive "$MODPATH/bin" 0 0 0755 0755
set_perm_recursive "$MODPATH/system/bin" 0 0 0755 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
set_perm "$MODPATH/action.sh" 0 0 0755
