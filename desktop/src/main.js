const { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const https = require('https')
const dgram = require('dgram')
const Store = require('electron-store')
const QRCode = require('qrcode')
const { locales, defaultLocale } = require('./locale.js')
const { createGate } = require('./lan-gate.js')

// 社区功能集成 (MIT): dsh-Remote 网关 (Blank-not-black/dsh-Remote)
const REMOTE_GATEWAY = path.join(__dirname, 'gateway', 'gateway.js')
// 自动更新来源: 本产品公开仓库
const UPDATE_REPO = 'id5463/dsh-desktop-mobile'

const store = new Store({
  defaults: {
    host: '127.0.0.1',
    port: 3080,
    windowBounds: { width: 1200, height: 800 },
    autoStartDsh: true,
    peerId: 'dsh-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
    // 远程访问令牌: LAN 网关 / 手机直连鉴权用 (随机, 连接窗口可见)
    remoteToken: 'tk-' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
    gatewayPort: 8787,
    lang: defaultLocale,
  },
})

let lang = store.get('lang')
function t(key) { return (locales[lang] || locales.zh)[key] || key }
function setLang(l) { lang = l; store.set('lang', l) }

let mainWindow = null
let p2pBridge = null
let tray = null
let dshProcess = null
let peerServerPort = 9000
let isQuitting = false
let p2pReady = false
let connectedPhones = {}

// ====== P2P 桥接 (simple-peer + HTTP 信令) ======

let signalOffer = null // 存储 SDP offer，供手机获取

function createP2PBridge() {
  p2pBridge = new BrowserWindow({
    width: 1, height: 1,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  p2pBridge.loadFile(path.join(__dirname, 'p2p-bridge.html'))
  p2pBridge.on('closed', () => { p2pBridge = null })
}

// 启动 HTTP 信令端点（在 DSH 端口上）
function startSignalEndpoint() {
  try {
    // 注册一个简单的 HTTP 处理，通过 webServer 的 tapIndex 或直接监听
    // 由于 webServer 是第三方服务，我们直接在 DSH 端口上加一个简单的路由
    // 但实际上最简单的办法是用 Node.js 的 http 模块创建一个独立服务器
    const signalServer = require('http').createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') { res.end(); return }

      if (req.method === 'GET' && req.url === '/signal') {
        // 手机获取 SDP offer
        if (signalOffer) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ type: 'offer', data: signalOffer }))
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No offer available yet' }))
        }
        return
      }

      if (req.method === 'POST' && req.url === '/signal') {
        // 手机发送 SDP answer
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const answer = JSON.parse(body)
            if (answer.type === 'answer' && p2pBridge) {
              p2pBridge.webContents.send('p2p-signal-remote', answer.data)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'ok' }))
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid answer' }))
            }
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        return
      }

      res.writeHead(404).end()
    })

    signalServer.listen(0, '127.0.0.1', () => {
      const signalPort = signalServer.address().port
      store.set('signalPort', signalPort)
      console.log(`DSH Desktop: Signal endpoint on port ${signalPort}`)
    })

    app.on('before-quit', () => { try { signalServer.close() } catch(e) {} })
  } catch (err) {
    console.log('DSH Desktop: Signal endpoint failed:', err.message)
  }
}

// IPC: SDP 信号数据（从 renderer 发来）
ipcMain.on('p2p-signal', (event, data) => {
  signalOffer = data
  console.log('DSH Desktop: SDP signal received')
})

// IPC: 新连接
ipcMain.on('p2p-connection', (event, { peerId, type }) => {
  connectedPhones[peerId] = { type, connectedAt: new Date() }
  console.log(`DSH Desktop: Phone connected: ${peerId}`)
  if (mainWindow) mainWindow.webContents.send('p2p-status', { peerId, connected: Object.keys(connectedPhones) })
})

// IPC: 断开
ipcMain.on('p2p-disconnected', (event, connId) => {
  delete connectedPhones[connId]
  console.log(`DSH Desktop: Phone disconnected: ${connId}`)
  if (mainWindow) mainWindow.webContents.send('p2p-status', { peerId: store.get('peerId'), connected: Object.keys(connectedPhones) })
})

