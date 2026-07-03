# nztgproxy

A minimal Go port of [tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy)'s
core, built as a **static, CGO-free** binary for on-device use inside the
`nzapret` Android module. It runs a local MTProto proxy that Telegram connects
to and bridges traffic to Telegram DCs over WSS (WebSocket-over-TLS), with a
direct-TCP fallback.

This is the Telegram-bypass engine, analogous to how `nfqws2` is the DPI engine.

## Status: MVP (proof-of-concept)

Ported (core path):
- MTProto obfuscated handshake decode (`tryHandshake`)
- Relay init generation + 4-stream AES-CTR re-encryption context
- WSS client (`wss://kws{dc}[-1].web.telegram.org/apiws` via the DC IP)
- Per-packet MTProto framing into WS frames (`splitter`)
- Bidirectional re-encrypting bridge
- Direct-TCP fallback to DC default IPs when WS is unavailable

Deferred (later iterations, disabled by default upstream too):
- Fake TLS (`ee`-secret) masking
- Cloudflare proxy / Worker fallbacks + domain balancer
- WS connection pool, DC blacklist/cooldowns, fronting

## Build

```sh
bash build.sh              # -> build/nztg-{arm64,arm,x64,x86}
go test ./...              # crypto + splitter unit tests
```

Binaries are `GOOS=linux CGO_ENABLED=0` static ELF — they run on the Android
kernel exactly like `nfqws2`. Arch names mirror the `nfqws2-*` convention.

## Usage

```
nztg [flags]
  --host        listen host (default 127.0.0.1)
  --port        listen port (default 1443)
  --secret      MTProto secret, 32 hex chars (random if empty)
  --secret-file read/persist the secret at this path (stable across restarts)
  --dc-ip       target IP for a DC, e.g. 2:149.154.167.220 (repeatable)
  --link-file   write the tg:// proxy link to this path
  --verbose     debug logging
```

On startup it prints a `tg://proxy?server=...&port=...&secret=dd...` link. Open
that link in Telegram (or add the proxy manually: MTProto, host, port, secret)
to route the client through the bridge.

## Manual on-device test (adb)

```sh
adb push build/nztg-arm64 /data/local/tmp/nztg
adb shell chmod 755 /data/local/tmp/nztg
adb shell /data/local/tmp/nztg --secret-file /data/local/tmp/nztg.secret \
    --link-file /data/local/tmp/nztg.link --verbose
# then open the printed tg:// link in Telegram on the device
```
