# AGENTS.md

## Project Summary

This repository contains the module payload for the Android `nzapret` Magisk/KernelSU module. The module bypasses DPI on Android by:

- installing an architecture-specific `nfqws` binary,
- creating IPv4/IPv6 `iptables`/`ip6tables` NFQUEUE rules,
- launching `nfqws` with arguments from a selected profile,
- exposing a shell CLI and a small KernelSU WebUI for control and diagnostics.

This is not a general app repo. Most behavior lives in shell scripts plus static assets and data files.

## Repository Map

- `module.prop`
  - Module metadata shown by Magisk/KernelSU.
- `customize.sh`
  - Install-time extraction, architecture selection, permission setup.
- `service.sh`
  - Main runtime entrypoint for boot/manual start. Rebuilds firewall state and launches `nfqws`.
- `uninstall.sh`
  - Stop/cleanup logic. Used both for uninstall and for CLI `stop`.
- `action.sh`
  - Quick toggle action. Delegates to the CLI.
- `system/bin/nzapret`
  - Main CLI for lifecycle control, diagnostics, manual list updates, profile switching, and `status --json` for the WebUI.
- `profiles/*.conf`
  - `nfqws` profiles. Only `profiles/default.conf` exists in the current tree.
- `lists/`
  - Static host/IP lists shipped with the module.
- `payloads/*.bin`
  - Binary fake TLS/QUIC/STUN payloads referenced by profiles.
- `bin/nfqws-*`
  - Architecture-specific binaries. `customize.sh` renames the selected one to `bin/nfqws` at install time.
- `webroot/`
  - KernelSU WebUI (`index.html`, `style.css`, `kernelsu.js`).
- `utils/`
  - Mutable state such as `profile.current`.
- `META-INF/com/google/android/*`
  - Magisk installer glue.
- `build.sh`
  - Packaging helper with line-ending normalization and zip creation.

## Runtime Flow

1. `META-INF/com/google/android/update-binary` loads Magisk `util_functions.sh` and runs the module install flow.
2. `customize.sh` unzips the module, picks `bin/nfqws-$ARCH`, renames it to `bin/nfqws`, removes the unused binaries, and sets permissions.
3. `service.sh` waits for boot, loads the active profile, rebuilds `nzapret_out` chains in both IPv4 and IPv6 `mangle`, and starts `nfqws`.
4. `system/bin/nzapret` is the operator-facing interface. It wraps start/stop/restart, performs manual list updates, switches profiles, exposes diagnostics, and returns JSON status for the UI.
5. `webroot/index.html` talks to the CLI via `ksu.exec(...)`; it does not manage module internals directly.

## Critical Invariants

- Keep Android runtime scripts POSIX/Android `sh` compatible.
  - `service.sh`, `uninstall.sh`, `action.sh`, and `system/bin/nzapret` all run under `#!/system/bin/sh`.
  - Avoid bash-only syntax in those files.
  - `build.sh` is the only script intentionally written for bash.

- The installed module path is hardcoded in multiple places.
  - `system/bin/nzapret` uses `MODDIR="/data/adb/modules/nzapret"`.
  - `profiles/default.conf` hardcodes `/data/adb/modules/nzapret/...` paths.
  - `webroot/index.html` also uses `/data/adb/modules/nzapret`.
  - Renaming the module ID or install path is a coordinated change, not a one-file edit.

- `system/bin/nzapret` owns all network-facing update logic.
  - Manual list/IPSet refreshes and manual version checks live in the CLI.
  - `service.sh` should stay local-only at boot and manual start time.

- Profiles are both parsed and passed through.
  - `service.sh` parses only `# profile:`, `--qnum=`, `--filter-tcp=`, and `--filter-udp=` to build firewall rules and labels.
  - All non-empty, non-comment profile lines are then passed directly to `nfqws`.
  - Every usable profile must contain at least one `--qnum=` and at least one `--filter-tcp=` or `--filter-udp=`.

- WebUI depends on the CLI JSON contract.
  - `webroot/index.html` expects `nzapret status --json` to return these fields:
    - `version`
    - `active`
    - `pid`
    - `pid_count`
    - `rules_v4`
    - `rules_v6`
    - `domain_count`
    - `ipset_count`
    - `profile`
    - `profile_label`
  - If you change that JSON schema, update the WebUI in the same change.

- Do not modify binaries casually.
  - `bin/nfqws-*` and `payloads/*.bin` are opaque binary assets.
  - Treat them as replace-only artifacts unless the task explicitly requires binary work.