// IPC: HTTP 请求代理
ipcMain.on('p2p-http-request', (event, { requestId, method, path: reqPath, headers, body }) => {
  const host = store.get('host')
  const port = store.get('port')
  const options = {
    hostname: host,
    port,
    path: reqPath,
    method: method || 'GET',
    headers: headers || {},
  }

  const proxyReq = http.request(options, (proxyRes) => {
    let data = ''
    proxyRes.on('data', (chunk) => { data += chunk })
    proxyRes.on('end', () => {
      if (p2pBridge) {
        p2pBridge.webContents.send('p2p-http-response', {
          requestId,
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: data,
        })
      }
    })
  })

  proxyReq.on('error', (err) => {
    console.error('DSH Desktop: Proxy error:', err.message)
    if (p2pBridge) {
      p2pBridge.webContents.send('p2p-http-response', {
        requestId,
        status: 502,
        headers: {},
        body: JSON.stringify({ error: err.message }),
      })
    }
  })

  if (body) proxyReq.write(body)
  proxyReq.end()
})

// IPC: 获取连接列表
ipcMain.on('p2p-connections-list', (event, conns) => {
  // 更新 connectedPhones
})

// 生成二维码数据 URL
async function generateQRDataURL(text) {
  try {
    return await QRCode.toDataURL(text, { width: 300, margin: 2, color: { dark: '#1a73e8', light: '#ffffff' } })
  } catch {
    return null
  }
}

// ====== mDNS 服务发现（让手机自动发现桌面端） ======

function startMDNS() {
  try {
    const mdns = require('multicast-dns')()
    const port = store.get('port')
    const lanIp = getLanIp()
    const name = 'DSH Desktop'

    function announce() {
      try {
        mdns.response({
          answers: [
            { name: 'dsh-desktop.local', type: 'A', ttl: 300, data: lanIp },
          ],
          additionals: [
            { name: '_dsh._tcp.local', type: 'PTR', ttl: 300, data: 'dsh-desktop._dsh._tcp.local' },
            { name: 'dsh-desktop._dsh._tcp.local', type: 'SRV', ttl: 300, data: { priority: 10, weight: 0, port, target: 'dsh-desktop.local' } },
            { name: 'dsh-desktop._dsh._tcp.local', type: 'TXT', ttl: 300, data: Buffer.from(`name=${name}`) },
          ],
        })
      } catch(e) {}
    }

    announce()
    const interval = setInterval(announce, 30000)
    console.log(`DSH Desktop: mDNS advertising ${lanIp}:${port}`)

    app.on('before-quit', () => { clearInterval(interval); try { mdns.destroy() } catch(e) {} })
  } catch (err) {
    console.log('DSH Desktop: mDNS init failed:', err.message)
  }
}

// ====== 内置 PeerJS 信令服务器（嵌入在进程中，非独立进程） ======

function startPeerServer(port = 9000) {
  try {
    const { PeerServer } = require('peer')
    let httpServer = null
    PeerServer({ port, path: '/peerjs' }, (server) => { httpServer = server })
    peerServerPort = port
    console.log(`DSH Desktop: PeerJS signaling server started on port ${port}`)
    store.set('peerServerPort', port)
    app.on('before-quit', () => { try { httpServer && httpServer.close() } catch(e) {} })
  } catch (err) {
    console.log('DSH Desktop: PeerJS server init failed:', err.message)
  }
}

// ====== LAN 端口代理（让手机能连上 DSH） ======

function getLanIp() {
    const os = require('os')
    const ifaces = os.networkInterfaces()
    const prefer = ['WLAN', 'Wi-Fi', 'WiFi', '以太网', 'Ethernet']
    // 先找 WiFi
    for (const pref of prefer) {
      for (const name of Object.keys(ifaces)) {
        if (name.includes(pref)) {
          for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              // 跳过虚拟网卡（169.254.x.x 和 192.168.56.x 等）
              if (iface.address.startsWith('169.254') || iface.address.startsWith('192.168.56')) continue
              return iface.address
            }
          }
        }
      }
    }
    // 兜底：找第一个非 internal 的 IPv4
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254') && !iface.address.startsWith('192.168.56')) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }

