<div align="center">

# ✈️ nztgproxy (nztg)

**A lightweight Go-based MTProto proxy for bypassing Telegram blocks on Android**

[![Language](https://img.shields.io/badge/Language-Go-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Linux-2ea44f?style=flat-square)](https://android.com)
[![CGO](https://img.shields.io/badge/CGO-CGO--free-1f6feb?style=flat-square)](https://golang.org/cmd/cgo/)
[![Protocol](https://img.shields.io/badge/Protocol-MTProto%20%E2%86%92%20WSS-f59e0b?style=flat-square)](https://core.telegram.org/mtproto)
[![Status](https://img.shields.io/badge/Status-MVP%20%2F%20Stable-8b5cf6?style=flat-square)](https://github.com/nikitos4683/nzapret/tree/nztg)

[![Русский](https://img.shields.io/badge/%D0%9F%D0%B5%D1%80%D0%B5%D0%B2%D0%BE%D0%B4-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue?style=flat-square&logo=google-translate&logoColor=white)](README.md)

</div>

---

**nztgproxy** (binary name: `nztg`) is a lightweight, static, and CGO-free proxy server written in Go. It is a port of the core from the [tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy) project and is designed to act as the DPI-bypass engine for Telegram within the **`nzapret`** Android module.

Just like `nfqws2` serves as the DPI engine for web traffic, `nztg` handles maintaining stable Telegram connections to its Datacenters (DCs) over WebSocket-over-TLS (WSS) with direct TCP fallback and Cloudflare proxy support.

---

## ⚡ Key Features

* **🔄 WebSocket-over-TLS (WSS):** Wraps standard MTProto traffic into secure WebSocket frames to evade DPI signature analysis and IP-based blocks.
* **☁️ Cloudflare Proxy Fallback:** Automatically falls back to Cloudflare Workers / CDN Fronting if direct Telegram WebSocket server IPs are blocked by your ISP.
* **🔌 Smart DNS Resolver:** Built-in resolution using public DNS servers (`1.1.1.1`, `8.8.8.8`, `9.9.9.9`) to circumvent the lack of a proper `/etc/resolv.conf` in Android environments when CGO is disabled.
* **🍃 CGO-free Static ELF:** Compiled with `CGO_ENABLED=0` to run seamlessly on any Android kernel without dependencies on system dynamic libraries.
* **📦 Complete Integration:** Tailored to be run and managed automatically by the `nzapret` module CLI commands.

---

## 🚦 Current Implementation Status (MVP)

### ✅ Completed:
- [x] Obfuscated MTProto handshake decoding (`tryHandshake`).
- [x] Relay initialization generation + 4-stream AES-CTR encryption context.
- [x] WSS client (`wss://kws{dc}[-1].web.telegram.org/apiws` via the DC IP).
- [x] Packet-by-packet MTProto framing into WebSockets (`splitter`).
- [x] Bidirectional re-encrypting bridge.
- [x] Direct TCP fallback to Telegram's default DC IPs if WSS is blocked.
- [x] Cloudflare proxy availability test (`cftest`).
- [x] Domain balancer (sticky per-DC domain + shuffled pool fallback).

### ⏳ Planned (Backlog):
- [ ] Reusable WebSocket connection pool.

---

## 🛠 Compilation / Build

You can cross-compile static binaries for all major Android architectures using the build script:

```sh
# Cross-compiles for Android (builds build/nztg-{arm64,arm,x64,x86})
bash build.sh

# Run unit tests (verifies crypto & packet splitter)
go test ./...
```

The resulting binaries in the `build` directory follow the `nfqws2-*` naming convention.

---

## ⚙️ CLI Flags and Commands

The binary supports several configuration flags and diagnostic subcommands.

### 📋 Subcommands (evaluated first):
* `nztg gensecret` — Generates a random 32-character hex MTProto secret and prints it to stdout.
* `nztg cftest [flags]` — Tests the connection status and availability of the Cloudflare proxy.

---

### 🎛 Launch Flags:
| Flag | Default Value | Description |
| :--- | :--- | :--- |
| `--host <ip>` | `127.0.0.1` | The local address to listen on for incoming client connections. |
| `--port <n>` | `1443` | The local port to listen on. |
| `--secret <hex>` | *(Random)* | A 32-character hex-encoded MTProto secret. |
| `--secret-file <path>`| *(None)* | File path to read from or persist the secret to (useful across restarts). |
| `--dc-ip <DC:IP>` | *(Default IPs)* | Destination Telegram DC IP rule in `ID:IP` format (repeatable). |
| `--cfproxy-domain <host>`| *(None)* | Custom Cloudflare-proxied domain for the WS fallback (repeatable). |
| `--no-cfproxy` | `false` | Disables the Cloudflare proxy fallback. |
| `--link-file <path>` | *(None)* | Writes the generated `tg://proxy?...` link to this path. |
| `--verbose` | `false` | Enables detailed debug logs. |

---

## 📱 Manual On-Device Testing (ADB)

> [!TIP]
> You can manually run and test the proxy on your Android device via ADB without installing the entire Magisk/KernelSU module first.

```sh
# 1. Push the appropriate binary to a temp directory on the device
adb push build/nztg-arm64 /data/local/tmp/nztg

# 2. Grant executable permissions
adb shell chmod 755 /data/local/tmp/nztg

# 3. Launch the proxy with debug logging and secret persistence
adb shell /data/local/tmp/nztg \
    --secret-file /data/local/tmp/nztg.secret \
    --link-file /data/local/tmp/nztg.link \
    --verbose
```

Once running, copy the generated `tg://proxy` link from the log or the specified file, and open it in your Telegram client on the device to test.

---

## 🧩 Codebase Directory Structure

The server codebase is organized into modular files:

* 🔌 [main.go](main.go) — Entry point, flag parsing, TCP listener startup, and system signal handling.
* 🌁 [bridge.go](bridge.go) — Data transfer bridge (pipe) logic between the Telegram client and servers.
* ☁️ [cfproxy.go](cfproxy.go) — Cloudflare integration and proxy testing logic.
* 🔐 [crypto.go](crypto.go) — Obfuscated MTProto decoding and AES-CTR-128 cryptographic operations.
* 📡 [dns.go](dns.go) — Custom name resolver bypassing default DNS limits on Android.
* ✂️ [splitter.go](splitter.go) — Packet framing logic slicing MTProto packets into WebSocket frames.
* 🌐 [websocket.go](websocket.go) — TLS WebSocket connection initialization with custom headers.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). See the [LICENSE](LICENSE) file for more information.

---

<div align="center">
  <b>🌍 Enjoy open Internet and seamless Telegram access!</b>
</div>
