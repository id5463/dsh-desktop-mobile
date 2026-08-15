// 语言包：中文 / English
const locales = {
  zh: {
    // 菜单
    menu_dsh: 'DSH Desktop',
    menu_remote_connection: '远程连接...',
    menu_restart_server: '重启 DSH 服务器',
    menu_quit: '退出',
    menu_edit: '编辑',
    menu_undo: '撤销',
    menu_redo: '重做',
    menu_cut: '剪切',
    menu_copy: '复制',
    menu_paste: '粘贴',
    menu_select_all: '全选',
    menu_view: '视图',
    menu_devtools: '开发者工具',
    menu_zoom_in: '放大',
    menu_zoom_out: '缩小',
    menu_reset_zoom: '重置缩放',
    menu_fullscreen: '全屏',
    menu_help: '帮助',
    menu_about: '关于 DSH Desktop',
    menu_language: '语言',
    menu_lang_zh: '中文',
    menu_lang_en: 'English',

    // 关于对话框
    about_title: '关于 DSH Desktop',
    about_message: 'DSH Desktop v1.0.0',
    about_detail: 'DeepSeek Harness 桌面版\n\n基于 Electron 的原生桌面应用。\n支持 PeerJS 远程连接，手机 App 可通过 P2P 连接码访问。',

    // 系统托盘
    tray_show: '显示窗口',
    tray_remote: '远程连接...',
    tray_restart: '重启 DSH 服务器',
    tray_quit: '退出',

    // 自动更新
    update_available: '发现新版本',
    update_detail: '是否前往 GitHub 查看并下载新版本？',
    update_go: '前往下载',
    update_later: '稍后',

    // 任务完成通知
    notify_done_title: 'DSH 任务完成',
    notify_done_body: '已完成，点击查看',

    // 连接窗口
    conn_title: '远程连接',
    conn_subtitle: '在 DSH Mobile App 中输入连接码，或扫描二维码',
    conn_code_hint: '在手机上输入此连接码',
    conn_qr_hint: '或用手机扫描二维码',
    conn_lan: '局域网连接',
    conn_p2p: 'P2P 连接码',
    conn_devices: '已连接设备',
    conn_waiting: '等待手机连接…',
    conn_connected: '已连接',
    conn_devices_count: '台',

    // 加载页面
    loading_starting: '正在启动 DeepSeek Harness…',
    loading_step1: '✓ 启动 DSH 服务器',
    loading_step2: '○ 加载 Agent 引擎',
    loading_step3: '○ 建立连接',
    loading_step2_done: '✓ 加载 Agent 引擎',
    loading_step3_done: '✓ 建立连接',
    loading_loading: '加载模块中…',
    loading_almost: '即将就绪…',
    loading_ready: '就绪！',

    // 错误页面
    error_title: '无法连接',
    error_desc: 'DeepSeek Harness 服务器似乎没有在配置的地址上运行。',
    error_target: '目标地址',
    error_causes: '可能的原因',
    error_cause1: '• DSH 尚未启动',
    error_cause2: '• 主机或端口错误',
    error_cause3: '• 服务器在不同网络',
    error_retry: '重新连接',
    error_hint: '启动 DSH: dsh --profile web',

    // 应用标题
    app_title: 'DSH Desktop',
  },

  en: {
    menu_dsh: 'DSH Desktop',
    menu_remote_connection: 'Remote Connection...',
    menu_restart_server: 'Restart DSH Server',
    menu_quit: 'Quit',
    menu_edit: 'Edit',
    menu_undo: 'Undo',
    menu_redo: 'Redo',
    menu_cut: 'Cut',
    menu_copy: 'Copy',
    menu_paste: 'Paste',
    menu_select_all: 'Select All',
    menu_view: 'View',
    menu_devtools: 'Developer Tools',
    menu_zoom_in: 'Zoom In',
    menu_zoom_out: 'Zoom Out',
    menu_reset_zoom: 'Reset Zoom',
    menu_fullscreen: 'Fullscreen',
    menu_help: 'Help',
    menu_about: 'About DSH Desktop',
    menu_language: 'Language',
    menu_lang_zh: '中文',
    menu_lang_en: 'English',

    about_title: 'About DSH Desktop',
    about_message: 'DSH Desktop v1.0.0',
    about_detail: 'DeepSeek Harness Desktop GUI\n\nA native Electron desktop app.\nSupports PeerJS remote connection via DSH Mobile app.',

    tray_show: 'Show Window',
    tray_remote: 'Remote Connection...',
    tray_restart: 'Restart DSH Server',
    tray_quit: 'Quit',

    update_available: 'Update available',
    update_detail: 'Open GitHub to view and download the new version?',
    update_go: 'Download',
    update_later: 'Later',

    notify_done_title: 'DSH task complete',
    notify_done_body: 'finished — click to view',

    conn_title: 'Remote Connection',
    conn_subtitle: 'Enter the connection code in DSH Mobile app, or scan the QR code',
    conn_code_hint: 'Enter this code on your phone',
    conn_qr_hint: 'Or scan the QR code with your phone',
    conn_lan: 'LAN Connection',
    conn_p2p: 'P2P Connection Code',
    conn_devices: 'Connected Devices',
    conn_waiting: 'Waiting for phone connection…',
    conn_connected: 'Connected',
    conn_devices_count: 'device(s)',

    loading_starting: 'Starting DeepSeek Harness…',
    loading_step1: '✓ Starting DSH server',
    loading_step2: '○ Loading agent engine',
    loading_step3: '○ Establishing connection',
    loading_step2_done: '✓ Loading agent engine',
    loading_step3_done: '✓ Establishing connection',
    loading_loading: 'Loading modules…',
    loading_almost: 'Almost ready…',
    loading_ready: 'Ready!',

    error_title: 'Cannot Connect',
    error_desc: 'The DeepSeek Harness server does not appear to be running at the configured address.',
    error_target: 'Target',
    error_causes: 'Possible causes',
    error_cause1: '• DSH not started yet',
    error_cause2: '• Wrong host or port',
    error_cause3: '• Server on a different network',
    error_retry: 'Retry Connection',
    error_hint: 'Start DSH: dsh --profile web',

    app_title: 'DSH Desktop',
  },
}

module.exports = { locales, defaultLocale: 'zh' }