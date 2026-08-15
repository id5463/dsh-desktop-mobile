# DSH Desktop & Mobile

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）——「すべてがプラグイン」のオープンソースAIコーディングエージェント——のネイティブデスクトップGUI＋Androidリモートコントロール。

> コミュニティプロジェクトです。DeepSeek 公式製品ではありません。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F.svg)](desktop/)
[![Android](https://img.shields.io/badge/android-APK-3DDC84.svg)](android/)

**言語:** [English](README.md) · [简体中文](README.zh-CN.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## できること

| | デスクトップアプリ | Androidアプリ |
|---|---|---|
| 概要 | 公式DSH Web UIをネイティブウィンドウで表示 | どこからでもDSHをリモート操作 |
| セットアップ | ゼロ設定：初回起動時にNode.js＋DSHを自動ダウンロード（プログレスバー付き） | APKをインストールしてQRコードを読み取るだけ |
| リモート | 短いコード＋QRペアリング、UPnP自動ポート開放、WebRTC P2P | 同一LAN自動検出＋インターネット経由のリモート |

### デスクトップ

- **ゼロ設定起動**：Node.jsやDSHが無ければ自動ダウンロード＆インストール（プログレスバー付き）。ダブルクリックで開始。
- **完全なDSH Web UI**をネイティブウィンドウで。システムトレイ、サーバー再起動、言語切替（日本語対応は今後 / 中文・English）。
- **LAN共有**：DSHをLANにプロキシ（HTTP＋WebSocket）し、mDNSで広告するため、スマホから自動発見できます。
- **リモートペアリング**：接続ウィンドウに短いコード（`dsh-` 接頭辞なし）とQRコードを表示。スマホアプリで読み取って接続。
- **ゼロ設定リモートアクセス**：UPnPでルーターのポートを自動開放し、パブリックIPを公開。インターネット上のスマホからルーター設定なしで直接アクセスできます。
- **WebRTC P2Pフォールバック**：直接アクセスできない場合は、暗号化されたP2Pチャネル（TURN中継フォールバック付き）を自動ネゴシエーション。

### Android

- デスクトップアプリのQRコードをスキャン、または短いコードを入力。
- 同一Wi-Fi上のデスクトップを自動発見（mDNS）。
- スマホで完全なDSH Web UIを操作——タスク開始、エージェントの進捗確認、ツール呼び出しの承認、フォローアップ送信。
- P2P/リレー経由でインターネット上でも動作——登録不要、アカウント不要、設定不要。

## クイックスタート

### デスクトップ

前提：Node.js ≥ 18（アプリがランタイムを自動導入することも可能）。

```bash
cd desktop
npm install
npm start
```

初回起動時にDSHを確認し、必要ならダウンロード（プログレスバー）してWeb UIを開きます。

### Android

ビルド済みAPK `android/dist/dsh-mobile-debug.apk` をサイドロード（「不明なアプリのインストール」を許可）、または自分でビルド：

```powershell
cd android
.\build-apk-aapt.ps1    # dist/dsh-mobile-debug.apk を生成（Android Studio/Gradle不要）
```

アプリを開く → デスクトップの接続ウィンドウにコード＋QRを表示 → スマホでスキャン → 接続完了。

## リモート接続の仕組み

1. デスクトップが短いコード（例 `K7X9`）を生成し、QRを表示。
2. シグナリングはMQTTで交換（デフォルトは無料のパブリックブローカー。両端を自分のブローカーに向けることも可能）。
3. スマホとデスクトップがWebRTC接続をネゴシエーション。両方がNATの内側にある場合は、UPnPポート開放またはTURNリレーが橋渡し。
4. トラフィックはエンドツーエンド（またはリレー経由）で流れます——アカウント不要、登録不要。

### ISPのポート制限について

本アプリは通常のブロードバンド・モバイルネットワークで動作します。一部のモバイルISP（例：中国本土の中国移動データネットワーク）は**非標準のインバウンドポート**を透過的に遮断する場合があり、そのようなネットワークでは直接のインバウンド接続が拒否されることがあります。これは事業者のポリシーであり、アプリの制限ではありません——そのようなネットワークでは同一LAN接続を使用するか、別のキャリアを利用するか、両端を自分のMQTT/TURNサーバーに向けてください。

## プロジェクト構成

```
desktop/   Electronデスクトップアプリ（Node.js、Electron、mqtt.js、simple-peer）
android/   Androidアプリ（Java WebView、ローカルプロキシ、QRスキャナー、mDNS、WebRTC）
```

## ロードマップ

- [ ] 自前リレーサーバー（自前インフラによるWANリレー）
- [ ] iOSアプリ
- [ ] リモート/ゲートウェイ機能をインストール可能な `dsh` プラグインとしてパッケージ化（`dsh plugin add`）

## セキュリティ

リモートアクセスはローカルのDSHをネットワークに公開します。デスクトップアプリは接続ウィンドウを開いたときだけリモート機能を有効化します。この初期バージョンでは、ルーター越しのインターネットアクセスのため起動時にUPnPポート開放を試みます——ネットワークを信頼できることを確認し、公共の環境では無効化を検討してください。トークンベースの認証レイヤーを計画中です。

## ライセンス

[MIT](LICENSE)。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）をベースに構築。DeepSeekとは無関係で、DeepSeekの承認を受けたものではありません。
