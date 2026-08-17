# 知乎推广草稿 (dshd 家族)

> 状态: CLI (@dawnswwwww/zhihu-cli) 只有 search/ask/hot, 无发文能力 — 草稿用于手动粘贴发布。
> 仓库: https://github.com/id5463/dshd · 守护者: https://github.com/id5463/dshd-green

---

## 草稿 1 — 回答「DeepSeek Harness 有什么好用的插件?」

**推荐一个"不折腾全家桶": dshd 家族(红/蓝/绿)**

DSH 火起来之后, 最烦的就是两件事: 装环境, 和手机上没法用。我们做了个开源三件套, 全部 MIT, 专治这两件事:

**🟥 dshd Red — 桌面端**
- **零配置启动**: 双击即用, 自动下载安装 Node.js 和 DSH(带进度条), 不用敲命令
- 原生 Electron 窗口 + 系统托盘, 关窗口不杀任务
- 局域网自动分享(mDNS 自动发现) + 二维码/短码远程配对
- UPnP 自动开端口, 手机在外网也能直连; WebRTC P2P 兜底
- 供应商管理器: 内置 DeepSeek/硅基流动/Kimi/GLM 等预设, 一键激活, 还能自动识别你 DSH 现有的 API key

**🟦 dshd Blue — 手机端 (Android)**
- 扫二维码即连(令牌自动带上), 同 Wi-Fi 自动发现
- 多服务器列表 + 测速自动选最快
- 断线自动重连, 44px 触屏优化, 手机上完整用 DSH Web UI

**🟩 dshd Green — 守护者**
- DSH 的"救生艇": 只读诊断 CLI(status/doctor/log), 零依赖零侵入
- 以后会上救援模式: DSH 玩死了, 用它起一个隔离的极简实例来修

GitHub: `github.com/id5463/dshd`(全家桶) / `github.com/id5463/dshd-green`(守护者)
社区项目, 非 DeepSeek 官方。手机端 APK 在仓库 `blue/dist/` 直接下。

---

## 草稿 2 — 回答/文章:「全世界都在安装 Node.js」的解法

**DSH 桌面端已经帮你把 Node 装好了 — dshd Red**

看到大家吐槽"DeepSeek Harness 这波, 搞得全世界都在安装 Node.js", 深有同感。我们做的 **dshd Red**(开源桌面端)就是来终结这件事的:

- **双击图标, 剩下的它全包**: 检测到没有 Node.js? 自动下载并解压(进度条实时显示)。没有 DSH? 自动拉取。你只需要双击, 然后等它把 Web UI 打开
- 环境装在自己应用的私有目录里, 不污染系统
- 首次启动带三步进度: 检查环境 → 准备 DSH → 启动服务器, 每一步都有状态

桌面端有的不止这个:
- 系统托盘常驻, 关窗口不退出, 后台继续跑
- 局域网/外网远程: 手机扫码就连, 在家也能用手机看 agent 干活
- 任务完成弹 Windows 系统通知

仓库: `github.com/id5463/dshd`(MIT, 社区项目, 非官方)。下载即用, 装完就忘掉"装环境"这件事。

---

## 草稿 3 — 文章: 给 DeepSeek Harness 配的红/蓝/绿三件套

DSH 开源后生态爆发, 但"环境难装"和"出门用不了"是两个高频痛点。我们做了 dshd 家族: 一个端, 一个壳, 一个守护。

**dshd Red(桌面端)** — Electron 原生壳
自动安装 Node + DSH、系统托盘、局域网 mDNS 分享、二维码/短码远程、UPnP 自动端口映射、WebRTC P2P、任务完成通知、供应商管理器(9 个预设 + 自动识别 API key)。零配置是它的第一原则。

**dshd Blue(手机端)** — Android 远程控制
扫码即连(带令牌过鉴权门)、同 Wi-Fi 自动发现、多服务器测速自动切换、断线自动重连、移动端触屏适配。人在外面, 手机就是 DSH 的遥控器。

**dshd Green(守护者)** — 救生艇
只读诊断 CLI: `status` 看心跳、`doctor` 做健康检查、`log` 看日志。零依赖零侵入。规划中的救援模式会用隔离的极简实例帮你修被玩坏的 DSH——毕竟 agent 玩死自己这种事, 谁没遇到过几次呢。

三件套全部 MIT 开源:
- 家族仓库: `github.com/id5463/dshd`
- 守护者: `github.com/id5463/dshd-green`
- 手机 APK: 仓库 `blue/dist/dshd-blue.apk`

社区项目, 与 DeepSeek 无隶属关系。欢迎 star、提 issue、一起把 DSH 生态做大。

---

## 发布建议
1. 草稿 1 → 回答「DeepSeek Harness 有什么好用的插件?」问题
2. 草稿 2 → 在「DeepSeek Harness 这波,搞得全世界都在安装 Node.js」文章评论区 或 新开回答
3. 草稿 3 → 专栏文章(zhuanlan)
4. 发完后把链接告诉我, 我可以用 CLI 的 search 追踪效果
