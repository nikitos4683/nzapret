# AGENTS.md

## Project Summary

This repository contains the source tree for the Android `nzapret` Magisk/KernelSU module. The module bypasses DPI on Android by:

- installing an architecture-specific `nfqws2` binary,
- creating IPv4/IPv6 `iptables` and `ip6tables` NFQUEUE rules,
- launching `nfqws2` with arguments from the active profile,
- exposing a shell CLI and a KernelSU WebUI for control and diagnostics.

This is not a conventional app repository. Most behavior lives in shell scripts plus static assets and packaged data files.

## Repository Map

- `module.prop`
  - Module metadata and version source for releases.
- `customize.sh`
  - Install-time extraction, architecture selection, binary rename, and permission setup.
- `common.sh`
  - Shared POSIX `sh` helpers sourced by `service.sh` and `system/bin/nzapret` (logging, network-mode, IPv6 detection, Private DNS, Android settings I/O). Sourced, not executed.
- `service.sh`
  - Main runtime entrypoint for boot/manual start. Rebuilds firewall state and launches `nfqws2`.
- `uninstall.sh`
  - Stop/cleanup logic. Used for uninstall and CLI `stop`.
- `action.sh`
  - Quick toggle action for Magisk/KernelSU. Delegates to the CLI.
- `system/bin/nzapret`
  - Main CLI for lifecycle control, diagnostics, list refresh, profile switching, and JSON output for the WebUI.
- `profiles/*.conf`
  - `nfqws2` argument profiles. The current tree ships `profiles/default.conf`.
- `lists/`
  - Hostlists used by the active profile. `list-user.txt` is shipped as an empty file in the module ZIP.
- `payloads/*.bin`
  - Fake TLS/QUIC payloads referenced by profiles.
- `lua/*.lua`
  - Upstream `nfqws2` helper libraries loaded by profiles via `--lua-init`.
- `bin/nfqws2-*`
  - Architecture-specific binaries. `customize.sh` renames the selected one to `bin/nfqws2` during install.
- `webroot/`
  - KernelSU WebUI (`index.html`, `style.css`, `kernelsu.js`).
- `META-INF/com/google/android/*`
  - Installer glue for the flashable module ZIP.
- `profiles/profile.current`
  - Mutable active-profile pointer consumed by runtime and CLI.
- `profiles/network.mode`
  - Mutable network-stack mode generated on device. Contains `auto` or `ipv4-only`; it is intentionally not shipped in release ZIPs.
- `build.sh`
  - Packaging helper: stages the module, normalizes text line endings to LF, removes runtime artifacts, and builds the ZIP.
- `.github/release-notes/*.md`
  - Versioned release bodies. A release for `module.prop` version `vX.Y.Z` requires `.github/release-notes/vX.Y.Z.md`.
- `.github/workflows/release.yml`
  - Manual GitHub Actions workflow that runs `bash build.sh`, requires the matching versioned release notes file, generates `update.json`, and publishes a release from `module.prop` version.

## Runtime Flow

1. The installer runs `customize.sh`, which unpacks the module, selects `bin/nfqws2-$ARCH`, renames it to `bin/nfqws2`, removes the unused binaries, and fixes permissions.
2. At boot, or via a manual CLI start, `service.sh` waits for Android boot completion, ensures mutable runtime files exist, initializes Android Private DNS once, resolves the network stack mode, loads the active profile, recreates the `nzapret_out` chains in IPv4 and optionally IPv6 `mangle`, and launches `nfqws2`.
3. `system/bin/nzapret` is the operator-facing interface. It wraps start/stop/restart, updates hostlists, switches profiles, manages network mode and Android Private DNS, exposes diagnostics, and returns JSON consumed by the WebUI.
4. `webroot/index.html` talks to the CLI through `ksu.exec(...)`; it does not mutate module internals directly.

## Critical Invariants

- Keep runtime scripts compatible with Android `sh`.
  - `service.sh`, `uninstall.sh`, `action.sh`, and `system/bin/nzapret` all use `#!/system/bin/sh`.
  - Avoid bash-only syntax in those files.
  - `build.sh` is the only script intentionally written for bash.

- Treat the installed module path as a coordinated constant.
  - `system/bin/nzapret` hardcodes `MODDIR="/data/adb/modules/nzapret"`.
  - `profiles/default.conf` and `profiles/profile.current` live under `/data/adb/modules/nzapret/profiles/...`.
  - `webroot/index.html` also shells out against `/data/adb/modules/nzapret`.
  - Changing module ID or install path requires synchronized updates across multiple files.

- Keep boot-time behavior local-only.
  - `service.sh` should not download lists or depend on the network.
  - List refresh belongs to `system/bin/nzapret update`.
  - The boot service may read/write local Android global settings for Private DNS, but must guard the `settings` command and must not require external connectivity.

- Profiles are both parsed and passed through.
  - `service.sh` only parses `# profile:`, `--qnum=`, `--filter-tcp=`, and `--filter-udp=` for labels and firewall rule generation.
  - All non-empty, non-comment profile lines are still passed directly to `nfqws2`.
  - Every usable profile must contain one `--qnum=` and at least one `--filter-tcp=` or `--filter-udp=`.