- Preserve LF line endings in text files.
  - `build.sh` normalizes text files to LF before packaging.
  - Do not run CRLF conversion across `bin/` or `payloads/`.

## Current Reality And Traps

- The current checkout is not a git repository.
  - There is no `.git/` directory here.
  - Do not assume `git status`, `git diff`, or branch-based workflows are available.

- `build.sh` stages the module from the repository root.
  - It copies the known module files and directories into a temporary staging directory.
  - It normalizes text line endings and strips runtime artifacts in staging, not in the working tree.
  - If you add new top-level module entries, update `build.sh` so they are copied into staging.

- The product is intentionally trimmed for Android-first usage.
  - There is no interactive CLI menu anymore.
  - `game-filter`, `auto-update`, and source-editing were removed from the CLI and WebUI.
  - Keep new controls tightly coupled to actual Android runtime behavior.

- `ipset-all.txt` and the exclude/user list files are not part of the active runtime path today.
  - `system/bin/nzapret` updates, counts, and diagnoses `lists/ipset-all.txt`.
  - `service.sh` creates `list-general-user.txt`, `list-exclude-user.txt`, and `ipset-exclude-user.txt` placeholders.
  - The shipped `profiles/default.conf` only references `list-general.txt` and `list-google.txt`.
  - Current `service.sh` logic does not consume `ipset-all.txt`, `list-exclude.txt`, `ipset-exclude.txt`, or the `*-user.txt` files when building firewall state.
  - Treat those files as partially integrated unless you explicitly wire them into runtime behavior.

## Editing Guidance

### Shell Runtime Changes

- When changing lifecycle behavior, inspect both:
  - `service.sh`
  - `system/bin/nzapret`

- Keep start/stop idempotent.
  - `service.sh` and `uninstall.sh` both rely on safe repeated cleanup of the `nzapret_out` chains.
  - If you change rule naming or chain wiring, update cleanup and verification logic everywhere.

- Respect Android command availability.
  - Runtime scripts assume tools like `iptables`, `ip6tables`, `killall`, `curl`, `pgrep`, `tail`, and `ip` may or may not exist.
  - Prefer explicit `command -v` checks before introducing new dependencies.

### Profile Changes

- Keep one `nfqws` argument per line.
- Use comments sparingly, but preserve the `# profile:` label convention for human/UI naming.
- Use installed absolute paths inside profiles, not repo-relative paths.
- If you add a new profile file under `profiles/`, the CLI and WebUI will discover it automatically through `profile list`.

### WebUI Changes

- The UI shells out through `ksu.exec`, so command strings must stay shell-safe.
- Keep CLI outputs stable when possible; the UI polls status every 5 seconds and log output every 3 seconds when expanded.
- Prefer runtime control and diagnostics over configuration-heavy settings panels.
- Do not add UI toggles unless they map to real behavior in `service.sh` or the active profile.

### List And Source Changes

- Manual updates are CLI-owned.
  - `system/bin/nzapret update ...` downloads and refreshes `list-general.txt` and `ipset-all.txt`.
  - `service.sh` does not download lists or perform version checks at boot.
- If you change default source URLs or appended domains, update `system/bin/nzapret`.

### Packaging Changes

- If you add new executable scripts, update permission handling in `customize.sh`.
- If you add new text file types that must be normalized before zipping, update `build.sh`.
- If you fix the root-vs-`module/` packaging mismatch, document that change here as well.

## Verification Checklist

Use the lightest safe verification available for the environment.

- On a desktop/non-Android host:
  - Prefer static inspection over executing runtime scripts directly.
  - Be careful with shell syntax, quoting, and path hardcoding.

- On an Android device with the module installed:
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret status --json`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret diagnose`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret start`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret stop`
  - `sh /data/adb/modules/nzapret/system/bin/nzapret restart`

- After profile or firewall changes, verify:
  - exactly one `nfqws` process is running,
  - both IPv4 and IPv6 jumps exist for `OUTPUT` and `FORWARD`,
  - `status --json` still parses,
  - the WebUI still renders the status card and profile selector.

- After list update changes, verify:
  - `list-general.txt` still ends with `encryptedsni.com` and `adblockplus.org` after updates,
  - cached counts still refresh,
  - update commands do not clobber files with empty downloads.

## Safe Defaults For Agents

- Prefer minimal, coordinated changes over broad rewrites.
- Do not claim a setting is effective unless you traced it into `service.sh` and/or the active profile.
- When touching duplicated constants or path assumptions, search the whole repo first.
- When in doubt, preserve the CLI/WebUI contract and the current Android install path behavior.
