<div align="center">

<a href="README.md">Русский</a> | <b>English</b>

# 🚀 nzapret by nikitos4683

**DPI-bypass module for Android (Magisk / KernelSU)**

![Android](https://img.shields.io/badge/Platform-Android-2ea44f?style=for-the-badge)
![Root](https://img.shields.io/badge/Root-Magisk%20%7C%20KernelSU-1f6feb?style=for-the-badge)
![Engine](https://img.shields.io/badge/Engine-nfqws2%20%7C%20nztg-f59e0b?style=for-the-badge)
![UI](https://img.shields.io/badge/UI-KernelSU%20WebUI-8b5cf6?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-v3.2.0-blue?style=for-the-badge)

</div>

---

**nzapret** is an autonomous and lightweight module for rooted Android devices. The module is **based on [zapret2](https://github.com/bol-van/zapret2)**, using the local `nfqws2` engine and `iptables`/`ip6tables` rules for DPI bypass, as well as the built-in `nztg` proxy to unblock Telegram.

The `nfqws2` binaries, payloads, and routing lists are sourced from the original upstream, the `nztg` proxy server is built on a custom Go implementation, and the entire wrapper code is written from scratch for Android — offering a convenient WebUI and avoiding system bloat.

---

## 📌 Table of Contents

- [✨ Key Features](#-key-features)
- [🚧 Limitations and Known Issues](#-limitations-and-known-issues)
- [🚀 Quick Start](#-quick-start)
- [🏗 Architecture and Structure](#-architecture-and-structure)
- [🛠 Module Compilation](#-module-compilation)
- [📄 License](#-license)

---

## ✨ Key Features

- **Built-in WebUI:** A convenient and beautiful graphical interface right inside the KernelSU module manager.
- **Powerful CLI:** Complete module management via terminal.
- **Smart Routing:** Intercepts traffic in the `OUTPUT` and `FORWARD` chains for both IPv4 and IPv6.
- **Auto-determined IP Stack:** The module automatically spins up interception rules for IPv4 and, if `ip6tables` is supported, for IPv6 — without requiring manual selection.
- **Telegram Bypass:** A built-in local MTProto proxy (`nztgproxy`) with WebSocket-over-TLS bridging and Cloudflare fallback, managed alongside the main service.
- **Private DNS Management:** Automatic DNS initialization and provider switching from WebUI/CLI.
- **Personal `list-user`:** A user's custom domain list, editable directly from the interface.
- **VPN Compatibility:** Support for working alongside most popular VPN clients.
- **Autonomous:** The module uses local data and does not require internet connectivity on boot.

<details>
<summary>⚙️ Detailed Network, DNS, and Telegram Logic (for geeks)</summary>

- **Network Stack:** The module always brings up DPI interception for IPv4, and for IPv6 when `ip6tables` (mangle table) is supported on the device. There is no separate mode selector and it is not needed: idle IPv6 rules cost nothing when IPv6 traffic is absent and are ready to protect IPv6 as soon as it comes up later (e.g., on Wi-Fi/cellular handovers). This eliminates the legacy issue where in "IPv4-only mode" traffic (e.g., YouTube or Instagram) would leak over IPv6 past the bypass.
- **Private DNS:** Initialized once during the first service start. If a valid third-party DNS provider is already configured in "Hostname" mode on the system, it is preserved. In other cases ("Disabled", "Auto", or empty), it defaults to `xbox-dns.ru` (required to bypass DNS blocks for AI services like ChatGPT, Gemini, etc.). Manual DNS changes via CLI or WebUI are saved and not reset on subsequent starts.
- **Telegram Proxy (nztgproxy):** A local Go-based MTProto proxy (static, CGO-free `nztg` binary). It accepts incoming MTProto connections from the Telegram client, decodes the obfuscated handshake, and bridges traffic to the official Telegram DCs over WSS (WebSocket-over-TLS) to bypass DPI IP blocks. Supports direct TCP fallback and Cloudflare Worker / CDN fronting (CF proxy) to route traffic through the Cloudflare network if the direct WebSocket server IPs of Telegram are blocked by the ISP.

</details>

---

## 🚧 Limitations and Known Issues

> [!NOTE]
> **Telegram:** The module includes a built-in local MTProto proxy (`nztgproxy`) to bypass Telegram blocks. After starting the module, open the **Telegram** tab in WebUI and click **"Open in Telegram"** (or copy the link/enter `127.0.0.1:1443` and Secret manually). If Telegram IPs are blocked by the provider, traffic goes through the Cloudflare proxy automatically. If media fails to load, remove the `2:149.154.167.220` line in the DC configuration.

> [!NOTE]
> **KernelSU WebUI Bug:** Due to KernelSU manager specifics, `nfqws2` and `nztg` processes started *manually* via the **Start** button in WebUI may be terminated by the system when KernelSU is swiped away from recent apps. This bug is fixed in KernelSU-Next (see issue [#1180](https://github.com/KernelSU-Next/KernelSU-Next/issues/1180))! For standard KernelSU, it is recommended to use the **Action** button in the module list or run `nzapret start` in a terminal.

---

## 🚀 Quick Start

### 1. Installation
1. Download the pre-built `ZIP` archive from the Releases page.
2. Flash it standardly via **Magisk** or **KernelSU**.
3. Reboot the device.
4. Open the modules tab in KernelSU to access the **WebUI**. *(Magisk users will need the [KsuWebUI](https://github.com/KOWX712/KsuWebUIStandalone) app to use the interface).*

### 2. CLI Usage
Managing via CLI requires root privileges (`su`). If the `nzapret` command is not in your PATH, use the full path: `/data/adb/modules/nzapret/system/bin/nzapret`.

#### 🔌 Service Management
| Command | Description |
| :--- | :--- |
| `nzapret start` | Initialize iptables rules and start `nfqws2` |
| `nzapret stop` | Stop service processes and clean up firewall chains |
| `nzapret restart` | Full restart applying changed settings |

#### 📊 Monitoring and Diagnostics
| Command | Description |
| :--- | :--- |
| `nzapret status` | View current state and service status |
| `nzapret status --json` | JSON status output (for WebUI) |
| `nzapret log` | View system service log |
| `nzapret diagnose` | Gather detailed diagnostic information for debugging |

#### 🌐 Network and Private DNS
| Command | Description |
| :--- | :--- |
| `nzapret update` | Download and update bypass lists (hostlists) |
| `nzapret network status` | Show active firewall stack (IPv4 / IPv4 + IPv6) |
| `nzapret dns status` | Show current state of Android Private DNS |
| `nzapret dns set default` | Set default DNS (`xbox-dns.ru`) |
| `nzapret dns set auto` | Revert to system auto DNS mode |
| `nzapret dns set off` | Fully disable system Private DNS |
| `nzapret dns set hostname <host>` | Set custom DNS provider host |

#### 📝 User List Management (`list-user`)
| Command | Description |
| :--- | :--- |
| `nzapret list-user status` | Show list status and domain count |
| `nzapret list-user show` | Display current list contents |
| `nzapret list-user add <domains...>` | Add one or more domains to the list |
| `nzapret list-user remove <domains...>` | Remove specified domains from the list |
| `nzapret list-user replace <domains...>` | Overwrite the list with new domains |
| `nzapret list-user clear` | Fully clear the user list |

#### ✈️ Telegram (`tg`)
| Command | Description |
| :--- | :--- |
| `nzapret tg status` | Show proxy status, secret, and link |
| `nzapret tg status --json` | Status in JSON format (for WebUI) |
| `nzapret tg link` | Output `tg://` link for connecting |
| `nzapret tg open` | Open Telegram with the configured proxy |
| `nzapret tg regen-secret` | Generate a new secret |
| `nzapret tg cf-test` | Check Cloudflare proxy availability |
| `nzapret tg set host <ip>` | Set listening address |
| `nzapret tg set port <n>` | Set port |
| `nzapret tg set cf <on\|off>` | Enable/disable Cloudflare fallback |
| `nzapret tg set cf-domain <domain>` | Set custom CF domain (empty to reset) |
| `nzapret tg set dc <"n:IP..">` | Set DC rules (one rule per line) |

> The Telegram service starts and stops together with the module (`start`/`stop`/`restart`). Setting modifications are applied after restart.

---

## 🏗 Architecture and Structure

| File / Directory | Description |
| :--- | :--- |
| ⚙️ [service.sh](service.sh) | System autostart script. Configures firewall rules and runs `nfqws2`. |
| 🧠 [system/bin/nzapret](system/bin/nzapret) | Controlling CLI interface. Handles start, stop commands, and metric collection for WebUI. |
| ✈️ [bin/nztg](bin/) | Local MTProto proxy for Telegram (Go, static binary). Runs alongside nfqws2. |
| 🎨 [webroot/](webroot/) | WebUI code (HTML, CSS, JS) integrated into KernelSU. |
| 📁 [profiles/](profiles/) | Configuration profiles containing arguments for `nfqws2`. |
| 📁 [lists/](lists/) | Domain routing lists (including user's `list-user.txt`). |
| 📁 [payloads/](payloads/) | Binary fake payloads (TLS/QUIC) for DPI bypass. |
| 🛠 [customize.sh](customize.sh) | Module installer (detects device architecture, unpacks and sets permissions). |

---

## 🛠 Module Compilation

If you want to build the module yourself, you need basic utilities installed on your system (Linux/WSL): `bash`, `zip`, `sed`, `mktemp`.

The build process is launched with a single command:
```sh
bash build.sh
```
The flashable `nzapret-vX.Y.Z.zip` archive will be created in the root directory. You can build it on the device (e.g., in Termux) or on a PC.

---

## 📄 License

This project is distributed under the [MIT](LICENSE) license. Detailed information can be found in the [LICENSE](LICENSE) file.

---

<div align="center">
  <b>🌍 Enjoy open Internet!</b>
</div>
