# DSH Desktop & Mobile

Native Desktop-GUI + Android-Fernsteuerung für [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — den Open-Source-KI-Coding-Agenten, bei dem *alles ein Plugin ist*.

> Ein Community-Projekt, kein offizielles DeepSeek-Produkt.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F.svg)](desktop/)
[![Android](https://img.shields.io/badge/android-APK-3DDC84.svg)](android/)

**Sprachen:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · Deutsch · [Русский](README.ru.md)

---

## Was du bekommst

| | Desktop-App | Android-App |
|---|---|---|
| Was | Natives Electron-Fenster um die offizielle DSH-Web-UI | Fernsteuerung für dein DSH von überall |
| Einrichtung | Null-Konfiguration: installiert Node.js + DSH automatisch beim ersten Start (mit Fortschrittsbalken) | APK installieren, QR-Code scannen |
| Fernzugriff | Kurzcode + QR-Kopplung, UPnP-Portweiterleitung, WebRTC P2P | Automatische LAN-Erkennung + Fernzugriff über das Internet |

### Desktop

- **Start ohne Konfiguration**: Fehlt Node.js oder DSH, lädt die App beides automatisch herunter und installiert es (mit Fortschrittsbalken). Doppelklick und los.
- **Vollständige DSH-Web-UI** in einem nativen Fenster, mit Systray, Server-Neustart und Sprachumschaltung (中文 / English).
- **LAN-Freigabe**: Die App proxyt DSH in dein LAN (HTTP + WebSocket) und bewirbt es per mDNS, sodass dein Telefon es automatisch findet.
- **Fern-Kopplung**: Öffne das Verbindungsfenster, um einen Kurzcode (ohne `dsh-`-Präfix) und einen QR-Code zu sehen. Scanne ihn mit der Telefon-App, um dich zu verbinden.
- **Fernzugriff ohne Konfiguration**: Die App kann per UPnP automatisch einen Port am Router freischalten und deine öffentliche IP veröffentlichen, sodass ein Telefon im Internet direkt zugreifen kann, ohne die Router-Einstellungen anzufassen.
- **WebRTC-P2P-Fallback**: Ist der direkte Zugriff nicht möglich, wird automatisch ein verschlüsselter Peer-to-Peer-Kanal (mit TURN-Relay-Fallback) ausgehandelt.

### Android

- Scanne den QR-Code oder tippe den Kurzcode aus der Desktop-App ein.
- Automatische Erkennung von Desktops im selben Wi-Fi (mDNS).
- Vollständige DSH-Web-UI auf dem Telefon: Aufgaben starten, Agentenfortschritt beobachten, Tool-Aufrufe genehmigen, Nachfragen senden.
- Funktioniert über das Internet per P2P/Relay — keine Registrierung, kein Konto, nichts zu konfigurieren.

## Schnellstart

### Desktop

Voraussetzung: Node.js ≥ 18 (die App kann auch ihre eigene Laufzeit bereitstellen).

```bash
cd desktop
npm install
npm start
```

Beim ersten Start prüft die App DSH, lädt es bei Bedarf herunter (Fortschrittsbalken) und öffnet die Web-UI.

### Android

Nimm die vorgebaute APK unter `android/dist/dsh-mobile-debug.apk` und sideloade sie („Unbekannte Apps installieren" erlauben), oder baue sie selbst:

```powershell
cd android
.\build-apk-aapt.ps1    # erzeugt dist/dsh-mobile-debug.apk, ohne Android Studio/Gradle
```

Öffne die App → das Verbindungsfenster des Desktops zeigt Code + QR → mit dem Telefon scannen → verbunden.

## So funktioniert die Fernverbindung

1. Der Desktop erzeugt einen Kurzcode (z. B. `K7X9`) und zeigt einen QR.
2. Die Signalisierung läuft über MQTT (standardmäßig ein kostenloser öffentlicher Broker; du kannst beide Apps auf deinen eigenen Broker zeigen lassen).
3. Telefon und Desktop handeln eine WebRTC-Verbindung aus; sind beide hinter NAT, verbinden UPnP-Portweiterleitung oder ein TURN-Relay sie.
4. Der Datenverkehr fließt Ende-zu-Ende (oder über das Relay) — kein Konto, keine Registrierung.

### Hinweis zu ISP-Portbeschränkungen

Die App funktioniert in normalen Festnetz- und Mobilfunknetzen. Einige Mobilfunk-ISPs (z. B. das Datennetz von China Mobile im chinesischen Festland) fangen **nicht standardmäßige eingehende Ports** transparent ab oder blockieren sie; in solchen Netzen kann eine direkte eingehende Verbindung abgelehnt werden. Das ist eine Netzbetreiber-Policy, keine Einschränkung der App — nutze in solchen Netzen eine LAN-Verbindung, einen anderen Betreiber oder richte beide Apps auf deinen eigenen MQTT/TURN-Server aus.

## Projektstruktur

```
desktop/   Electron-Desktop-App (Node.js, Electron, mqtt.js, simple-peer)
android/   Android-App (Java-WebView, lokaler Proxy, QR-Scanner, mDNS, WebRTC)
```

## Roadmap

- [ ] Eigener Relay-Server (WAN-Relay über die eigene Infrastruktur)
- [ ] iOS-App
- [ ] Fernzugriff/Gateway als installierbares `dsh`-Plugin verpacken (`dsh plugin add`)

## Sicherheit

Fernzugriff setzt dein lokales DSH dem Netzwerk aus. Die Desktop-App aktiviert Fernfunktionen nur, wenn du das Verbindungsfenster öffnest; in dieser frühen Version wird für den Internetzugriff hinter einem Router beim Start eine UPnP-Portweiterleitung versucht — vertraue deinem Netzwerk und erwäge die Deaktivierung in öffentlichen Umgebungen. Eine tokenbasierte Authentifizierungsebene ist geplant.

## Lizenz

[MIT](LICENSE). Basiert auf [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). Nicht mit DeepSeek verbunden und nicht von DeepSeek unterstützt.