function startLanProxy() {
  try {
    const lanIp = getLanIp()
    if (lanIp === '127.0.0.1') return
    const targetPort = store.get('port')

    const http = require('http')
    // 局域网/公网访问鉴权: 首次访问需连接码或令牌 (集成 dsh-mobile-gate / dsh-Remote 思路, MIT)
    const gate = createGate({
      getSecrets: () => [gatewayToken(), String(store.get('peerId')).replace(/^dsh-/i, ''), String(store.get('peerId'))],
      cookieName: 'dsh_gate',
    })
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://dsh.local')
        const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
        if (gate.handle(req, res, url, ip)) return // 未授权: 已应答输入页/429/提交校验

        // 已授权 -> 代理到本机 DSH, 把所有暴露局域网 IP 的头都改写成 127.0.0.1, 让 DSH 信任检查放行
        const headers = { ...req.headers }
        headers.host = '127.0.0.1:' + targetPort
        if (headers.origin) headers.origin = headers.origin.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:' + targetPort)
        if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:' + targetPort)
        const options = {
          hostname: '127.0.0.1',
          port: targetPort,
          path: gate.stripToken(req.url),
          method: req.method,
          headers,
        }
        const proxyReq = http.request(options, (proxyRes) => {
          // 合并网关下发的 set-cookie 与上游的 set-cookie
          const outHeaders = { ...proxyRes.headers }
          const gateCookie = res.getHeader('set-cookie')
          if (gateCookie) {
            const upstreamCookie = proxyRes.headers['set-cookie']
            outHeaders['set-cookie'] = [].concat(gateCookie, upstreamCookie || []).filter(Boolean)
          }
          res.writeHead(proxyRes.statusCode, outHeaders)
          proxyRes.pipe(res)
        })
        proxyReq.on('error', () => { res.statusCode = 502; res.end() })
        req.pipe(proxyReq)
      } catch (e) {
        console.log('DSH Desktop: LAN proxy handler error:', e.message)
        if (!res.headersSent) { res.statusCode = 500; res.end() }
      }
    })

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://dsh.local')
      if (!gate.checkUpgrade(req, url)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      const proxySocket = require('net').connect(targetPort, '127.0.0.1', () => {
        const origin = req.headers.origin
          ? req.headers.origin.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:' + targetPort)
          : 'http://127.0.0.1:' + targetPort
        const lines = [
          'GET ' + gate.stripToken(req.url) + ' HTTP/1.1',
          'Host: 127.0.0.1:' + targetPort,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: ' + req.headers['sec-websocket-key'],
          'Sec-WebSocket-Version: ' + req.headers['sec-websocket-version'],
          'Origin: ' + origin,
          '',
        ].join('\r\n')
        proxySocket.write(lines + '\r\n')
        if (head.length > 0) proxySocket.write(head)
        proxySocket.pipe(socket).pipe(proxySocket)
      })
      proxySocket.on('error', () => socket.end())
      socket.on('error', () => proxySocket.end())
    })

    // 必须放在 listen() 之前注册：EADDRINUSE 是异步 error 事件，
    // 不注册处理器就会抛 Uncaught Exception 崩溃。
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`DSH Desktop: LAN proxy already running on ${lanIp}:${targetPort}, reusing existing`)
      } else {
        console.log('DSH Desktop: LAN proxy error:', err.code || err.message)
      }
    })

    server.listen(targetPort, lanIp, () => {
      console.log(`DSH Desktop: LAN proxy on ${lanIp}:${targetPort}`)
    })
    app.on('before-quit', () => { try { server.close() } catch(e) {} })
  } catch (err) {
    console.log('DSH Desktop: LAN proxy failed:', err.message)
  }
}

// ====== 运行时管理（自动安装 Node.js / DSH） ======

function runtimeDir() { return path.join(app.getPath('userData'), 'runtime') }

function sendBootProgress(loading, data) {
  try { if (loading && !loading.isDestroyed()) loading.webContents.send('boot-progress', data) } catch (e) {}
}

/** 找可用的 node/npm：先 PATH，再本地 runtime 目录 */
function findNodeRuntime() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process')
    execFile('node', ['--version'], (err, out) => {
      if (!err) {
        resolve({ node: 'node', npm: 'npm', version: (out || '').trim() })
        return
      }
      // 本地 runtime 里找 node.exe
      const found = (function walk(dir) {
        if (!dir) return null
        try {
          for (const e of require('fs').readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (e.isDirectory()) { const f = walk(p); if (f) return f }
            else if (e.name === 'node.exe') return p
          }
        } catch (e) {}
        return null
      })(runtimeDir())
      if (found) {
        resolve({ node: found, npm: path.join(path.dirname(found), 'npm.cmd'), local: true })
      } else {
        resolve(null)
      }
    })
  })
}

