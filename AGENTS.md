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
- `build.sh`
  - Packaging helper: stages the module, normalizes text line endings to LF, removes runtime artifacts, and builds the ZIP.
- `.github/workflows/release.yml`
  - Manual GitHub Actions workflow that runs `bash build.sh` and publishes a release from `module.prop` version.

## Runtime Flow

1. The installer runs `customize.sh`, which unpacks the module, selects `bin/nfqws2-$ARCH`, renames it to `bin/nfqws2`, removes the unused binaries, and fixes permissions.
2. At boot, or via a manual CLI start, `service.sh` waits for Android boot completion, loads the active profile, recreates the `nzapret_out` chains in IPv4 and IPv6 `mangle`, and launches `nfqws2`.
3. `system/bin/nzapret` is the operator-facing interface. It wraps start/stop/restart, updates hostlists, switches profiles, exposes diagnostics, and returns JSON consumed by the WebUI.
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

- Profiles are both parsed and passed through.
  - `service.sh` only parses `# profile:`, `--qnum=`, `--filter-tcp=`, and `--filter-udp=` for labels and firewall rule generation.
  - All non-empty, non-comment profile lines are still passed directly to `nfqws2`.
  - Every usable profile must contain one `--qnum=` and at least one `--filter-tcp=` or `--filter-udp=`.

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
  - `nzapret diagnose --json` and `nzapret events --json` are also consumed by the UI.
  - If JSON schemas or command names change, update the WebUI in the same change.

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
  - `profiles/profile.current`, `.list_count`, `nzapret.log`, `nzapret.log.prev`, and `nzapret-events.log` are mutable artifacts.
  - Do not hardcode assumptions that these files are committed or always present in a fresh checkout.

- The update path is intentionally narrow.
  - `system/bin/nzapret update` refreshes `lists/list-general.txt` from the hardcoded upstream URL.
  - Empty or failed downloads must not replace a working list.

- The WebUI shells out directly.
  - Keep command strings shell-safe.
  - Favor stable stdout formats from CLI commands that the UI parses or displays.
  - Saving or updating hostlists must not assume a full service restart; the current runtime uses automatic reread and optional `SIGHUP`.

## Editing Guidance

### Shell And Runtime

- Prefer simple POSIX/Android `sh` constructs over clever shell tricks.
- Guard new external dependencies with `command -v` before use.
- Keep log messages and failures actionable; the WebUI and CLI rely on them for debugging.
- When changing cleanup or chain wiring, update verification logic everywhere it appears.

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
  - profile label
  - `domain_count`
  - `google_domain_count`
  - `user_domain_count`
  - `rules_v4`
  - `rules_v6`
- The personal list editor assumes hostlist saves do not trigger a restart.

### Packaging

- If you add a new top-level file or directory needed in the module ZIP, update `build.sh` `MODULE_ENTRIES`.
- If you add a new executable script, update permission handling in `customize.sh`.
- If you add a new text file type that must be normalized to LF before packaging, update `build.sh`.
- Keep runtime artifacts out of the packaged ZIP, but preserve the shipped empty `lists/list-user.txt`.

## Verification Checklist

Use the lightest safe verification available for the environment.

- Desktop or CI host:
  - Read the affected shell paths together before changing behavior.
  - Prefer syntax and static validation over trying to execute Android runtime scripts on a non-Android host.
  - For packaging changes, run `bash build.sh` from a Unix-like environment with `bash`, `zip`, `sed`, and `mktemp`.

- Android device with the module installed:
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status --json`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret diagnose`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret start`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret stop`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret restart`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret events --json --tail=30`

- After runtime or profile changes, verify:
  - exactly one `nfqws2` process is running,
  - IPv4 and IPv6 jumps exist for both `OUTPUT` and `FORWARD`,
  - `status --json` still parses,
  - the WebUI still renders runtime status, profile selection, diagnostics, and logs.

- After list update changes, verify:
  - `list-general.txt` is not replaced by an empty file,
  - cached domain counts refresh correctly,
  - a running service refreshes hostlists cleanly without requiring a restart.

- After packaging changes, verify:
  - the generated ZIP contains all required module entries,
  - executable bits are preserved for scripts and selected binaries,
  - no runtime logs or caches are accidentally shipped.

## Safe Defaults For Agents

- Prefer small, coordinated changes over broad rewrites.
- Search the whole repo before changing shared constants like chain names, JSON fields, or module paths.
- Do not claim a UI control or setting works unless you traced it into the CLI and runtime scripts.
- Preserve the current CLI/WebUI contract unless the task explicitly includes both sides of the change.