- Preserve Network Stack semantics.
  - `profiles/network.mode` stores only `auto` or `ipv4-only`.
  - Missing or invalid `profiles/network.mode` is normalized by first-run detection: use `auto` only when `ipv6_network_available` succeeds; otherwise prefer `ipv4-only`.
  - Manual `nzapret network set auto` must be rejected when the current device/network has no working IPv6 route. The WebUI mirrors this by locking the Auto option when `status --json` returns `ipv6_available=false`.
  - Runtime IPv6 firewall rules are enabled only when the configured mode is not `ipv4-only` and both `ipv6_network_available` and `ip6tables_supported` pass.
  - If you change IPv6 detection or network-mode behavior, update `service.sh`, `system/bin/nzapret`, WebUI status handling, diagnostics, and README together.

- Preserve Android Private DNS semantics.
  - The module default provider hostname is `xbox-dns.ru`.
  - `service.sh` initializes Private DNS only once, tracked by `.private_dns_initialized`.
  - If Android is already in provider-hostname mode with a valid hostname, preserve it. Otherwise the first service start sets `xbox-dns.ru`.
  - Manual CLI/WebUI DNS changes (`off`, `auto`, `default`, or custom `hostname`) mark Private DNS initialized and must not be overwritten on later starts.
  - Use Android global settings carefully: `private_dns_mode`, `private_dns_default_mode`, and `private_dns_specifier`. Android automatic mode is represented as `opportunistic`.

- Preserve the CLI/WebUI JSON contract.
  - `nzapret status --json` currently returns:
    - `version`
    - `active`
    - `pid`
    - `pid_count`
    - `rules_v4`
    - `rules_v6`
    - `domain_count`
    - `google_domain_count`
    - `user_domain_count`
    - `user_list_attached`
    - `profile`
    - `profile_label`
    - `network_mode`
    - `network_mode_label`
    - `ipv6_available`
    - `ipv6_enabled`
    - `private_dns_available`
    - `private_dns_initialized`
    - `private_dns_mode`
    - `private_dns_mode_label`
    - `private_dns_hostname`
    - `private_dns_label`
    - `private_dns_default_hostname`
  - `nzapret diagnose --json` and `nzapret events --json` are also consumed by the UI.
  - If JSON schemas or command names change, update the WebUI in the same change.

- Preserve release metadata flow.
  - `module.prop` `version=` is the source for the GitHub release tag, ZIP name, required release-notes filename, and generated `update.json`.
  - `.github/workflows/release.yml` requires `.github/release-notes/${version}.md`; do not silently generate fallback release notes.
  - The GitHub Release body uses the same versioned release notes file via `body_path`.
  - `update.json` `changelog` must point to the raw GitHub file URL on `main`: `https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/main/.github/release-notes/${version}.md`.

- Do not edit opaque artifacts casually.
  - `bin/nfqws2-*` and `payloads/*.bin` are binary assets.
  - Treat them as replace-only artifacts unless the task explicitly requires binary changes.

- Preserve LF line endings for packaged text files.
  - `build.sh` normalizes shell/config/web text files to LF in staging.
  - Do not apply blanket CRLF conversions to the repo, especially not under `bin/` or `payloads/`.

## Android-Specific Traps

- Lifecycle changes are cross-file by default.
  - If you change start logic in `service.sh`, also inspect `system/bin/nzapret`, `uninstall.sh`, and `action.sh`.
  - Start/stop must remain idempotent: cleanup loops intentionally remove duplicate jump rules from both `OUTPUT` and `FORWARD`.

- Firewall assumptions are explicit.
  - The custom chain name is `nzapret_out`.
  - IPv4 and IPv6 are both configured.
  - `service.sh` intentionally bypasses loopback and common VPN interfaces (`lo`, `tun+`, `wg+`, `tap+`).

- Runtime state is generated inside the module directory.
  - `profiles/profile.current`, `profiles/network.mode`, `.private_dns_initialized`, `.list_count`, `nzapret.log`, `nzapret.log.prev`, and `nzapret-events.log` are mutable artifacts.
  - Do not hardcode assumptions that these files are committed or always present in a fresh checkout.
  - `customize.sh` preserves `lists/list-user.txt` and `profiles/network.mode` across module updates from both live and staged module directories.

- The update path is intentionally narrow.
  - `system/bin/nzapret update` refreshes `lists/list-general.txt` from the hardcoded upstream URL.
  - Empty or failed downloads must not replace a working list.

- The WebUI shells out directly.
  - Keep command strings shell-safe.
  - Favor stable stdout formats from CLI commands that the UI parses or displays.
  - Saving or updating hostlists must not assume a full service restart; the current runtime uses automatic reread and optional `SIGHUP`.
  - Network Stack changes must go through `nzapret network set`; when the service is active, the WebUI saves and restarts, otherwise it only saves.
  - Private DNS controls must go through `nzapret dns set ...`; do not write Android settings directly from JavaScript.