/** 带进度条的下载（https，按 Content-Length 计算百分比） */
function downloadWithProgress(url, dest, onProgress) {
  return new Promise((resolvePromise, rejectPromise) => {
    const fs = require('fs')
    const https = require('https')
    const file = fs.createWriteStream(dest)
    let total = 0, received = 0
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 重定向
        file.close(); fs.unlinkSync(dest)
        return downloadWithProgress(res.headers.location, dest, onProgress).then(resolvePromise).catch(rejectPromise)
      }
      if (res.statusCode !== 200) { rejectPromise(new Error('HTTP ' + res.statusCode)); return }
      total = parseInt(res.headers['content-length'] || '0', 10)
      res.on('data', (chunk) => {
        received += chunk.length
        if (total > 0 && onProgress) onProgress(Math.min(100, Math.round(received * 100 / total)))
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolvePromise(dest)))
    })
    req.on('error', rejectPromise)
    file.on('error', rejectPromise)
  })
}

/** 解压 zip（Windows 自带 tar.exe 可解 zip） */
function extractZip(zipPath, destDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    const { spawn } = require('child_process')
    require('fs').mkdirSync(destDir, { recursive: true })
    const child = spawn('tar.exe', ['-xf', zipPath, '-C', destDir], { stdio: 'ignore' })
    child.on('error', rejectPromise)
    child.on('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error('解压失败 code ' + code)))
  })
}

/** 确保 Node.js 可用；缺则下载（带进度） */
async function ensureNodeRuntime(loading) {
  const found = await findNodeRuntime()
  if (found) {
    sendBootProgress(loading, { step: 1, done: true, text: '检查运行环境 ✓', percent: 10 })
    return found
  }
  sendBootProgress(loading, { step: 1, text: '未检测到 Node.js，开始下载…', percent: 10 })
  const version = 'v22.14.0'
  const url = `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`
  const dir = runtimeDir()
  require('fs').mkdirSync(dir, { recursive: true })
  const zipPath = path.join(dir, `node-${version}.zip`)
  await downloadWithProgress(url, zipPath, (pct) => {
    sendBootProgress(loading, { step: 1, text: `下载 Node.js… ${pct}%`, percent: 10 + pct * 0.5 })
  })
  sendBootProgress(loading, { step: 1, text: '解压 Node.js…', percent: 60 })
  await extractZip(zipPath, dir)
  const nodeExe = path.join(dir, `node-${version}-win-x64`, 'node.exe')
  return { node: nodeExe, npm: path.join(path.dirname(nodeExe), 'npm.cmd'), local: true }
}

// ====== UPnP 端口映射 + 公网 IP（零配置远程访问） ======

let publicIp = null
let upnpOk = false

/** 获取公网 IP（多个服务兜底） */
function getPublicIP() {
  return new Promise((resolve) => {
    const services = ['https://ifconfig.me/ip', 'https://icanhazip.com', 'https://ipinfo.io/ip']
    let tried = 0
    const tryNext = () => {
      if (tried >= services.length) { resolve(publicIp); return }
      const url = services[tried++]
      const req = https.get(url, (res) => {
        let d = ''
        res.on('data', (c) => d += c)
        res.on('end', () => {
          const ip = d.trim()
          if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) { publicIp = ip; resolve(ip) }
          else tryNext()
        })
      })
      req.on('error', tryNext)
      req.setTimeout(5000, () => { req.destroy(); tryNext() })
    }
    tryNext()
  })
}

/** SSDP 发现路由器 UPnP 网关 */
function upnpDiscover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n' +
      '\r\n')
    let location = null
    sock.on('message', (data) => {
      const text = data.toString()
      const m = text.match(/LOCATION:\s*(http:\/\/[^\s]+)/i)
      if (m) { location = m[1]; sock.close(); resolve(location) }
    })
    sock.on('error', () => { sock.close(); resolve(null) })
    setTimeout(() => { try { sock.close() } catch (e) {} resolve(location) }, timeoutMs)
    sock.bind(() => sock.send(msg, 1900, '239.255.255.250'))
  })
}

