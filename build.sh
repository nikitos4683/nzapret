#!/usr/bin/env bash

# Exit on any error
set -eu

echo "========================================"
echo "     nzapret Magisk Module Builder      "
echo "========================================"
echo ""

# Change to the directory where the script is located
cd "$(dirname "$0")"

PROJECT_ROOT=$(pwd)
STAGE_DIR=""

cleanup() {
    if [ -n "${STAGE_DIR:-}" ] && [ -d "$STAGE_DIR" ]; then
        rm -rf "$STAGE_DIR"
    fi
}

trap cleanup EXIT

if ! command -v zip >/dev/null 2>&1; then
    echo "[-] Error: 'zip' command not found!"
    exit 1
fi

if ! command -v sed >/dev/null 2>&1; then
    echo "[-] Error: 'sed' command not found!"
    exit 1
fi

if ! command -v mktemp >/dev/null 2>&1; then
    echo "[-] Error: 'mktemp' command not found!"
    exit 1
fi

MODULE_ENTRIES=(
    "action.sh"
    "customize.sh"
    "module.prop"
    "service.sh"
    "uninstall.sh"
    "bin"
    "lists"
    "META-INF"
    "payloads"
    "profiles"
    "system"
    "webroot"
)

echo "[*] Verifying module layout..."
for entry in "${MODULE_ENTRIES[@]}"; do
    if [ ! -e "$PROJECT_ROOT/$entry" ]; then
        echo "[-] Error: required module entry '$entry' not found in project root."
        exit 1
    fi
done

# Get version from module.prop
VERSION=$(grep '^version=' "$PROJECT_ROOT/module.prop" | cut -d= -f2 | tr -d '\r\n')
if [ -z "$VERSION" ]; then
    VERSION="custom"
fi

ZIP_NAME="nzapret-${VERSION}.zip"
ZIP_PATH="$PROJECT_ROOT/$ZIP_NAME"

echo "[*] Preparing staging directory..."
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nzapret-build.XXXXXX")

for entry in "${MODULE_ENTRIES[@]}"; do
    cp -a "$PROJECT_ROOT/$entry" "$STAGE_DIR/"
done

echo "[*] Normalizing line endings to LF (CRLF -> LF)..."
# We carefully target only text files. Binary files (like nfqws or .bin in payloads) MUST NOT be touched.
find "$STAGE_DIR" -type f \( \
    -name "*.sh" -o \
    -name "*.prop" -o \
    -name "*.txt" -o \
    -name "*.html" -o \
    -name "*.css" -o \
    -name "*.js" -o \
    -name "*.conf" -o \
    -name "updater-script" \
\) -exec sed -i 's/\r$//' {} +

# Explicitly fix extension-less text files
if [ -f "$STAGE_DIR/profiles/profile.current" ]; then
    sed -i 's/\r$//' "$STAGE_DIR/profiles/profile.current"
fi
if [ -f "$STAGE_DIR/system/bin/nzapret" ]; then
    sed -i 's/\r$//' "$STAGE_DIR/system/bin/nzapret"
fi
if [ -f "$STAGE_DIR/META-INF/com/google/android/update-binary" ]; then
    sed -i 's/\r$//' "$STAGE_DIR/META-INF/com/google/android/update-binary"
fi

echo "[*] Removing runtime artifacts from staging tree..."
rm -f \
    "$STAGE_DIR/.list_count" \
    "$STAGE_DIR/lists/list-user.txt" \
    "$STAGE_DIR/nzapret.log" \
    "$STAGE_DIR/nzapret.log.prev" \
    "$STAGE_DIR/nzapret-events.log"

echo "[*] Setting execution permissions..."
chmod +x "$STAGE_DIR/action.sh" 2>/dev/null || true
chmod +x "$STAGE_DIR/customize.sh" 2>/dev/null || true
chmod +x "$STAGE_DIR/service.sh" 2>/dev/null || true
chmod +x "$STAGE_DIR/uninstall.sh" 2>/dev/null || true
chmod +x "$STAGE_DIR/system/bin/nzapret" 2>/dev/null || true
chmod +x "$STAGE_DIR/META-INF/com/google/android/update-binary" 2>/dev/null || true
chmod +x "$STAGE_DIR/bin/"* 2>/dev/null || true

echo "[*] Creating zip archive..."
# Remove old archive if it exists
rm -f "$ZIP_PATH"

# Archive the contents of the staging directory (not the directory itself)
cd "$STAGE_DIR"
zip -r9 "$ZIP_PATH" . \
    -x "*.git*" \
    -x ".list_count" \
    -x "lists/list-user.txt" \
    -x "nzapret.log" \
    -x "nzapret.log.prev" \
    -x "nzapret-events.log" \
    -x "*.tmp" \
    -x "Thumbs.db" \
    -x ".DS_Store"
cd "$PROJECT_ROOT"

if [ -f "$ZIP_PATH" ]; then
    echo ""
    echo "[+] SUCCESS: Build complete!"
    echo "[+] Output: $ZIP_NAME"
else
    echo "[-] ERROR: Failed to create zip archive."
    exit 1
fi
