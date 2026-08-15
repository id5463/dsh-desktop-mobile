# DSH Desktop & Mobile

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）——"万物皆插件"的开源 AI 编程代理——的原生桌面端 + Android 手机远程控制。

> 社区项目，非 DeepSeek 官方产品。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F.svg)](desktop/)
[![Android](https://img.shields.io/badge/android-APK-3DDC84.svg)](android/)

**阅读语言：** [English](README.md) · 简体中文 · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## 你能得到什么

| | 桌面端 | Android 端 |
|---|---|---|
| 是什么 | 官方 DSH Web UI 的原生 Electron 窗口 | 随时随地远程控制你的 DSH |
| 安装 | 零配置：首次启动自动下载安装 Node.js + DSH（带进度条） | 装 APK，扫二维码 |
| 远程 | 短码 + 二维码配对、UPnP 自动端口映射、WebRTC P2P | 同局域网自动发现 + 互联网远程 |

### 桌面端

- **零配置启动**：如果缺少 Node.js 或 DSH，应用会自动下载安装（带进度条），双击即用。
- **完整 DSH Web UI**，原生窗口，支持系统托盘、重启服务器、中英文切换。
- **局域网共享**：应用把 DSH 代理到局域网（HTTP + WebSocket）并通过 mDNS 广播，手机自动发现。
- **远程配对**：打开连接窗口即可看到短码（不带 `dsh-` 前缀）和二维码，手机扫码即可连接。
- **零配置远程访问**：应用可通过 UPnP 自动在路由器上映射端口并发布公网 IP，互联网上的手机无需任何路由器设置即可直连。
- **WebRTC P2P 兜底**：直连不可用时，自动协商加密点对点通道（带 TURN 中继兜底）。

### Android 端

- 扫二维码或输入桌面端显示的短码。
- 同一 Wi-Fi 下自动发现桌面（mDNS）。
- 手机上的完整 DSH Web UI——发起任务、看 agent 进度、审批工具调用、发跟进消息。
- 通过 P2P/中继在互联网上使用——无需注册、无需账号、无需任何配置。

## 快速开始

### 桌面端

环境要求：Node.js ≥ 18（应用也能自带运行时）。

```bash
cd desktop
npm install
npm start
```

首次运行会自动检查 DSH，需要时下载（进度条）并打开 Web UI。

### Android 端

直接安装预构建 APK `android/dist/dsh-mobile-debug.apk`（需允许"安装未知应用"），或自己构建：

```powershell
cd android
.\build-apk-aapt.ps1    # 产出 dist/dsh-mobile-debug.apk，无需 Android Studio/Gradle
```

打开应用 → 桌面端连接窗口显示短码 + 二维码 → 手机扫码 → 连接成功。

## 远程连接原理

1. 桌面端生成短码（如 `K7X9`）并显示二维码。
2. 信令通过 MQTT 交换（默认用免费公共 broker，两端都可以指向你自己的 broker）。
3. 手机与桌面协商 WebRTC 连接；两端都在 NAT 后时，由 UPnP 端口映射或 TURN 中继打通。
4. 流量端到端（或经中继）传输——无账号、无注册。

### 关于运营商端口限制的说明

本应用在普通宽带和移动网络上均可工作。部分移动运营商（例如中国大陆的中国移动数据网络）会透明拦截或封禁**非标准入站端口**，此类网络上的直连入站可能被拒绝。这是运营商策略，不是应用的限制——这类网络上请使用同一局域网连接、更换运营商，或把两端指向你自己的 MQTT/TURN 服务器。

## 项目结构

```
desktop/   Electron 桌面应用（Node.js、Electron、mqtt.js、simple-peer）
android/   Android 应用（Java WebView、本地代理、二维码扫描、mDNS、WebRTC）
```

## 路线图

- [ ] 自有中继服务器（通过自己的基础设施做 WAN 中转）
- [ ] iOS 应用
- [ ] 把远程/网关功能打包成可安装的 `dsh` 插件（`dsh plugin add`）

## 安全说明

远程访问会把你的本地 DSH 暴露到网络上。桌面端只在打开连接窗口时启用远程功能；在早期版本中，路由器后的互联网访问会随启动尝试 UPnP 端口映射——请确保你信任当前网络，公共环境建议关闭该功能。基于 token 的鉴权层已在规划中。

## 许可证

[MIT](LICENSE)。基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）构建。与 DeepSeek 无隶属关系，亦未获其认可。