/** 取 igd.xml，找 WANIPConnection 的 controlURL */
function upnpGetControl(location) {
  return new Promise((resolve) => {
    http.get(location, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => {
        const svcs = d.match(/<serviceType>(.*?)<\/serviceType>/g) || []
        const ctrls = d.match(/<controlURL>(.*?)<\/controlURL>/g) || []
        const idx = svcs.findIndex(s => s.includes('WANIPConnection'))
        if (idx >= 0 && ctrls[idx]) {
          resolve({ host: location.match(/http:\/\/([^:\/]+)/)[1], path: ctrls[idx].replace(/<\/?controlURL>/g, '') })
        } else resolve(null)
      })
    }).on('error', () => resolve(null))
  })
}

/** SOAP 调用路由器 */
function upnpSoap(host, path, action, body) {
  return new Promise((resolve) => {
    const req = http.request({ host, port: 1900, path, method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: action, 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); })
    req.on('error', () => resolve(null))
    req.write(body); req.end()
  })
}

/** 自动添加端口映射：公网 port → 局域网 IP */
async function upnpAddMapping(port, lanIp) {
  try {
    const location = await upnpDiscover()
    if (!location) { console.log('DSH Desktop: UPnP 路由器未发现'); return false }
    const ctrl = await upnpGetControl(location)
    if (!ctrl) { console.log('DSH Desktop: UPnP 无 WANIPConnection 服务'); return false }

    const ns = 'urn:schemas-upnp-org:service:WANIPConnection:1'
    const body = '<?xml version="1.0"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      '<s:Body><u:AddPortMapping xmlns:u="' + ns + '">' +
      '<NewRemoteHost></NewRemoteHost><NewExternalPort>' + port + '</NewExternalPort><NewProtocol>TCP</NewProtocol>' +
      '<NewInternalPort>' + port + '</NewInternalPort><NewInternalClient>' + lanIp + '</NewInternalClient>' +
      '<NewEnabled>1</NewEnabled><NewPortMappingDescription>DSH-Desktop</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>' +
      '</u:AddPortMapping></s:Body></s:Envelope>'
    const r = await upnpSoap(ctrl.host, ctrl.path, ns + '#AddPortMapping', body)
    if (r && r.status === 200 && !r.body.includes('UPnPError')) {
      upnpOk = true
      console.log(`DSH Desktop: ✅ UPnP 端口 ${port} 已映射到 ${lanIp}（公网可达）`)
      return true
    }
    console.log('DSH Desktop: UPnP 添加映射失败:', r ? r.body.match(/<errorDescription>(.*?)<\/errorDescription>/)?.[1] : '无响应')
    return false
  } catch (e) {
    console.log('DSH Desktop: UPnP 异常:', e.message)
    return false
  }
}

/** 启动 UPnP：开端口 + 拿公网 IP */
async function setupRemoteAccess() {
  const lanIp = getLanIp()
  const port = store.get('port')
  if (lanIp && lanIp !== '127.0.0.1') {
    upnpAddMapping(port, lanIp)
  }
  await getPublicIP()
  if (publicIp) {
    console.log(`DSH Desktop: 公网 IP ${publicIp}:${port}${upnpOk ? '（UPnP 已开端口，手机可直连）' : '（UPnP 不可用）'}`)
  }
  // 把公网 IP 通知桥接，随 offer 发布给手机
  if (p2pBridge && !p2pBridge.isDestroyed()) {
    p2pBridge.webContents.send('p2p-public-ip', { publicIp, port, upnpOk })
  }
}

// ====== DSH 服务器管理 ======

function findDshCommand() {
  const devPaths = [
    path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'dsh.cmd'),
    path.join(__dirname, '..', '..', 'cli', 'lib', 'bin.js'),
  ]
  for (const p of devPaths) {
    try { require.resolve(p); return p } catch {}
  }
  return 'dsh'
}

function isDshRunning(host, port) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

function waitForDsh(host, port, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = async () => {
      const running = await isDshRunning(host, port)
      if (running) { resolve(true); return }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('DSH did not start within timeout'))
        return
      }
      setTimeout(check, 500)
    }
    check()
  })
}

