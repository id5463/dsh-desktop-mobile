# dshd — Red & Blue

GUI de bureau native + contrôle à distance Android pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — l'agent de codage IA open source où *tout est un plugin*.

> Projet communautaire, ce n'est pas un produit officiel de DeepSeek.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/dshd-Red-E05252.svg)](red/)
[![Android](https://img.shields.io/badge/dshd-Blue-3DDC84.svg)](blue/)

**Langues :** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · Français · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## Ce que vous obtenez

| | Application de bureau | Application Android |
|---|---|---|
| Quoi | Fenêtre Electron native autour de la Web UI officielle de DSH | Contrôle à distance de votre DSH depuis n'importe où |
| Installation | Zéro configuration : installe Node.js + DSH automatiquement au premier lancement (barre de progression incluse) | Installez l'APK, scannez un QR code |
| Distant | Code court + appairage QR, redirection de port UPnP automatique, WebRTC P2P | Découverte automatique en LAN + distant par Internet |

### Bureau

- **Démarrage zéro configuration** : si Node.js ou DSH manque, l'application les télécharge et les installe automatiquement avec une barre de progression. Double-clic, c'est parti.
- **Web UI complète de DSH** dans une fenêtre native, avec icône de barre des tâches, redémarrage du serveur et changement de langue (中文 / English).
- **Partage LAN** : l'application fait proxy de DSH vers votre LAN (HTTP + WebSocket) et l'annonce via mDNS, votre téléphone le trouve donc automatiquement.
- **Appairage à distance** : ouvrez la fenêtre de connexion pour voir un code court (sans préfixe `dsh-`) et un QR code. Scannez-le depuis l'application du téléphone pour vous connecter.
- **Accès distant zéro configuration** : l'application peut rediriger automatiquement un port de votre routeur via UPnP et publier votre IP publique, pour qu'un téléphone sur Internet y accède directement sans toucher aux réglages du routeur.
- **Repli WebRTC P2P** : quand l'accès direct est impossible, un canal pair-à-pair chiffré (avec repli de relais TURN) est négocié automatiquement.

### Android

- Scannez le QR code ou tapez le code court de l'application de bureau.
- Découverte automatique des postes sur le même Wi-Fi (mDNS).
- Web UI complète de DSH sur votre téléphone : lancez des tâches, suivez la progression de l'agent, approuvez les appels d'outils, envoyez des relances.
- Fonctionne sur Internet via P2P/relais — sans inscription, sans compte, rien à configurer.

## Démarrage rapide

### Bureau

Prérequis : Node.js ≥ 18 (l'application peut aussi préparer son propre runtime).

```bash
cd red
npm install
npm start
```

Au premier lancement, l'application vérifie DSH, le télécharge si besoin (barre de progression) et ouvre la Web UI.

### Android

Récupérez l'APK précompilé dans `blue/dist/dshd-blue.apk` et faites un sideload (activez « installer des applications inconnues »), ou compilez-le vous-même :

```powershell
cd blue
.\build-apk-aapt.ps1    # produit dist/dshd-blue.apk, sans Android Studio/Gradle
```

Ouvrez l'application → la fenêtre de connexion du bureau affiche un code + QR → scannez avec le téléphone → connecté.

## Comment fonctionne la connexion à distance

1. Le bureau génère un code court (ex. `K7X9`) et affiche un QR.
2. La signalisation passe par MQTT (un broker public gratuit par défaut ; vous pouvez pointer les deux applications vers votre propre broker).
3. Le téléphone et le bureau négocient une connexion WebRTC ; si les deux sont derrière un NAT, la redirection de port UPnP ou un relais TURN les relie.
4. Le trafic circule de bout en bout (ou via le relais) — sans compte, sans inscription.

### Note sur les restrictions de ports des FAI

L'application fonctionne sur les réseaux fixes et mobiles normaux. Certains FAI mobiles (par exemple le réseau de données de China Mobile en Chine continentale) interceptent ou bloquent de façon transparente les **ports entrants non standard** ; sur un tel réseau, une connexion entrante directe peut être refusée. C'est une politique de l'opérateur, pas une limitation de l'application — sur ces réseaux, utilisez une connexion LAN, un autre opérateur, ou pointez les deux applications vers votre propre serveur MQTT/TURN.

## Structure du projet

```
red/   Application de bureau Electron (Node.js, Electron, mqtt.js, simple-peer)
blue/   Application Android (WebView Java, proxy local, scanner QR, mDNS, WebRTC)
```

## Feuille de route

- [ ] Serveur de relais dédié (relais WAN via votre propre infrastructure)
- [ ] Application iOS
- [ ] Empaqueter la passerelle distante comme plugin `dsh` installable (`dsh plugin add`)
- [ ] Fusion des fonctionnalités communautaires (adoption de fonctions sous licence MIT) — liste complète dans [README.md](README.md#community-feature-merge-permissive-licenses)

## Sécurité

L'accès distant expose votre DSH local au réseau. L'application de bureau n'active les fonctions distantes que lorsque vous ouvrez la fenêtre de connexion ; dans cette première version, l'accès Internet derrière un routeur tente une redirection de port UPnP au démarrage — assurez-vous de faire confiance à votre réseau et envisagez de la désactiver en environnement public. Une couche d'authentification par jeton est prévue.

## Licence

[MIT](LICENSE). Construit sur [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT). Non affilié à DeepSeek et non approuvé par DeepSeek.
