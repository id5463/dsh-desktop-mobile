# DSH Desktop & Mobile

Native desktop GUI + Android remote control for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — the open-source AI coding agent where *everything is a plugin*.

> A community project, not an official DeepSeek product.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F.svg)](desktop/)
[![Android](https://img.shields.io/badge/android-APK-3DDC84.svg)](android/)

**Read this in:** English · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## What you get

| | Desktop app | Android app |
|---|---|---|
| What | Native Electron window around the official DSH Web UI | Remote control for your DSH from anywhere |
| Setup | Zero-config: auto-installs Node.js + DSH on first run (progress bar included) | Install the APK, scan a QR code |
| Remote | Short code + QR pairing, UPnP auto port-forwarding, WebRTC P2P | Same-LAN auto discovery + Internet remote |

### Desktop

- **Zero-setup boot**: if Node.js or DSH is missing, the app downloads and installs them automatically with a progress bar. Double-click and go.
- **Full DSH Web UI** in a native window, with system tray, server restart, and language switching (中文 / English).
- **LAN sharing**: the app proxies DSH onto your LAN (HTTP + WebSocket) and advertises it via mDNS, so your phone finds it automatically.
- **Remote pairing**: open the connection window to see a short code (no `dsh-` prefix) and a QR code. Scan it from the phone app to connect.
- **Zero-config remote access**: the app can auto-forward a port on your router via UPnP and publish your public IP, so an Internet phone can reach it directly without touching your router settings.
- **WebRTC P2P fallback**: when direct access is not possible, an encrypted peer-to-peer channel (with TURN relay fallback) is negotiated automatically.

### Android

- Scan the QR code or type the short code from the desktop app.
- Auto-discovery of desktops on the same Wi-Fi (mDNS).
- Full DSH Web UI on your phone — start tasks, watch agent progress, approve tool calls, send follow-ups.
- Works over the Internet through P2P/relay — no registration, no account, nothing to configure.

## Quick start

### Desktop

Prerequisites: Node.js ≥ 18 (the app can also bootstrap its own runtime).

```bash
cd desktop
npm install
npm start
```

On first run the app checks for DSH, downloads it if needed (progress bar), and opens the Web UI.

### Android

Grab the prebuilt APK at `android/dist/dsh-mobile-debug.apk` and sideload it (enable "install unknown apps"), or build it yourself:

```powershell
cd android
.\build-apk-aapt.ps1    # produces dist/dsh-mobile-debug.apk, no Android Studio/Gradle needed
```

Open the app → the desktop connection window shows a code + QR → scan with the phone → connected.

## How remote connection works

1. The desktop generates a short code (e.g. `K7X9`) and shows a QR.
2. Signaling runs over MQTT (a free public broker by default; you can point both apps at your own broker).
3. The phone and desktop negotiate a WebRTC connection; if both ends are behind NAT, UPnP port forwarding or a TURN relay bridges them.
4. Traffic flows end-to-end (or through the relay) — no account, no registration.

### A note about ISP port restrictions

The app works on normal broadband and mobile networks. Some mobile ISPs (for example China Mobile's data network in mainland China) transparently intercept or block **non-standard inbound ports**; on such a network a direct inbound connection may be refused. That is a carrier policy, not an app limitation — on those networks use a same-LAN connection, a different carrier, or point both apps at your own MQTT/TURN server.

## Project layout

```
desktop/   Electron desktop app (Node.js, Electron, mqtt.js, simple-peer)
android/   Android app (Java WebView, local proxy, QR scanner, mDNS, WebRTC)
```

## Roadmap

- [ ] Own relay server (WAN relay through your own infrastructure)
- [ ] iOS app
- [ ] Package the remote/gateway as an installable `dsh` plugin (`dsh plugin add`)
- [ ] Token-based gateway auth (see community merge below)

## Community feature merge (permissive licenses)

We benchmarked the DSH desktop & mobile ecosystem and are adopting the best features from **MIT-licensed** projects (feature-level merge with attribution; any future code copies keep the original license notices):

| Feature | Source (MIT unless noted) | Status |
| --- | --- | --- |
| Token gateway auth — per-device one-time token, per-IP rate limiting, first-visit approval, DSH stays on 127.0.0.1 | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) · [dsh-mobile-gate](https://github.com/Bernardxu123/dsh-mobile-gate) | **shipped** (LAN gate + gateway) |
| File transfer — list / upload (2 GB) / download with Range resume, path-traversal protection | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | **shipped** (gateway `/fs/*`) |
| Multi-server with speed-test auto-switch (LAN / Tailscale / WAN) | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | planned |
| Offline chat cache on the phone | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | planned |
| Native mobile pages — sessions / approvals / questions / goals | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | planned |
| Auto-update — client updates + upstream core sync with rollback | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) · [hairyf Tauri](https://github.com/hairyf/deepseek-harness-desktop) · [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | **shipped** (client update check) |
| Task-complete system notification (click to focus window) | [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | planned |
| Tray one-click restart of DSH (kill process tree + relaunch) | [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | **shipped** |
| Security hardening — random loopback port, sandbox, navigation restrictions | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | planned |
| PWA mode — add-to-home-screen, offline shell, Web Push notifications, touch gestures | [dsh-mobile-pwa](https://github.com/zylzyqzz/dsh-mobile-pwa) | planned |
| `crypto.randomUUID` polyfill for plain-HTTP origins (LAN) | [dsh-web-lan-access](https://github.com/AcidGr/dsh-web-lan-access) | planned |
| Third-party model provider setup wizard (pick provider → API key → auto route) | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | planned |
| Portable `.dshpreset` agent-preset packages (import/export with trust warning) | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | planned |
| Balance / cost widget in the conversation stats bar | inspired by [EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC) (no license file — feature only, no code) | planned |
| UI skins (one-click theme switching) | inspired by [EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC) · [ChisaAlter](https://github.com/ChisaAlter/Deepseek-Harness-Desktop) (feature only) | planned |

> Everything already shipped in our apps (LAN proxy + mDNS, QR/short-code pairing, UPnP auto-forwarding, WebRTC P2P with TURN) stays — this list is additive.

## Security

Remote access exposes your local DSH to the network. The desktop app only enables remote features when you open the connection window; for Internet access behind a router, UPnP port-forwarding runs on startup in this early version — make sure you trust your network, and consider disabling it in public environments. A token-based auth layer is planned.

## License

[MIT](LICENSE). Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). Not affiliated with or endorsed by DeepSeek.