function startDshInBackground(host, port, runtime, loading) {
  return new Promise((resolve, reject) => {
    const devDsh = findDshCommand()
    // 获取 LAN IP 用于绑定
    const os = require('os')
    const ifaces = os.networkInterfaces()
    let lanIp = '127.0.0.1'
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal && !name.includes('VirtualBox') && !name.includes('VMware')) {
          lanIp = iface.address
          break
        }
      }
      if (lanIp !== '127.0.0.1') break
    }
    const args = ['--profile', 'web', '--trusted-host', lanIp]
    if (port !== 3080) args.push('--port', String(port))

    // 决定启动命令：开发环境用本地 dsh；否则用 npx @deepseek-ai/dsh
    let command, commandArgs
    if (devDsh !== 'dsh') {
      command = devDsh.endsWith('.js') ? process.execPath : devDsh
      commandArgs = devDsh.endsWith('.js') ? [devDsh, ...args] : args
      console.log(`DSH Desktop: Starting "${devDsh} ${args.join(' ')}"`)
    } else if (runtime) {
      // npx 方式（自动下载 DSH）
      sendBootProgress(loading, { step: 2, text: '通过 npx 准备 DSH（首次会下载）…', percent: 60 })
      command = runtime.npm || 'npm'
      commandArgs = ['exec', '-y', '@deepseek-ai/dsh', ...args]
      console.log(`DSH Desktop: Starting "npx @deepseek-ai/dsh ${args.join(' ')}"`)
    } else {
      command = 'dsh'
      commandArgs = args
    }

    dshProcess = spawn(command, commandArgs, {
      cwd: require('fs').existsSync(path.join(__dirname, '..', '..', '..', 'package.json'))
        ? path.join(__dirname, '..', '..', '..')
        : app.getPath('userData'),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !devDsh || devDsh === 'dsh' || runtime ? (process.platform === 'win32') : false,
    })

    sendBootProgress(loading, { step: 3, text: '启动 DSH 服务器…', percent: 75 })

    dshProcess.stdout.on('data', (data) => {
      const text = data.toString()
      console.log(`[dsh] ${text.trim()}`)
      if (text.includes('dsh web: http://')) {
        sendBootProgress(loading, { step: 3, done: true, text: '启动服务器 ✓', percent: 100 })
        resolve()
      }
    })

    dshProcess.stderr.on('data', (data) => {
      console.error(`[dsh] ${data.toString().trim()}`)
    })

    dshProcess.on('error', (err) => {
      console.error(`DSH Desktop: Failed to start dsh:`, err.message)
      reject(err)
    })

    dshProcess.on('exit', (code) => {
      console.log(`DSH Desktop: dsh exited with code ${code}`)
      dshProcess = null
    })

    waitForDsh(host, port, 120000).then(resolve).catch(reject)
  })
}

// ====== DSH Remote 网关 (集成自 dsh-Remote, MIT) ======

let gatewayProcess = null
let gatewayRestartTimer = null
let gatewayStopping = false

function gatewayToken() { return store.get('remoteToken') }
function gatewayPort() { return store.get('gatewayPort') || 8787 }