## Editing Guidance

### Shell And Runtime

- Prefer simple POSIX/Android `sh` constructs over clever shell tricks.
- Guard new external dependencies with `command -v` before use.
- Keep log messages and failures actionable; the WebUI and CLI rely on them for debugging.
- When changing cleanup or chain wiring, update verification logic everywhere it appears.
- Shared, side-effect-free helpers (logging, network-mode, IPv6 availability, hostname validation, Private DNS, Android settings I/O) live in `common.sh`, sourced by both `service.sh` and `system/bin/nzapret`. Add new shared helpers there instead of duplicating them; keep file-specific behavior (e.g. `fail`/`require_cmd` error semantics, `ensure_*`) local to each script.
- `common.sh` assumes the sourcing script has already defined the path constants it uses (`EVENTLOG`, `NETWORK_MODE_FILE`, `PRIVATE_DNS_INIT_FILE`, `DEFAULT_PRIVATE_DNS_HOSTNAME`). Source it after those constants. New top-level files like `common.sh` must be added to `build.sh` `MODULE_ENTRIES`.

### Profiles

- Keep one `nfqws2` argument per line.
- Preserve the `# profile:` header convention for user-facing labels.
- Use installed absolute paths inside profiles, not repo-relative paths.
- New `profiles/*.conf` files are auto-discovered by `nzapret profile list` and the WebUI profile selector.

### WebUI

- `webroot/index.html` is the real app; `kernelsu.js` is only a thin bridge over `ksu.exec`.
- Keep the UI aligned with actual CLI capabilities instead of adding mock controls.
- If you add a new operator feature, prefer implementing it in the CLI first and then wiring the UI to it.
- The runtime status card currently shows:
  - network mode label
  - Private DNS label
  - `domain_count`
  - `google_domain_count`
  - `user_domain_count`
  - `rules_v4`
  - `rules_v6`
- Routing Profile UI is intentionally hidden while only the default profile ships; profile CLI support still exists.
- The Network Stack selector is draft-based and uses a Save button. Keep the unsaved-changes hint and IPv6-unavailable hint aligned with `status --json`.
- Event-dot colors are semantic: blue/accent for neutral events, green for enabling/successful additions, red for disabling/errors.
- The personal list editor assumes hostlist saves do not trigger a restart.

### Packaging

- If you add a new top-level file or directory needed in the module ZIP, update `build.sh` `MODULE_ENTRIES`.
- If you add a new executable script, update permission handling in `customize.sh`.
- If you add a new text file type that must be normalized to LF before packaging, update `build.sh`.
- Keep runtime artifacts out of the packaged ZIP, but preserve the shipped empty `lists/list-user.txt`.
- `build.sh` must exclude generated runtime state such as `.private_dns_initialized`, `.list-user.install.bak`, `.network-mode.install.bak`, logs, `.list_count`, and `profiles/network.mode`.
- Every releasable `module.prop` version must have a matching `.github/release-notes/<version>.md` before running the release workflow.

## Verification Checklist

Use the lightest safe verification available for the environment.

- Desktop or CI host:
  - Read the affected shell paths together before changing behavior.
  - Prefer syntax and static validation over trying to execute Android runtime scripts on a non-Android host.
  - For packaging changes, run `bash build.sh` from a Unix-like environment with `bash`, `zip`, `sed`, and `mktemp`.

- Android device with the module installed:
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status --json`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret network status`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret dns status`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret diagnose`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret start`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret stop`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret restart`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret events --json --tail=30`

- After runtime or profile changes, verify:
  - exactly one `nfqws2` process is running,
  - IPv4 jumps exist for both `OUTPUT` and `FORWARD`,
  - IPv6 jumps exist for both `OUTPUT` and `FORWARD` only when `ipv6_enabled=true`,
  - `status --json` still parses,
  - `ipv6_available`, `ipv6_enabled`, network mode, and Private DNS fields match the device state,
  - the WebUI still renders runtime status, Network Stack, Private DNS, diagnostics, and logs.

- After list update changes, verify:
  - `list-general.txt` is not replaced by an empty file,
  - cached domain counts refresh correctly,
  - a running service refreshes hostlists cleanly without requiring a restart.

- After packaging changes, verify:
  - the generated ZIP contains all required module entries,
  - executable bits are preserved for scripts and selected binaries,
  - no runtime logs, caches, install backups, `.private_dns_initialized`, or `profiles/network.mode` are accidentally shipped.

- After release workflow changes, verify:
  - `.github/release-notes/${version}.md` exists for the `module.prop` version,
  - release body uses that file,
  - generated `update.json` points `zipUrl` at the release ZIP and `changelog` at the raw GitHub `refs/heads/main/.github/release-notes/${version}.md` URL.

## Safe Defaults For Agents

- Prefer small, coordinated changes over broad rewrites.
- Search the whole repo before changing shared constants like chain names, JSON fields, or module paths.
- Do not claim a UI control or setting works unless you traced it into the CLI and runtime scripts.
- Preserve the current CLI/WebUI contract unless the task explicitly includes both sides of the change.
