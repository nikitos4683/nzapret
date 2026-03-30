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

MODULE_ENTRIES=(
    "action.sh"
    "customize.sh"
    "lua"
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

TEXT_FILE_PATTERNS=(
    "*.sh"
    "*.prop"
    "*.txt"
    "*.html"
    "*.css"
    "*.js"
    "*.lua"
    "*.conf"
    "updater-script"
)

EXTRA_TEXT_FILES=(
    "profiles/profile.current"
    "system/bin/nzapret"
    "META-INF/com/google/android/update-binary"
)

RUNTIME_ARTIFACTS=(
    ".list_count"
    "nzapret.log"
    "nzapret.log.prev"
    "nzapret-events.log"
)

EXECUTABLE_PATHS=(
    "action.sh"
    "customize.sh"
    "service.sh"
    "uninstall.sh"
    "system/bin/nzapret"
    "META-INF/com/google/android/update-binary"
)

cleanup() {
    if [ -n "${STAGE_DIR:-}" ] && [ -d "$STAGE_DIR" ]; then
        rm -rf "$STAGE_DIR"
    fi
}

trap cleanup EXIT

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "[-] Error: '$1' command not found!"
        exit 1
    fi
}

verify_module_layout() {
    echo "[*] Verifying module layout..."
    for entry in "${MODULE_ENTRIES[@]}"; do
        if [ ! -e "$PROJECT_ROOT/$entry" ]; then
            echo "[-] Error: required module entry '$entry' not found in project root."
            exit 1
        fi
    done
}

prepare_staging_dir() {
    echo "[*] Preparing staging directory..."
    STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nzapret-build.XXXXXX")

    # Stage a clean copy so packaging never mutates the working tree.
    for entry in "${MODULE_ENTRIES[@]}"; do
        cp -a "$PROJECT_ROOT/$entry" "$STAGE_DIR/"
    done
}

normalize_line_endings() {
    echo "[*] Normalizing line endings to LF (CRLF -> LF)..."
    find_args=()
    for pattern in "${TEXT_FILE_PATTERNS[@]}"; do
        find_args+=( -name "$pattern" -o )
    done
    unset 'find_args[${#find_args[@]}-1]'
    # Only normalize known text files. Binary payloads and nfqws2 artifacts stay untouched.
    # shellcheck disable=SC2016
    find "$STAGE_DIR" -type f \( "${find_args[@]}" \) -exec sed -i 's/\r$//' {} +

    # Extension-less text files still need explicit normalization.
    for file in "${EXTRA_TEXT_FILES[@]}"; do
        if [ -f "$STAGE_DIR/$file" ]; then
            sed -i 's/\r$//' "$STAGE_DIR/$file"
        fi
    done
}

remove_runtime_artifacts() {
    echo "[*] Removing runtime artifacts from staging tree..."
    # Do not ship logs, caches, or other mutable runtime state in the module ZIP.
    for artifact in "${RUNTIME_ARTIFACTS[@]}"; do
        rm -f "$STAGE_DIR/$artifact"
    done
}

set_execution_permissions() {
    echo "[*] Setting execution permissions..."
    for file in "${EXECUTABLE_PATHS[@]}"; do
        chmod +x "$STAGE_DIR/$file" 2>/dev/null || true
    done
    for bin_file in "$STAGE_DIR"/bin/*; do
        [ -e "$bin_file" ] || continue
        chmod +x "$bin_file" 2>/dev/null || true
    done
}

create_zip_archive() {
    echo "[*] Creating zip archive..."
    rm -f "$ZIP_PATH"

    # Archive the staged contents, not the stage directory itself.
    cd "$STAGE_DIR"
    zip -r9 "$ZIP_PATH" . \
        -x "*.git*" \
        -x ".list_count" \
        -x "nzapret.log" \
        -x "nzapret.log.prev" \
        -x "nzapret-events.log" \
        -x "*.tmp" \
        -x "Thumbs.db" \
        -x ".DS_Store"
    cd "$PROJECT_ROOT"
}

require_cmd zip
require_cmd sed
require_cmd mktemp
verify_module_layout

# Use module.prop as the single source of truth for release versioning.
VERSION=$(grep '^version=' "$PROJECT_ROOT/module.prop" | cut -d= -f2 | tr -d '\r\n')
if [ -z "$VERSION" ]; then
    VERSION="custom"
fi

ZIP_NAME="nzapret-${VERSION}.zip"
ZIP_PATH="$PROJECT_ROOT/$ZIP_NAME"

prepare_staging_dir
normalize_line_endings
remove_runtime_artifacts
set_execution_permissions
create_zip_archive

if [ -f "$ZIP_PATH" ]; then
    echo ""
    echo "[+] SUCCESS: Build complete!"
    echo "[+] Output: $ZIP_NAME"
else
    echo "[-] ERROR: Failed to create zip archive."
    exit 1
fi