/** 启动 dsh-Remote 网关子进程 (token 鉴权 + /fs/* 文件传输 + 设备管理 + 更新检查) */
function startRemoteGateway() {
  if (isQuitting || gatewayStopping || gatewayProcess) return
  const upstream = 'http://127.0.0.1:' + store.get('port')
  const env = {
    ...process.env,
    PORT: String(gatewayPort()),
    HOST: '0.0.0.0',
    DSH_UPSTREAM: upstream,
    TOKEN: gatewayToken(),
    DSH_REMOTE_FS_ROOT: require('os').homedir(),
  }
  gatewayProcess = spawn(process.execPath, [REMOTE_GATEWAY], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  gatewayProcess.stdout.on('data', (d) => console.log('[gateway] ' + d.toString().trim()))
  gatewayProcess.stderr.on('data', (d) => console.error('[gateway] ' + d.toString().trim()))
  gatewayProcess.on('exit', (code) => {
    gatewayProcess = null
    console.log(`DSH Desktop: Remote 网关退出 (code ${code})`)
    // 自愈: 意外退出 3 秒后自动拉起 (用户主动停止除外)
    if (!isQuitting && !gatewayStopping) {
      clearTimeout(gatewayRestartTimer)
      gatewayRestartTimer = setTimeout(startRemoteGateway, 3000)
    }
  })
  console.log(`DSH Desktop: Remote 网关已启动 (端口 ${gatewayPort()}, 上游 ${upstream})`)
}

function stopRemoteGateway() {
  gatewayStopping = true
  clearTimeout(gatewayRestartTimer)
  if (gatewayProcess) { try { gatewayProcess.kill() } catch (e) {} gatewayProcess = null }
}

// ====== 自动更新检查 (参考 dsh-Remote / dataelement-dsh-desktop, MIT) ======

const APP_VERSION = require('../package.json').version

function cmpVersion(a, b) {
  const pa = String(a || '').split('.').map(Number)
  const pb = String(b || '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

function checkForUpdates(silent) {
  const req = https.get('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', {
    headers: { 'user-agent': 'dsh-desktop/' + APP_VERSION, accept: 'application/json' },
    timeout: 8000,
  }, (res) => {
    let body = ''
    res.on('data', (c) => { body += c; if (body.length > 512 * 1024) res.destroy() })
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        const ver = String(data.tag_name || data.name || '').replace(/^v/i, '')
        if (ver && cmpVersion(ver, APP_VERSION) > 0) {
          console.log(`DSH Desktop: 发现新版本 v${ver} (当前 v${APP_VERSION})`)
          const url = data.html_url || ('https://github.com/' + UPDATE_REPO + '/releases')
          dialog.showMessageBox(mainWindow, {
            type: 'info', title: t('about_title'),
            message: t('update_available') + ' v' + ver,
            detail: t('update_detail') + '\n' + url,
            buttons: [t('update_go'), t('update_later')],
          }).then((r) => { if (r.response === 0) shell.openExternal(url) })
        } else if (!silent) {
          console.log('DSH Desktop: 已是最新版本 v' + APP_VERSION)
        }
      } catch (e) { /* 解析失败静默 */ }
    })
  })
  req.on('error', () => { /* 无网/被墙时静默, 不影响使用 */ })
  req.on('timeout', () => { try { req.destroy() } catch (e) {} })
}

// ====== 窗口管理 ======

function createConnectionWindow() {
  const peerId = store.get('peerId')
  const port = store.get('port')
  const lanIp = getLanIp()
  const localUrl = `http://${lanIp}:${port}`

  const connWin = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    title: t('conn_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })

  connWin.loadFile(path.join(__dirname, 'connection.html'), {
    query: {
      peerId,
      lanUrl: localUrl,
      lang,
      // 安全网关信息 (dsh-Remote 集成): 手机浏览器可访问 /fs/* 文件传输等
      gatewayUrl: 'http://' + lanIp + ':' + gatewayPort(),
      gatewayToken: gatewayToken(),
      gatewayAdmin: 'http://127.0.0.1:' + gatewayPort() + '/admin',
    },
  })
}

function createLoadingWindow() {
  const loading = new BrowserWindow({
    width: 600, height: 400,
    frame: false, center: true, resizable: false,
    backgroundColor: '#1a1a2e',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  loading.loadFile(path.join(__dirname, 'loading.html'))
  return loading
}

function createWindow() {
  const { width, height } = store.get('windowBounds')
  const host = store.get('host')
  const port = store.get('port')
  const url = `http://${host}:${port}`

  mainWindow = new BrowserWindow({
    width, height, minWidth: 480, minHeight: 320,
    title: 'DSH Desktop',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      webSecurity: false, allowRunningInsecureContent: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: true,
  })

  mainWindow.loadURL(url, { bypassCSP: true }).catch(() => {
    mainWindow.loadFile(path.join(__dirname, 'error.html'), {
      query: { host, port: String(port) },
    })
  })

  mainWindow.on('closed', () => { mainWindow = null })

  Menu.setApplicationMenu(buildMenu())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  createTray()
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: t('menu_dsh'),
      submenu: [
        { label: t('menu_remote_connection'), accelerator: 'CmdOrCtrl+R', click: () => createConnectionWindow() },
        { type: 'separator' },
        { label: t('menu_restart_server'), accelerator: 'CmdOrCtrl+Shift+R', click: () => restartDsh() },
        { type: 'separator' },
        { label: t('menu_quit'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: t('menu_edit'),
      submenu: [
        { role: 'undo', label: t('menu_undo') }, { role: 'redo', label: t('menu_redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu_cut') }, { role: 'copy', label: t('menu_copy') },
        { role: 'paste', label: t('menu_paste') }, { role: 'selectAll', label: t('menu_select_all') },
      ],
    },
    {
      label: t('menu_view'),
      submenu: [
        { role: 'toggleDevTools', label: t('menu_devtools') },
        { type: 'separator' },
        { role: 'zoomIn', label: t('menu_zoom_in') }, { role: 'zoomOut', label: t('menu_zoom_out') },
        { role: 'resetZoom', label: t('menu_reset_zoom') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu_fullscreen') },
      ],
    },
    {
      label: t('menu_language'),
      submenu: [
        {
          label: t('menu_lang_zh'), type: 'radio', checked: lang === 'zh',
          click: () => { setLang('zh'); rebuildMenu() },
        },
        {
          label: t('menu_lang_en'), type: 'radio', checked: lang === 'en',
          click: () => { setLang('en'); rebuildMenu() },
        },
      ],
    },
    {
      label: t('menu_help'),
      submenu: [
        {
          label: t('menu_about'),
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: t('about_title'),
              message: t('about_message'), detail: t('about_detail'),
            })
          },
        },
      ],
    },
  ])
}

function rebuildMenu() {
  Menu.setApplicationMenu(buildMenu())
  if (tray) {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('tray_show'), click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } },
      { label: t('tray_remote'), click: () => createConnectionWindow() },
      { label: t('tray_restart'), click: () => restartDsh() },
      { type: 'separator' },
      { label: t('tray_quit'), click: () => { isQuitting = true; app.quit() } },
    ]))
  }
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip(t('app_title'))
  rebuildMenu()
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
}

