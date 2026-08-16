# dshd — 红端（桌面）& 蓝端（移动）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）——"万物皆插件"的开源 AI 编程代理——的原生桌面端 + Android 手机远程控制（dshd 家族：红端=桌面，蓝端=移动）。

> 社区项目，非 DeepSeek 官方产品。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Desktop](https://img.shields.io/badge/dshd-Red-E05252.svg)](red/)
[![Android](https://img.shields.io/badge/dshd-Blue-3DDC84.svg)](blue/)

**阅读语言：** [English](README.md) · 简体中文 · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

---

## 你能得到什么

| | dshd Red（桌面端） | dshd Blue（移动端） |
|---|---|---|
| 是什么 | 官方 DSH Web UI 的原生 Electron 窗口 | 随时随地远程控制你的 DSH |
| 安装 | 零配置：首次启动自动下载安装 Node.js + DSH（带进度条） | 装 APK，扫二维码 |
| 远程 | 短码 + 二维码配对、UPnP 自动端口映射、WebRTC P2P | 同局域网自动发现 + 互联网远程 |

### dshd Red（桌面端）

- **零配置启动**：如果缺少 Node.js 或 DSH，应用会自动下载安装（带进度条），双击即用。
- **完整 DSH Web UI**，原生窗口，支持系统托盘、重启服务器、中英文切换。
- **局域网共享**：应用把 DSH 代理到局域网（HTTP + WebSocket）并通过 mDNS 广播，手机自动发现。
- **远程配对**：打开连接窗口即可看到短码（不带 `dsh-` 前缀）和二维码，手机扫码即可连接。
- **零配置远程访问**：应用可通过 UPnP 自动在路由器上映射端口并发布公网 IP，互联网上的手机无需任何路由器设置即可直连。
- **WebRTC P2P 兜底**：直连不可用时，自动协商加密点对点通道（带 TURN 中继兜底）。

### dshd Blue（移动端）

- 扫二维码或输入桌面端显示的短码。
- 同一 Wi-Fi 下自动发现桌面（mDNS）。
- 手机上的完整 DSH Web UI——发起任务、看 agent 进度、审批工具调用、发跟进消息。
- 通过 P2P/中继在互联网上使用——无需注册、无需账号、无需任何配置。

## 快速开始

### dshd Red（桌面端）

环境要求：Node.js ≥ 18（应用也能自带运行时）。

```bash
cd red
npm install
npm start
```

首次运行会自动检查 DSH，需要时下载（进度条）并打开 Web UI。

### dshd Blue（移动端）

直接安装预构建 APK `blue/dist/dshd-blue.apk`（需允许"安装未知应用"），或自己构建：

```powershell
cd blue
.\build-apk-aapt.ps1    # 产出 dist/dshd-blue.apk，无需 Android Studio/Gradle
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
red/   dshd Red — Electron 桌面应用（Node.js、Electron、mqtt.js、simple-peer）
blue/  dshd Blue — Android 应用（Java WebView、本地代理、二维码扫描、mDNS、WebRTC）
```

## 路线图

- [ ] 自有中继服务器（通过自己的基础设施做 WAN 中转）
- [ ] iOS 应用
- [ ] 把远程/网关功能打包成可安装的 `dsh` 插件（`dsh plugin add`）
- [ ] Token 网关鉴权（见下方社区功能合并）

## 社区功能合并（宽松协议）

我们对 DSH 桌面端/移动端生态做了竞品普查，正在吸收 **MIT 协议**项目的最佳功能（功能层面合并并保留署名；未来任何代码级复用都会保留原项目的许可证声明）：

| 功能 | 来源（除注明外均为 MIT） | 状态 |
| --- | --- | --- |
| Token 网关鉴权——每设备一次性令牌、每 IP 限流、首次访问本机审批、DSH 仍只监听 127.0.0.1 | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) · [dsh-mobile-gate](https://github.com/Bernardxu123/dsh-mobile-gate) | **已实现**（LAN 鉴权门 + 网关） |
| 文件传输——列目录 / 上传（2GB）/ Range 断点续传下载，防路径穿越 | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | **已实现**（网关 `/fs/*`） |
| 多服务器 + 测速自动切换（局域网 / Tailscale / WAN） | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | **已实现**（设置页 + 测速） |
| 手机端离线聊天缓存 | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | 计划中 |
| 原生手机页面——会话 / 审批 / 提问 / goal | [dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | 计划中 |
| 自动更新——客户端更新 + 上游核心同步（失败可回滚） | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) · [hairyf Tauri](https://github.com/hairyf/deepseek-harness-desktop) · [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | **已实现**（客户端更新检查） |
| 任务完成系统通知（点击聚焦窗口） | [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | **已实现**（轮询 `session.list`） |
| 托盘一键重启 DSH（杀进程树后重新拉起） | [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) | **已实现** |
| 移动端体验——44px 触控目标、全宽布局、`crypto.randomUUID` polyfill、断线自动重连 | [dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile) · [dsh-web-lan-access](https://github.com/AcidGr/dsh-web-lan-access) · [dsh-mobile-css](https://github.com/ook826092-cloud/dsh-mobile-css) | **已实现** |
| LLM 供应商管理器——多供应商列表、一键激活、端点测速 + 模型发现 | [cc-switch](https://github.com/farion1231/cc-switch) | **已实现**（菜单 → 供应商管理） |
| 冷启动鲁棒性——DSH CLI 用真实 node 运行（非 Electron）、渲染进程自愈、崩溃循环防护 | — | **已实现** |
| 安全加固——随机回环端口、沙箱、导航限制 | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | 计划中 |
| PWA 模式——添加到主屏、离线壳、Web Push 推送、触屏手势 | [dsh-mobile-pwa](https://github.com/zylzyqzz/dsh-mobile-pwa) | 计划中 |
| 纯 HTTP 来源（局域网）的 `crypto.randomUUID` polyfill | [dsh-web-lan-access](https://github.com/AcidGr/dsh-web-lan-access) | 计划中 |
| 第三方模型供应商设置向导（选供应商 → 填 Key → 自动建路由） | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | 计划中 |
| 便携式 `.dshpreset` agent 预设包（导入/导出带信任警告） | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | 计划中 |
| 会话统计栏余额/花费小组件 | 受 [EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC) 启发（无许可证文件——仅功能借鉴，不抄代码） | 计划中 |
| UI 皮肤（一键换主题） | 受 [EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC) · [ChisaAlter](https://github.com/ChisaAlter/Deepseek-Harness-Desktop) 启发（仅功能借鉴） | 计划中 |

> 我们应用已有的功能（LAN 代理 + mDNS、二维码/短码配对、UPnP 自动端口映射、WebRTC P2P + TURN）全部保留——此表只做加法。

## 安全说明

远程访问会把你的本地 DSH 暴露到网络上。桌面端只在打开连接窗口时启用远程功能；在早期版本中，路由器后的互联网访问会随启动尝试 UPnP 端口映射——请确保你信任当前网络，公共环境建议关闭该功能。基于 token 的鉴权层已在规划中。

## 许可证

[MIT](LICENSE)。基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）构建。与 DeepSeek 无隶属关系，亦未获其认可。
