# DSH Desktop & Mobile

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`) — 오픈소스 AI 코딩 에이전트, "모든 것이 플러그인" — 의 네이티브 데스크톱 GUI + Android 원격 제어 앱입니다.

> 커뮤니티 프로젝트이며 DeepSeek 공식 제품이 아닙니다.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F.svg)](desktop/)
[![Android](https://img.shields.io/badge/android-APK-3DDC84.svg)](android/)

**언어:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · 한국어 · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## 제공 기능

| | 데스크톱 앱 | Android 앱 |
|---|---|---|
| 개요 | 공식 DSH Web UI를 네이티브 창으로 표시 | 어디서든 DSH 원격 제어 |
| 설치 | 제로 설정: 첫 실행 시 Node.js + DSH 자동 다운로드(진행률 표시) | APK 설치 후 QR 스캔 |
| 원격 | 짧은 코드 + QR 페어링, UPnP 자동 포트 포워딩, WebRTC P2P | 같은 LAN 자동 탐지 + 인터넷 원격 |

### 데스크톱

- **제로 설정 부팅**: Node.js나 DSH가 없으면 자동으로 다운로드·설치합니다(진행률 바 포함). 더블클릭만 하면 끝.
- **완전한 DSH Web UI**를 네이티브 창에서. 시스템 트레이, 서버 재시작, 언어 전환(중국어 / English).
- **LAN 공유**: DSH를 LAN에 프록시(HTTP + WebSocket)하고 mDNS로 광고하여 휴대폰이 자동으로 발견합니다.
- **원격 페어링**: 연결 창에서 짧은 코드(`dsh-` 접두사 없음)와 QR 코드 확인, 휴대폰 앱으로 스캔하여 연결.
- **제로 설정 원격 액세스**: UPnP로 라우터 포트를 자동으로 열고 공인 IP를 게시합니다. 인터넷의 휴대폰이 라우터 설정 없이 직접 접속할 수 있습니다.
- **WebRTC P2P 폴백**: 직접 접속이 불가능하면 암호화된 P2P 채널(TURN 릴레이 폴백 포함)을 자동으로 협상합니다.

### Android

- 데스크톱 앱의 QR 코드를 스캔하거나 짧은 코드를 입력.
- 같은 Wi-Fi의 데스크톱 자동 발견(mDNS).
- 휴대폰에서 완전한 DSH Web UI 사용 — 작업 시작, 에이전트 진행 상황 확인, 도구 호출 승인, 후속 메시지 전송.
- P2P/릴레이를 통해 인터넷에서도 동작 — 등록 없음, 계정 없음, 설정 없음.

## 빠른 시작

### 데스크톱

필수: Node.js ≥ 18(앱이 자체 런타임을 부트스트랩할 수도 있음).

```bash
cd desktop
npm install
npm start
```

첫 실행 시 DSH를 확인하고 필요하면 다운로드(진행률 바) 후 Web UI를 엽니다.

### Android

미리 빌드된 APK `android/dist/dsh-mobile-debug.apk`를 사이드로드("알 수 없는 앱 설치" 허용)하거나 직접 빌드:

```powershell
cd android
.\build-apk-aapt.ps1    # dist/dsh-mobile-debug.apk 생성 (Android Studio/Gradle 불필요)
```

앱 실행 → 데스크톱 연결 창에서 코드 + QR 확인 → 휴대폰으로 스캔 → 연결 완료.

## 원격 연결 원리

1. 데스크톱이 짧은 코드(예: `K7X9`)를 생성하고 QR을 표시.
2. 시그널링은 MQTT로 교환(기본값은 무료 공용 브로커, 양쪽을 자신의 브로커로 지정 가능).
3. 휴대폰과 데스크톱이 WebRTC 연결을 협상. 양쪽이 NAT 뒤에 있으면 UPnP 포트 포워딩 또는 TURN 릴레이가 연결을 중계.
4. 트래픽은 엔드투엔드(또는 릴레이 경유)로 전송 — 계정 없음, 등록 없음.

### ISP 포트 제한에 관한 참고

이 앱은 일반적인 광대역 및 모바일 네트워크에서 작동합니다. 일부 모바일 ISP(예: 중국 본토의 중국모바일 데이터 네트워크)는 **비표준 인바운드 포트**를 투명하게 차단할 수 있으며, 해당 네트워크에서는 직접 인바운드 연결이 거부될 수 있습니다. 이는 통신사 정책이지 앱의 한계가 아닙니다 — 해당 네트워크에서는 같은 LAN 연결을 사용하거나, 다른 통신사를 이용하거나, 양쪽 앱을 자신의 MQTT/TURN 서버로 지정하세요.

## 프로젝트 구조

```
desktop/   Electron 데스크톱 앱 (Node.js, Electron, mqtt.js, simple-peer)
android/   Android 앱 (Java WebView, 로컬 프록시, QR 스캐너, mDNS, WebRTC)
```

## 로드맵

- [ ] 자체 릴레이 서버 (자체 인프라를 통한 WAN 릴레이)
- [ ] iOS 앱
- [ ] 원격/게이트웨이 기능을 설치 가능한 `dsh` 플러그인으로 패키징 (`dsh plugin add`)
- [ ] 커뮤니티 기능 병합 (MIT 라이선스 기능 채택) — 전체 목록은 [README.md](README.md#community-feature-merge-permissive-licenses)

## 보안

원격 액세스는 로컬 DSH를 네트워크에 노출합니다. 데스크톱 앱은 연결 창을 열 때만 원격 기능을 활성화합니다. 이 초기 버전에서는 라우터 뒤 인터넷 액세스를 위해 시작 시 UPnP 포트 포워딩을 시도합니다 — 네트워크를 신뢰할 수 있는지 확인하고, 공용 환경에서는 비활성화를 고려하세요. 토큰 기반 인증 레이어를 계획 중입니다.

## 라이선스

[MIT](LICENSE). [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(MIT) 기반. DeepSeek와 무관하며 DeepSeek의 보증을 받지 않았습니다.