function restartDsh() {
  if (dshProcess) { dshProcess.kill(); dshProcess = null }
  if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'loading.html'))
  ensureNodeRuntime(null).then((runtime) =>
    startDshInBackground(store.get('host'), store.get('port'), runtime, null)
  )
    .then(() => {
      const url = `http://${store.get('host')}:${store.get('port')}`
      if (mainWindow) mainWindow.loadURL(url, { bypassCSP: true })
    })
    .catch(() => {
      if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'error.html'), {
        query: { host: store.get('host'), port: String(store.get('port')) },
      })
    })
}

// ====== 启动 ======

app.whenReady().then(async () => {
  const host = store.get('host')
  const port = store.get('port')

  // 启动 LAN 端口代理（让手机能连上 DSH）
  startLanProxy()

  // 启动 DSH Remote 安全网关 (token 鉴权 + 文件传输, 集成自 dsh-Remote)
  startRemoteGateway()

  // 自动更新检查: 启动 10 秒后首查, 之后每 6 小时一次
  setTimeout(() => checkForUpdates(true), 10000)
  setInterval(() => checkForUpdates(true), 6 * 3600 * 1000)

  // 启动 mDNS 服务发现（手机自动发现桌面端）
  startMDNS()

  // 启动 HTTP 信令端点（用于手机交换 SDP）
  startSignalEndpoint()

  // 启动 simple-peer 桥接
  createP2PBridge()

  // UPnP 自动开端口 + 拿公网 IP（零配置远程）
  setupRemoteAccess()

  const alreadyRunning = await isDshRunning(host, port)
  if (alreadyRunning) {
    console.log('DSH Desktop: DSH already running, connecting...')
    createWindow()
  } else if (store.get('autoStartDsh')) {
    console.log('DSH Desktop: Starting DSH server...')
    const loading = createLoadingWindow()
    try {
      // 确保 Node.js 运行时（缺则自动下载，带进度条）
      const runtime = await ensureNodeRuntime(loading)
      // 确保 DSH（开发环境用本地；否则 npx 自动下载）
      await startDshInBackground(host, port, runtime, loading)
      console.log('DSH Desktop: DSH started, opening window...')
      loading.close()
      createWindow()
    } catch (err) {
      console.error('DSH Desktop: Failed to start DSH:', err.message)
      loading.close()
      createWindow()
    }
  } else {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  stopRemoteGateway()
  if (dshProcess) { dshProcess.kill(); dshProcess = null }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}