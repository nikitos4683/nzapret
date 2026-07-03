#!/usr/bin/env bash
# nztgproxy — cross-compile static (CGO-free) binaries for Android.
# Output names mirror the nfqws2 convention: nztg-arm64, nztg-arm, nztg-x64, nztg-x86.
set -eu

cd "$(dirname "$0")"
OUT_DIR="${1:-build}"
mkdir -p "$OUT_DIR"

LDFLAGS="-s -w"
export CGO_ENABLED=0
export GOOS=linux

echo "[*] Building nztgproxy binaries -> $OUT_DIR"

GOARCH=arm64                 go build -trimpath -ldflags="$LDFLAGS" -o "$OUT_DIR/nztg-arm64" .
GOARCH=arm GOARM=7           go build -trimpath -ldflags="$LDFLAGS" -o "$OUT_DIR/nztg-arm"   .
GOARCH=amd64                 go build -trimpath -ldflags="$LDFLAGS" -o "$OUT_DIR/nztg-x64"   .
GOARCH=386                   go build -trimpath -ldflags="$LDFLAGS" -o "$OUT_DIR/nztg-x86"   .

echo "[+] Done:"
ls -la "$OUT_DIR"/nztg-*
