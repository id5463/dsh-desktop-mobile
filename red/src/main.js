const { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage, ipcMain, WebContentsView } = require('electron')
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
const UPDATE_REPO = 'id5463/dshd'

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
let dshView = null
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
      console.log(`dshd Red: Signal endpoint on port ${signalPort}`)
    })

    app.on('before-quit', () => { try { signalServer.close() } catch(e) {} })
  } catch (err) {
    console.log('dshd Red: Signal endpoint failed:', err.message)
  }
}

// IPC: SDP 信号数据（从 renderer 发来）
ipcMain.on('p2p-signal', (event, data) => {
  signalOffer = data
  console.log('dshd Red: SDP signal received')
})

// IPC: 新连接
ipcMain.on('p2p-connection', (event, { peerId, type }) => {
  connectedPhones[peerId] = { type, connectedAt: new Date() }
  console.log(`dshd Red: Phone connected: ${peerId}`)
  if (mainWindow) mainWindow.webContents.send('p2p-status', { peerId, connected: Object.keys(connectedPhones) })
})

// IPC: 断开
ipcMain.on('p2p-disconnected', (event, connId) => {
  delete connectedPhones[connId]
  console.log(`dshd Red: Phone disconnected: ${connId}`)
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
    console.error('dshd Red: Proxy error:', err.message)
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
    return await QRCode.toDataURL(text, { width: 300, margin: 2, color: { dark: '#dc3545', light: '#ffffff' } })
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
    const name = 'dshd Red'

    function announce() {
      try {
        mdns.response({
          answers: [
            { name: 'dsh-desktop.local', type: 'A', ttl: 300, data: lanIp },
          ],
          additionals: [
            { name: '_dsh._tcp.local', type: 'PTR', ttl: 300, data: 'dsh-desktop._dsh._tcp.local' },
            { name: 'dsh-desktop._dsh._tcp.local', type: 'SRV', ttl: 300, data: { priority: 10, weight: 0, port, target: 'dsh-desktop.local' } },
            // TXT 携带名称 + 访问令牌: 手机 mDNS 自动发现后可直接通过鉴权门
            { name: 'dsh-desktop._dsh._tcp.local', type: 'TXT', ttl: 300, data: [Buffer.from('name=' + name), Buffer.from('token=' + gatewayToken())] },
          ],
        })
      } catch(e) {}
    }

    announce()
    const interval = setInterval(announce, 30000)
    console.log(`dshd Red: mDNS advertising ${lanIp}:${port}`)

    app.on('before-quit', () => { clearInterval(interval); try { mdns.destroy() } catch(e) {} })
  } catch (err) {
    console.log('dshd Red: mDNS init failed:', err.message)
  }
}

// ====== 内置 PeerJS 信令服务器（嵌入在进程中，非独立进程） ======

function startPeerServer(port = 9000) {
  try {
    const { PeerServer } = require('peer')
    let httpServer = null
    PeerServer({ port, path: '/peerjs' }, (server) => { httpServer = server })
    peerServerPort = port
    console.log(`dshd Red: PeerJS signaling server started on port ${port}`)
    store.set('peerServerPort', port)
    app.on('before-quit', () => { try { httpServer && httpServer.close() } catch(e) {} })
  } catch (err) {
    console.log('dshd Red: PeerJS server init failed:', err.message)
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
        console.log('dshd Red: LAN proxy handler error:', e.message)
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
        console.log(`dshd Red: LAN proxy already running on ${lanIp}:${targetPort}, reusing existing`)
      } else {
        console.log('dshd Red: LAN proxy error:', err.code || err.message)
      }
    })

    server.listen(targetPort, lanIp, () => {
      console.log(`dshd Red: LAN proxy on ${lanIp}:${targetPort}`)
    })
    app.on('before-quit', () => { try { server.close() } catch(e) {} })
  } catch (err) {
    console.log('dshd Red: LAN proxy failed:', err.message)
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
    if (!location) { console.log('dshd Red: UPnP 路由器未发现'); return false }
    const ctrl = await upnpGetControl(location)
    if (!ctrl) { console.log('dshd Red: UPnP 无 WANIPConnection 服务'); return false }

    const ns = 'urn:schemas-upnp-org:service:WANIPConnection:1'
    const body = '<?xml version="1.0"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      '<s:Body><u:AddPortMapping xmlns:u="' + ns + '">' +
      '<NewRemoteHost></NewRemoteHost><NewExternalPort>' + port + '</NewExternalPort><NewProtocol>TCP</NewProtocol>' +
      '<NewInternalPort>' + port + '</NewInternalPort><NewInternalClient>' + lanIp + '</NewInternalClient>' +
      '<NewEnabled>1</NewEnabled><NewPortMappingDescription>dshd-Red</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>' +
      '</u:AddPortMapping></s:Body></s:Envelope>'
    const r = await upnpSoap(ctrl.host, ctrl.path, ns + '#AddPortMapping', body)
    if (r && r.status === 200 && !r.body.includes('UPnPError')) {
      upnpOk = true
      console.log(`dshd Red: ✅ UPnP 端口 ${port} 已映射到 ${lanIp}（公网可达）`)
      return true
    }
    console.log('dshd Red: UPnP 添加映射失败:', r ? r.body.match(/<errorDescription>(.*?)<\/errorDescription>/)?.[1] : '无响应')
    return false
  } catch (e) {
    console.log('dshd Red: UPnP 异常:', e.message)
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
    console.log(`dshd Red: 公网 IP ${publicIp}:${port}${upnpOk ? '（UPnP 已开端口，手机可直连）' : '（UPnP 不可用）'}`)
  }
  // 把公网 IP + 访问令牌通知桥接，随 offer 发布给手机
  if (p2pBridge && !p2pBridge.isDestroyed()) {
    p2pBridge.webContents.send('p2p-public-ip', { publicIp, port, upnpOk, token: gatewayToken() })
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
    // [冷启动修复] JS 入口必须用真实 node 运行, 不能用 process.execPath(electron) 跑 CLI
    let command, commandArgs
    const env = { ...process.env }
    if (devDsh !== 'dsh') {
      if (devDsh.endsWith('.js')) {
        command = (runtime && runtime.node) ? runtime.node : process.execPath
        if (command === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
        commandArgs = [devDsh, ...args]
      } else {
        command = devDsh
        commandArgs = args
      }
      console.log(`dshd Red: Starting "${command} ${commandArgs.join(' ')}"`)
    } else if (runtime) {
      // npx 方式（自动下载 DSH）
      sendBootProgress(loading, { step: 2, text: '通过 npx 准备 DSH（首次会下载）…', percent: 60 })
      command = runtime.npm || 'npm'
      commandArgs = ['exec', '-y', '@deepseek-ai/dsh', ...args]
      console.log(`dshd Red: Starting "npx @deepseek-ai/dsh ${args.join(' ')}"`)
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
      env,
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
      console.error(`dshd Red: Failed to start dsh:`, err.message)
      reject(err)
    })

    dshProcess.on('exit', (code) => {
      console.log(`dshd Red: dsh exited with code ${code}`)
      dshProcess = null
    })

    waitForDsh(host, port, 120000).then(resolve).catch(reject)
  })
}

// ====== DSH Remote 网关 (集成自 dsh-Remote, MIT) ======

let gatewayProcess = null
let gatewayRestartTimer = null
let gatewayStopping = false
let gatewayCrashCount = 0

function gatewayToken() {
  // 缺失时生成并持久化, 保证应用与网关用同一个 token (旧 store 可能为空)
  let t = store.get('remoteToken')
  if (!t) {
    t = 'tk-' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
    store.set('remoteToken', t)
  }
  return t
}
function gatewayPort() { return store.get('gatewayPort') || 8787 }

/** 启动 dsh-Remote 网关子进程 (token 鉴权 + /fs/* 文件传输 + 设备管理 + 更新检查)
 *  用 ELECTRON_RUN_AS_NODE=1 让 Electron 二进制以纯 Node 模式运行, 避免拉起第二个 Electron 实例。 */
function startRemoteGateway() {
  if (isQuitting || gatewayStopping || gatewayProcess) return
  const upstream = 'http://127.0.0.1:' + store.get('port')
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(gatewayPort()),
    HOST: '0.0.0.0',
    DSH_UPSTREAM: upstream,
    TOKEN: gatewayToken(),
    DSH_REMOTE_FS_ROOT: require('os').homedir(),
  }
  const startedAt = Date.now()
  gatewayProcess = spawn(process.execPath, [REMOTE_GATEWAY], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  gatewayProcess.stdout.on('data', (d) => console.log('[gateway] ' + d.toString().trim()))
  gatewayProcess.stderr.on('data', (d) => console.error('[gateway] ' + d.toString().trim()))
  gatewayProcess.on('exit', (code) => {
    gatewayProcess = null
    console.log(`dshd Red: Remote 网关退出 (code ${code})`)
    // 自愈: 意外退出 3 秒后自动拉起 (用户主动停止除外); 启动即崩(存活<2秒)连续发生时停止重试, 避免死循环
    if (!isQuitting && !gatewayStopping) {
      if (Date.now() - startedAt >= 2000) {
        gatewayCrashCount = 0 // 正常运行过 -> 重置崩溃计数
      } else if (++gatewayCrashCount > 3) {
        console.log('dshd Red: 网关连续启动失败, 停止自动重启')
        return
      }
      clearTimeout(gatewayRestartTimer)
      gatewayRestartTimer = setTimeout(startRemoteGateway, 3000)
    }
  })
  console.log(`dshd Red: Remote 网关已启动 (端口 ${gatewayPort()}, 上游 ${upstream})`)
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
    headers: { 'user-agent': 'dshd-red/' + APP_VERSION, accept: 'application/json' },
    timeout: 8000,
  }, (res) => {
    let body = ''
    res.on('data', (c) => { body += c; if (body.length > 512 * 1024) res.destroy() })
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        const ver = String(data.tag_name || data.name || '').replace(/^v/i, '')
        if (ver && cmpVersion(ver, APP_VERSION) > 0) {
          console.log(`dshd Red: 发现新版本 v${ver} (当前 v${APP_VERSION})`)
          const url = data.html_url || ('https://github.com/' + UPDATE_REPO + '/releases')
          dialog.showMessageBox(mainWindow, {
            type: 'info', title: t('about_title'),
            message: t('update_available') + ' v' + ver,
            detail: t('update_detail') + '\n' + url,
            buttons: [t('update_go'), t('update_later')],
          }).then((r) => { if (r.response === 0) shell.openExternal(url) })
        } else if (!silent) {
          console.log('dshd Red: 已是最新版本 v' + APP_VERSION)
        }
      } catch (e) { /* 解析失败静默 */ }
    })
  })
  req.on('error', () => { /* 无网/被墙时静默, 不影响使用 */ })
  req.on('timeout', () => { try { req.destroy() } catch (e) {} })
}

// ====== 任务完成通知 (轮询 DSH session.list, 参考 dsh-desktop-windowos / EAC) ======

let notifiedSessions = new Set()
let runningSessions = new Map() // sessionId -> { title, startedAt }

function pollSessionStatus() {
  const port = store.get('port')
  const payload = JSON.stringify({
    type: 'client-request', rpcId: 'dsh-notify-' + Date.now(), method: 'session.list', payload: {},
  })
  const req = http.request({
    hostname: '127.0.0.1', port, path: '/api/session.list', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    timeout: 4000,
  }, (res) => {
    let d = ''
    res.on('data', (c) => { d += c; if (d.length > 1024 * 1024) res.destroy() })
    res.on('end', () => {
      try {
        const data = JSON.parse(d)
        const items = data?.result?.value?.items || []
        const nowRunning = new Set()
        for (const it of items) {
          if (!it.running) continue
          nowRunning.add(it.sessionId)
          if (!runningSessions.has(it.sessionId)) {
            runningSessions.set(it.sessionId, {
              title: it.projections?.values?.title || it.cwd || 'DSH 会话',
              startedAt: Date.now(),
            })
          }
        }
        // 刚结束的会话 -> 系统通知 (运行不足 5 秒的忽略, 防误报)
        for (const [sid, info] of runningSessions) {
          if (!nowRunning.has(sid)) {
            runningSessions.delete(sid)
            if (!notifiedSessions.has(sid) && Date.now() - info.startedAt > 5000) {
              notifiedSessions.add(sid)
              notifyTaskDone(info.title)
            }
          }
        }
        // 会话再次运行 -> 重置已通知标记
        for (const sid of notifiedSessions) if (nowRunning.has(sid)) notifiedSessions.delete(sid)
        // 壳侧栏状态
        lastShellStatus = { online: true, total: items.length, running: nowRunning.size, port }
        pushShellStatus()
      } catch (e) { /* 解析失败静默 */ }
    })
  })
  req.on('error', () => { /* DSH 未运行/重启中: 静默 */ })
  req.on('timeout', () => { try { req.destroy() } catch (e) {} })
  req.end(payload)
}

function notifyTaskDone(title) {
  try {
    const { Notification } = require('electron')
    const n = new Notification({
      title: t('notify_done_title'),
      body: title + ' ' + t('notify_done_body'),
    })
    n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
    n.show()
  } catch (e) { /* 通知不可用时静默 */ }
}

// ====== 供应商管理器 (功能来自 farion1231/cc-switch, MIT) ======

/** 调用 DSH HTTP JSON-RPC: POST /api/<method> */
function dshRpc(method, payload) {
  return new Promise((resolve) => {
    const port = store.get('port')
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: 'dsh-pm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      method,
      payload,
    })
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/' + method, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: 20000,
    }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c; if (d.length > 4 * 1024 * 1024) res.destroy() })
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { try { req.destroy() } catch (e) {} resolve(null) })
    req.end(body)
  })
}

/** 从 DSH settings.yaml 自动发现已配置的供应商 (llm-pi-ai.providers.*) + 匹配 .credentials.yaml 的 key */
function discoverDshProviders() {
  const fs = require('fs')
  const home = dshHome()
  let settingsText = ''
  let credsText = ''
  try { settingsText = fs.readFileSync(path.join(home, 'settings.yaml'), 'utf8') } catch (e) {}
  try { credsText = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8') } catch (e) {}
  const creds = {}
  for (const m of credsText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/gm)) {
    creds[m[1]] = String(m[2]).replace(/^["']|["']$/g, '')
  }
  const out = []
  const provMatch = settingsText.match(/llm-pi-ai:\s*\n(\s+)providers:\s*\n([\s\S]*?)(?=\n\S+\s*:|$)/)
  if (provMatch) {
    const block = provMatch[2]
    const re = /^(\s{4})([A-Za-z0-9_.-]+):\s*\n/gm
    let m
    while ((m = re.exec(block))) {
      const id = m[2]
      const rest = block.slice(m.index + m[0].length)
      const endMatch = rest.match(/\n\s{4}\S+:|\n\s{2}\S+:|\n\S/)
      const seg = endMatch ? rest.slice(0, endMatch.index) : rest
      const baseURL = (seg.match(/baseURL:\s*(\S+)/) || [])[1] || ''
      const api = (seg.match(/api:\s*(\S+)/) || [])[1] || 'openai-completions'
      const env = (seg.match(/apiKeyEnv:\s*(\S+)/) || [])[1] || ''
      const models = [...seg.matchAll(/-\s*id:\s*(\S+)/g)].map((x) => x[1])
      if (baseURL) out.push({ id, name: id, baseURL, api, models, apiKey: creds[env] || '', source: 'dsh' })
    }
  }
  return out
}

function providersList() {
  const saved = store.get('providers') || []
  const list = saved.map((p) => ({ ...p, source: 'self' }))
  // 自动发现 DSH 已配置的供应商, 未在本地列表中的自动补上 (来源标注 dsh)
  for (const d of discoverDshProviders()) {
    if (!list.some((x) => x.id === d.id)) list.push(d)
  }
  return list.map((p) => ({
    ...p,
    apiKey: p.apiKey ? '****' + p.apiKey.slice(-4) : '',
  }))
}

ipcMain.handle('providers-list', () => providersList())

ipcMain.handle('provider-save', (_e, provider) => {
  try {
    const list = store.get('providers') || []
    const p = {
      id: (provider.id || provider.name).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: String(provider.name || '').trim(),
      baseURL: String(provider.baseURL || '').trim().replace(/\/+$/, ''),
      apiKey: String(provider.apiKey || '').trim(),
      api: provider.api || 'openai-completions',
      models: (provider.models || []).map((m) => String(m).trim()).filter(Boolean),
      active: !!provider.active,
    }
    if (!p.name || !p.baseURL) return { ok: false, error: 'name/baseURL required' }
    const idx = list.findIndex((x) => x.id === p.id)
    let autoKey = false
    if (idx >= 0) {
      // 编辑时 key 为空或为掩码(****) → 保留原 key
      p.apiKey = (!p.apiKey || p.apiKey.startsWith('****')) ? list[idx].apiKey : p.apiKey
      list[idx] = p
    }
    else {
      // 新供应商没填 key → 自动寻找 DSH 正在使用的 key ("自己给自己装上")
      if (!p.apiKey) {
        const found = findDshApiKey()
        if (found) { p.apiKey = found.key; autoKey = true }
      }
      list.push(p)
    }
    store.set('providers', list)
    return { ok: true, id: p.id, autoKey }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('provider-delete', (_e, id) => {
  const list = (store.get('providers') || []).filter((x) => x.id !== id)
  store.set('providers', list)
  return { ok: true }
})

/**
 * 自动寻找 DSH 正在使用的 API key (用户不用自己翻配置重输)。
 * 优先级:
 *   1. 已保存的供应商列表里第一个有 key 的
 *   2. settings.yaml 默认模型(agent-default-model.provider)对应供应商的 apiKeyEnv
 *   3. .credentials.yaml 里的 DEEPSEEK_API_KEY
 *   4. .credentials.yaml 第一个条目
 *   5. 环境变量 DEEPSEEK_API_KEY / 其它 *_API_KEY
 */
function findDshApiKey() {
  const fs = require('fs')
  const home = dshHome()

  // 已保存的供应商 key
  const saved = (store.get('providers') || []).find((x) => x.apiKey)
  if (saved) return { key: saved.apiKey, envName: saved.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_API_KEY', source: '已保存的供应商(' + saved.name + ')' }

  let settingsText = ''
  let credsText = ''
  try { settingsText = fs.readFileSync(path.join(home, 'settings.yaml'), 'utf8') } catch (e) {}
  try { credsText = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8') } catch (e) {}

  // .credentials.yaml: KEY: value
  const creds = {}
  for (const m of credsText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/gm)) {
    creds[m[1]] = String(m[2]).replace(/^["']|["']$/g, '')
  }

  // 1) settings.yaml 默认供应商的 apiKeyEnv
  const dm = settingsText.match(/agent-default-model:\s*\n\s*provider:\s*(\S+)/)
  if (dm) {
    const provId = dm[1]
    const provM = settingsText.match(new RegExp('\\n\\s{2,}' + provId + ':\\s*\\n([\\s\\S]*?)(?=\\n\\s{2}\\S+:|\\n\\S)', 'm'))
    const envM = (provM ? provM[1] : '').match(/apiKeyEnv:\s*(\S+)/)
    const env = envM && envM[1]
    if (env && creds[env]) return { key: creds[env], envName: env, source: 'DSH 默认供应商 ' + provId + ' (credentials)' }
    if (env && process.env[env]) return { key: process.env[env], envName: env, source: '环境变量 ' + env }
  }

  // 2) 标准 DeepSeek 环境变量 / credentials
  for (const env of ['DEEPSEEK_API_KEY', 'DSH_API_KEY']) {
    if (creds[env]) return { key: creds[env], envName: env, source: 'credentials (' + env + ')' }
    if (process.env[env]) return { key: process.env[env], envName: env, source: '环境变量 ' + env }
  }

  // 3) .credentials.yaml 第一条
  const first = Object.entries(creds)[0]
  if (first) return { key: first[1], envName: first[0], source: '.credentials.yaml 第一条 (' + first[0] + ')' }

  // 4) 任意 *_API_KEY 环境变量
  for (const [k, v] of Object.entries(process.env)) {
    if (/^[A-Z0-9_]*API_KEY$/.test(k) && v) return { key: v, envName: k, source: '环境变量 ' + k }
  }
  return null
}

ipcMain.handle('provider-find-key', () => findDshApiKey())

/** 找到 DSH_HOME: 环境变量优先, 否则 ~/.dsh */
function dshHome() {
  return process.env.DSH_HOME || require('path').join(require('os').homedir(), '.dsh')
}

/**
 * 精确补丁 settings.yaml 的 agent-default-model 块 (该命名空间不对配置客户端暴露, 只能直接写文件)。
 * 只替换/追加这一个顶层块, 其余内容原样保留; 写前备份, DSH 的 settings 监听器会热加载。
 */
function patchDefaultModel(provider, model) {
  const fs = require('fs')
  const file = require('path').join(dshHome(), 'settings.yaml')
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { text = '' }
  // 备份
  try { fs.writeFileSync(file + '.bak', text) } catch (e) {}

  const block = 'agent-default-model:\n  provider: ' + provider + '\n  model: ' + model + '\n'
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^agent-default-model:\s*$/.test(lines[i])) { start = i; break }
  }
  let out
  if (start === -1) {
    out = text.trimEnd() + '\n' + block
  } else {
    // 找块结束: 下一个非缩进的顶层键
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] && !/^\s/.test(lines[i])) { end = i; break }
    }
    out = lines.slice(0, start).concat(block.trimEnd(), lines.slice(end)).join('\n')
  }
  fs.writeFileSync(file, out)
  return true
}

/** 激活: 通过 DSH Settings/Credentials API 写入 llm-pi-ai + 凭证, 并补丁默认模型 */
ipcMain.handle('provider-apply', async (_e, id) => {
  try {
    const list = store.get('providers') || []
    let p = list.find((x) => x.id === id)
    // 自动发现的 DSH 供应商不在本地 store: 从 DSH 配置里取
    if (!p) p = discoverDshProviders().find((x) => x.id === id)
    if (!p) return { ok: false, error: 'not-found' }
    if (!p.apiKey) return { ok: false, error: 'apiKey required' }
    const apiKeyEnv = p.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_API_KEY'
    const section = {
      apiKeyEnv,
      api: p.api || 'openai-completions',
      baseURL: p.baseURL,
      defaultInput: ['text'],
    }
    const models = (p.models || []).map((m) => ({ id: m }))
    if (models.length) section.models = models

    const r1 = await dshRpc('settings.update', { ns: 'llm-pi-ai', patch: { providers: { [p.id]: section } } })
    if (!r1 || !r1.result || !r1.result.ok) return { ok: false, error: 'settings.update(llm-pi-ai): ' + JSON.stringify(r1 && r1.result && r1.result.error || r1) }
    const r3 = await dshRpc('credentials.set', { ref: apiKeyEnv, value: p.apiKey })
    if (!r3 || !r3.result || !r3.result.ok) return { ok: false, error: 'credentials.set: ' + JSON.stringify(r3 && r3.result && r3.result.error || r3) }
    // 默认模型: agent-default-model 命名空间不对 API 暴露, 直接安全补丁 settings.yaml (DSH 热加载)
    try {
      patchDefaultModel(p.id, models.length ? models[0].id : p.models[0])
    } catch (e) {
      return { ok: false, error: 'patchDefaultModel: ' + e.message }
    }

    store.set('providers', list.map((x) => ({ ...x, active: x.id === id })))
    return { ok: true, apiKeyEnv }
  } catch (e) { return { ok: false, error: e.message } }
})

/** 测速 + 模型发现: 走 llm.discoverModels (参考 cc-switch EndpointSpeedTest) */
ipcMain.handle('provider-test', async (_e, provider) => {
  try {
    let p = provider || {}
    // 已保存的供应商: 渲染进程拿到的是掩码 key, 按 id 从 store 取真实 key
    if ((!p.apiKey || String(p.apiKey).startsWith('****')) && p.id) {
      const saved = (store.get('providers') || []).find((x) => x.id === p.id)
      if (saved) p = { ...saved, ...p }
    }
    if (!p.apiKey) return { ok: false, error: '需要 API Key（保存后无法测速）' }
    const t0 = Date.now()
    const r = await dshRpc('llm.discoverModels', {
      settingsNs: 'llm-pi-ai',
      provider: p.id || p.name,
      baseURL: p.baseURL,
      api: p.api || 'openai-completions',
      apiKey: p.apiKey,
    })
    const ms = Date.now() - t0
    if (!r || !r.result || !r.result.ok) {
      return { ok: false, ms, error: (r && r.result && r.result.error && r.result.error.message) || '超时或无响应' }
    }
    const models = (r.result.value.models || []).map((m) => m.id)
    return { ok: true, ms, models }
  } catch (e) { return { ok: false, error: e.message } }
})

// ====== 插件市场 (数据源: awesome-dsh-plugin.com/plugins.json) ======

const MARKET_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const MARKET_CACHE_TTL = 6 * 3600 * 1000 // 目录 6 小时缓存
let marketWindow = null

// 目录缓存存文件 (不塞 electron-store, 避免 config.json 膨胀到近 1MB)
function marketCacheFile() {
  try { return require('path').join(app.getPath('userData'), 'market-catalog.json') } catch (e) { return null }
}

function marketCache() {
  try {
    const f = marketCacheFile()
    if (!f || !require('fs').existsSync(f)) return null
    return JSON.parse(require('fs').readFileSync(f, 'utf8'))
  } catch (e) { return null }
}

function marketCacheSave(plugins) {
  try {
    const f = marketCacheFile()
    if (!f) return
    require('fs').writeFileSync(f, JSON.stringify({ fetchedAt: Date.now(), plugins }))
  } catch (e) { /* 缓存失败不影响使用 */ }
}

/** 拉取插件目录 (带缓存), 失败时用旧缓存 */
function fetchMarketCatalog() {
  return new Promise((resolve) => {
    const cached = marketCache()
    if (cached && Date.now() - cached.fetchedAt < MARKET_CACHE_TTL) return resolve(cached.plugins)
    const req = https.get(MARKET_CATALOG_URL, {
      headers: { 'user-agent': 'dshd-red/' + APP_VERSION, accept: 'application/json' },
      timeout: 15000,
    }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c; if (d.length > 8 * 1024 * 1024) res.destroy() })
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          const plugins = j.plugins || []
          marketCacheSave(plugins)
          resolve(plugins)
        } catch (e) { resolve(cached ? cached.plugins : null) }
      })
    })
    req.on('error', () => resolve(cached ? cached.plugins : null))
    req.on('timeout', () => { try { req.destroy() } catch (e) {} resolve(cached ? cached.plugins : null) })
    req.end()
  })
}

/** 已安装插件: 读 profile 的 package.json dependencies (pnpm add 写入) */
function installedPlugins() {
  try {
    const pkg = require('fs').readFileSync(require('path').join(dshHome(), 'profiles', 'web', 'package.json'), 'utf8')
    return Object.keys(JSON.parse(pkg).dependencies || {})
  } catch (e) { return [] }
}

/** 运行 dsh plugin 命令 (用真实 node + 本地 CLI; 打包含 path 用 npx) */
function runPluginCommand(args, onLine) {
  return new Promise(async (resolve) => {
    let runtime = null
    try { runtime = await findNodeRuntime() } catch (e) {}
    const devDsh = findDshCommand()
    let command, commandArgs, shell = false
    if (devDsh !== 'dsh' && devDsh.endsWith('.js')) {
      command = (runtime && runtime.node) || 'node'
      commandArgs = [devDsh, ...args]
    } else if (devDsh !== 'dsh') {
      command = devDsh
      commandArgs = args
    } else if (runtime) {
      command = runtime.npm || 'npm'
      commandArgs = ['exec', '-y', '@deepseek-ai/dsh', ...args]
      shell = process.platform === 'win32'
    } else {
      command = 'dsh'
      commandArgs = args
    }
    const env = { ...process.env, DSH_HOME: dshHome() }
    const child = spawn(command, commandArgs, { env, shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const push = (t) => { if (t && t.trim()) { out += t; if (onLine) onLine(t.trimEnd()) } }
    child.stdout.on('data', (d) => push(d.toString()))
    child.stderr.on('data', (d) => push(d.toString()))
    child.on('error', (e) => resolve({ ok: false, error: e.message, output: out }))
    child.on('exit', (code) => resolve({ ok: code === 0, code, output: out }))
  })
}

ipcMain.handle('market-catalog', async () => {
  const plugins = await fetchMarketCatalog()
  if (!plugins) return { ok: false, error: '无法获取插件目录 (网络/缓存为空)' }
  return {
    ok: true,
    plugins: plugins.map((p) => ({
      name: p.name,
      category: p.category || 'other',
      desc: (p.description && (p.description.zh || p.description.en)) || '',
      stars: p.stars || 0,
      install: p.install || '',
      url: p.url || '',
      added: p.added || '',
    })),
  }
})

ipcMain.handle('market-install', async (event, installCmd) => {
  try {
    if (!installCmd) return { ok: false, error: 'no install command' }
    // 只允许官方格式: dsh plugin --profile web add <pkg>
    const m = installCmd.match(/^dsh plugin --profile web (add|remove) (.+)$/)
    if (!m) return { ok: false, error: '非官方安装命令: ' + installCmd }
    const action = m[1]
    const target = m[2].trim()
    const send = (line) => { if (marketWindow && !marketWindow.isDestroyed()) marketWindow.webContents.send('market-install-line', line) }
    send('$ dsh plugin --profile web ' + action + ' ' + target)
    const r = await runPluginCommand(['plugin', '--profile', 'web', action, target], send)
    send(r.ok ? '✅ ' + (action === 'add' ? '安装完成' : '已移除') : '❌ 失败 (exit ' + r.code + ')')
    return { ok: r.ok, code: r.code, output: r.output }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('market-installed', () => ({ ok: true, installed: installedPlugins() }))

ipcMain.handle('market-clear-cache', () => {
  try { const f = marketCacheFile(); if (f) require('fs').unlinkSync(f) } catch (e) {}
  return { ok: true }
})

/** 插件市场窗口 */
function createMarketWindow() {
  marketWindow = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: true,
    title: t('market_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })
  marketWindow.loadFile(path.join(__dirname, 'market.html'), { query: { lang } })
  marketWindow.on('closed', () => { marketWindow = null })
  return marketWindow
}

// ====== 对话隔离 (按会话管理外部依赖: 技能 / MCP / 插件) ======
//
// 机制 (DSH 原生): 每个会话由一个 preset (agent.cordis.yml) 组合其插件、提示词和技能目录。
// Red 为每个会话派生一份 preset (red-iso-<sessionId>) 写入 $DSH_HOME/.agent-presets/,
// 空白会话用 agentPreset.select 热切换, 新会话在 session.create 时指定。
//   - 技能: 把 skill-filesystem 行改成白名单模式 (includeDefaultRoots:false +
//     customSkillDirs 指向 Red 管理的 junction 目录), 该会话只见启用的技能 (skill.list 按会话寻址)
//   - MCP: 追加 @deepseek-ai/dsh-mcp-client 行 (每个服务器一行, serverName 加会话短号,
//     mcp-client 的 serverName 在整进程内必须唯一)
//   - 插件: 追加插件行 (name 用 profile node_modules 里包入口的绝对路径, 预设行支持绝对路径)
// 已有内容的会话被 DSH 锁定 (agent-preset-locked), 隔离配置保留, 可在新会话/分叉会话生效。

let isolationWindow = null

/** 会话隔离 preset 的 id (DSH 预设目录名, 须匹配 ^[a-z0-9][a-z0-9-]*$) */
function isoPresetId(sessionId) {
  return 'red-iso-' + String(sessionId).replace(/[^a-z0-9-]/g, '-')
}

/** 该会话技能白名单根目录 (Red 管理的 junction/复制目录) */
function isoSkillDir(sessionId) {
  return require('path').join(app.getPath('userData'), 'isolation', isoPresetId(sessionId), 'skills')
}

/** YAML 标量: 安全的裸值直接输出, 否则单引号包裹 (内部单引号翻倍) */
function yamlScalar(v) {
  const s = String(v == null ? '' : v)
  if (/^[A-Za-z0-9_@./-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|[-+]?\d)/i.test(s)) return s
  return "'" + s.replace(/'/g, "''") + "'"
}

function yamlKey(k) {
  const s = String(k)
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : yamlScalar(s)
}

/** 技能来源根 (与 dsh-skill-filesystem 的 roots() 对齐) */
function skillSourceRoots(cwd) {
  const path = require('path')
  const os = require('os')
  const home = dshHome()
  const roots = []
  if (cwd) {
    roots.push({ dir: path.join(cwd, '.dsh', 'skills'), kind: 'project-dsh' })
    roots.push({ dir: path.join(cwd, '.agents', 'skills'), kind: 'project-agents' })
  }
  roots.push({ dir: path.join(home, 'skills'), kind: 'user-dsh' })
  roots.push({ dir: path.join(os.homedir(), '.agents', 'skills'), kind: 'user-agents' })
  const bundled = process.env.DSH_BUNDLED_SKILL_DIR
  if (bundled) roots.push({ dir: bundled, kind: 'bundled' })
  return roots
}

/** 按名字找到某个技能的源 (目录技能 <name>/SKILL.md 或扁平 <name>.md), 找不到返回 null */
function findSkillSource(name, cwd) {
  const fs = require('fs')
  const path = require('path')
  for (const { dir } of skillSourceRoots(cwd)) {
    try {
      const dirSkill = path.join(dir, name)
      if (fs.existsSync(path.join(dirSkill, 'SKILL.md'))) return { kind: 'dir', path: dirSkill }
      const fileSkill = path.join(dir, name + '.md')
      if (fs.existsSync(fileSkill)) return { kind: 'file', path: fileSkill }
    } catch (e) { /* 根目录不可读则跳过 */ }
  }
  return null
}

/** 重建某会话的技能白名单目录: 清空后 junction(Windows 免管理员)/复制启用的技能, 返回未找到项 */
function syncSkillWhitelist(sessionId, names, cwd) {
  const fs = require('fs')
  const path = require('path')
  const dir = isoSkillDir(sessionId)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const missing = []
  for (const name of names) {
    const src = findSkillSource(name, cwd)
    if (!src) { missing.push(name); continue }
    const dest = path.join(dir, name)
    try {
      if (src.kind === 'dir') {
        try { fs.symlinkSync(src.path, dest, 'junction') }
        catch (e) { fs.cpSync(src.path, dest, { recursive: true }) }
      } else {
        fs.copyFileSync(src.path, dest + '.md')
      }
    } catch (e) { missing.push(name + ' (失败: ' + e.message + ')') }
  }
  return missing
}

/** 把组合文本里的 skill-filesystem 行替换为白名单模式; 若没有该行 (如 minimal) 则追加并补齐 tool-skill */
function patchSkillFilesystemRow(text, skillDir) {
  const path = require('path')
  const dir = String(skillDir).replace(/\\/g, '/')
  const newRow = [
    '- id: skill-filesystem',
    "  name: '@deepseek-ai/dsh-skill-filesystem'",
    '  config:',
    '    includeDefaultRoots: false',
    '    customSkillDirs:',
    "      - '" + dir.replace(/'/g, "''") + "'",
  ].join('\n')
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^- id: skill-filesystem\s*$/.test(lines[i])) { start = i; break }
  }
  if (start === -1) {
    let out = text.trimEnd() + '\n'
    if (!/^- id: tool-skill\s*$/m.test(text)) {
      out += "\n# 技能目录 + 加载工具 (由 dshd Red 对话隔离追加)\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n"
    }
    return out + '\n# skill-filesystem: 白名单模式 (由 dshd Red 对话隔离改写)\n' + newRow + '\n'
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- /.test(lines[i])) { end = i; break }
  }
  return lines.slice(0, start).concat(newRow, lines.slice(end)).join('\n')
}

/** 生成该会话启用的 MCP 服务器行 (serverName 加会话短号, 保证整进程唯一) */
function mcpRowsFor(sessionId, enabledIds) {
  const servers = (store.get('mcpServers') || []).filter((s) => enabledIds.includes(s.id))
  const short = String(sessionId).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()
  return servers.map((s) => {
    const base = String(s.serverName || s.id || 'mcp').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 22)
    const serverName = (base + '-' + short).slice(0, 32)
    const lines = ['- id: mcp-' + serverName, "  name: '@deepseek-ai/dsh-mcp-client'", '  config:']
    lines.push('    transport: ' + (s.transport === 'streamable-http' ? 'streamable-http' : 'stdio'))
    lines.push('    serverName: ' + yamlScalar(serverName))
    if (s.transport === 'streamable-http') {
      lines.push('    url: ' + yamlScalar(String(s.url || '')))
      const hdrs = (s.headers && typeof s.headers === 'object') ? s.headers : {}
      const hk = Object.keys(hdrs)
      if (hk.length) {
        lines.push('    headers:')
        for (const k of hk) lines.push('      ' + yamlKey(k) + ': ' + yamlScalar(String(hdrs[k])))
      }
    } else {
      lines.push('    command: ' + yamlScalar(String(s.command || '')))
      const args = Array.isArray(s.args) ? s.args.map(String).filter(Boolean) : []
      if (args.length) {
        lines.push('    args:')
        for (const a of args) lines.push('      - ' + yamlScalar(a))
      }
      const env = (s.env && typeof s.env === 'object') ? s.env : {}
      const ek = Object.keys(env)
      if (ek.length) {
        lines.push('    env:')
        for (const k of ek) lines.push('      ' + yamlKey(k) + ': ' + yamlScalar(String(env[k])))
      }
      if (s.cwd) lines.push('    cwd: ' + yamlScalar(String(s.cwd)))
    }
    if (s.timeoutMs) lines.push('    toolCallTimeoutMs: ' + Number(s.timeoutMs))
    return lines.join('\n')
  })
}

/** 解析 profile node_modules 里某包名的插件入口 (exports.import / main / index.js), 返回绝对路径或 null */
function resolvePluginEntry(name) {
  const fs = require('fs')
  const path = require('path')
  try {
    const pkgDir = path.join(dshHome(), 'profiles', 'web', 'node_modules', name)
    const pkgFile = path.join(pkgDir, 'package.json')
    if (!fs.existsSync(pkgFile)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    let rel = null
    const ex = pkg.exports && pkg.exports['.']
    if (typeof ex === 'string') rel = ex
    else if (ex && typeof ex === 'object') {
      const imp = ex.import
      if (typeof imp === 'string') rel = imp
      else if (imp && typeof imp.default === 'string') rel = imp.default
      else if (typeof ex.default === 'string') rel = ex.default
    }
    if (!rel) rel = pkg.main || 'index.js'
    if (!rel.startsWith('.')) rel = './' + rel
    const abs = path.join(pkgDir, rel)
    return fs.existsSync(abs) ? abs : null
  } catch (e) { return null }
}

/** 生成该会话启用的插件行 (name 用绝对入口路径, 预设行解析支持绝对路径) */
function pluginRowsFor(names) {
  const rows = []
  for (const name of names) {
    if (!name) continue
    const entry = resolvePluginEntry(name)
    const slug = String(name).replace(/[@/\\\s]/g, '-').replace(/^-+/, '').slice(0, 24) || 'plugin'
    const lines = ['- id: iso-plugin-' + slug]
    if (entry) lines.push('  name: ' + yamlScalar(entry.replace(/\\/g, '/')))
    else lines.push('  name: ' + yamlScalar(name))
    rows.push(lines.join('\n'))
  }
  return rows
}

/** 把组合文本里的某顶层行禁用 (插入 disabled: true)。用于 cordis 基础预设的单实例自省工具集。 */
function disableRowBlock(text, rowId) {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^- id: ' + rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$').test(lines[i])) { start = i; break }
  }
  if (start === -1) return text
  let nameAt = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- /.test(lines[i])) break
    if (/^\s+name:/.test(lines[i])) { nameAt = i; break }
  }
  if (nameAt === -1) return text
  for (let i = start + 1; i < nameAt; i++) {
    if (/^\s+disabled:/.test(lines[i])) return text // 已禁用
  }
  lines.splice(nameAt + 1, 0, '  disabled: true')
  return lines.join('\n')
}

/** 派生隔离预设的组合文本: 基础预设原文 + 技能行改写 + 追加 MCP/插件行 (不删除任何基础功能) */
function deriveIsolationPreset(baseText, opts) {
  let text = String(baseText || '')
  if (opts.skillIsolation && opts.skillDir) text = patchSkillFilesystemRow(text, opts.skillDir)
  // 基础预设里只能全进程单实例的行 (cordis 的自省工具集): 派生副本里禁用, 基础预设原样保留
  for (const rowId of SINGLE_INSTANCE_ROWS[opts.base] || []) text = disableRowBlock(text, rowId)
  const appends = []
  if (opts.mcpRows && opts.mcpRows.length) appends.push(...opts.mcpRows)
  if (opts.pluginRows && opts.pluginRows.length) appends.push(...opts.pluginRows)
  if (appends.length) {
    text = text.trimEnd() + '\n'
    for (const row of appends) text += '\n# 外部依赖 (由 dshd Red 对话隔离追加)\n' + row + '\n'
  }
  return text
}

/** 全进程只能挂载一次的预设行 (注册进程级服务, 见 cordis-host-runner 的 inspect 注册表) */
const SINGLE_INSTANCE_ROWS = { cordis: ['tool-cordis'] }

/** 保存某会话的隔离状态 (UI 复选回显用) */
function saveIsoState(sessionId, req) {
  const state = store.get('isolation') || {}
  state[sessionId] = {
    base: req.base,
    skillIsolation: !!req.skillIsolation,
    skills: req.skills || [],
    mcp: req.mcp || [],
    plugins: req.plugins || [],
    updatedAt: Date.now(),
  }
  store.set('isolation', state)
}

function briefRpc(r) {
  if (!r) return '无响应'
  if (r.result && !r.result.ok) {
    const e = r.result.error
    if (e && e.message) return e.message
    return JSON.stringify(e || r.result)
  }
  return JSON.stringify(r).slice(0, 300)
}

/** 派生并落盘隔离预设, 返回 {presetId, content, skillMissing, wrote} */
async function materializeIsolationPreset(sessionId, req) {
  const path = require('path')
  const fs = require('fs')
  const rr = await dshRpc('agentPreset.read', { agentPreset: req.base })
  if (!rr || !rr.result || !rr.result.ok) {
    return { error: '读取基础预设失败: ' + briefRpc(rr) }
  }
  const baseText = rr.result.value.content
  const skillIsolation = !!req.skillIsolation && Array.isArray(req.skills) && req.skills.length > 0
  const skillMissing = []
  let skillDir = null
  if (skillIsolation) {
    skillDir = isoSkillDir(sessionId)
    skillMissing.push(...syncSkillWhitelist(sessionId, req.skills, req.cwd))
  }
  const mcpRows = mcpRowsFor(sessionId, req.mcp || [])
  const pluginRows = pluginRowsFor(req.plugins || [])
  if (!skillIsolation && !mcpRows.length && !pluginRows.length) {
    return { wrote: false, presetId: null, skillMissing, skillIsolation: false }
  }
  const content = deriveIsolationPreset(baseText, { base: req.base, skillIsolation, skillDir, mcpRows, pluginRows })
  const presetId = isoPresetId(sessionId)
  const dir = path.join(dshHome(), '.agent-presets', presetId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), content)
  const title = String(req.title || '会话').replace(/[\\\n\r]/g, ' ').trim().slice(0, 24) || '会话'
  fs.writeFileSync(path.join(dir, 'preset.yml'),
    'name: ' + yamlScalar('隔离·' + title) + '\n' +
    'description: dshd Red 分对话隔离 (技能/MCP/插件)\n' +
    'order: 9999\n')
  return { wrote: true, presetId, content, skillMissing, skillIsolation }
}

ipcMain.handle('isolation-list', async () => {
  const [sr, pr] = await Promise.all([dshRpc('session.list', {}), dshRpc('agentPreset.list', {})])
  const unwrap = (r) => (r && r.result && r.result.ok) ? r.result.value : null
  const sessions = ((unwrap(sr) || {}).items || []).map((s) => ({
    sessionId: s.sessionId,
    title: (s.projections && s.projections.values && s.projections.values.title) || null,
    running: !!s.running,
    blank: !!s.blank,
    preset: s.agentPreset || null,
    cwd: s.cwd || null,
  }))
  const presets = ((unwrap(pr) || {}).presets || []).map((p) => ({
    id: p.id, name: p.name || p.id, trust: p.trust, isDefault: !!p.isDefault,
    description: p.description || '',
  }))
  return { ok: true, sessions, presets, state: store.get('isolation') || {} }
})

ipcMain.handle('isolation-session-skills', async (_e, sessionId) => {
  const r = await dshRpc('skill.list', { sessionId: String(sessionId) })
  const v = (r && r.result && r.result.ok) ? r.result.value : null
  return { ok: true, skills: v ? v.skills.map((s) => ({ name: s.name, description: s.description, modelInvocable: s.modelInvocable })) : [] }
})

const FEATURED_ISOLATION_PLUGINS = ['dsh-plugin-toggle', 'dsh-mcp-manager', 'dsh-skill-picker', 'dsh-claude-move', 'claude2dsh']

ipcMain.handle('isolation-plugin-catalog', async () => {
  const installed = installedPlugins()
  let bundles = []
  try {
    const pkg = JSON.parse(require('fs').readFileSync(require('path').join(dshHome(), 'profiles', 'web', 'package.json'), 'utf8'))
    bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  } catch (e) {}
  const seen = new Set()
  const plugins = []
  for (const n of [...installed, ...FEATURED_ISOLATION_PLUGINS]) {
    if (seen.has(n)) continue
    seen.add(n)
    plugins.push({
      name: n,
      installed: installed.includes(n),
      global: bundles.includes(n),
      featured: FEATURED_ISOLATION_PLUGINS.includes(n),
      entry: resolvePluginEntry(n),
    })
  }
  return { ok: true, plugins }
})

ipcMain.handle('isolation-mcp-list', () => ({ ok: true, servers: store.get('mcpServers') || [] }))

ipcMain.handle('isolation-mcp-save', (_e, servers) => {
  store.set('mcpServers', Array.isArray(servers) ? servers : [])
  return { ok: true }
})

/** 按会话安装插件: 直接 pnpm add 进 profile (不走 dsh plugin 的 bundle 对账, 不全局挂载) */
ipcMain.handle('isolation-install-dep', (_e, pkg) => {
  return new Promise((resolve) => {
    const path = require('path')
    const profileDir = path.join(dshHome(), 'profiles', 'web')
    const child = spawn('pnpm', ['add', String(pkg)], {
      cwd: profileDir, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolve({ ok: false, error: e.message, output: out }))
    child.on('exit', (code) => resolve({ ok: code === 0, code, output: out.slice(-2000) }))
  })
})

/** 应用到会话: 派生预设 → 落盘 → agentPreset.select (空白会话可切换; 非空白返回 locked, 配置保留) */
ipcMain.handle('isolation-apply', async (_e, req) => {
  try {
    const sessionId = String(req.sessionId)
    const m = await materializeIsolationPreset(sessionId, req)
    if (m.error) return { ok: false, error: m.error }
    if (!m.wrote) {
      // 无任何隔离项: 直接切回基础预设 (重置)
      const sel = await dshRpc('agentPreset.select', { sessionId, agentPreset: req.base })
      if (sel && sel.result && sel.result.ok) { saveIsoState(sessionId, req); return { ok: true, reset: true, presetId: req.base } }
      return { ok: false, locked: true, error: briefRpc(sel) }
    }
    const sel = await dshRpc('agentPreset.select', { sessionId, agentPreset: m.presetId })
    if (sel && sel.result && sel.result.ok) {
      saveIsoState(sessionId, req)
      return { ok: true, presetId: m.presetId, skillMissing: m.skillMissing }
    }
    const err = sel && sel.result && sel.result.error
    const code = err && err.code
    const msg = (err && err.message) || briefRpc(sel)
    if (code === 'agent-preset-locked') {
      saveIsoState(sessionId, req)
      return { ok: false, locked: true, presetId: m.presetId, error: msg }
    }
    return { ok: false, error: msg, presetId: m.presetId, skillMissing: m.skillMissing }
  } catch (e) { return { ok: false, error: e.message } }
})

/** 以某隔离配置新建会话: 生成 sessionId → 派生预设 → session.create {sessionId, agentPreset} */
ipcMain.handle('isolation-new-session', async (_e, req) => {
  try {
    const crypto = require('crypto')
    const sessionId = 'session-' + crypto.randomUUID()
    const m = await materializeIsolationPreset(sessionId, req)
    if (m.error) return { ok: false, error: m.error }
    if (!m.wrote) {
      const cr = await dshRpc('session.create', { sessionId, agentPreset: req.base })
      if (cr && cr.result && cr.result.ok) { saveIsoState(sessionId, req); return { ok: true, sessionId, presetId: req.base } }
      return { ok: false, error: briefRpc(cr) }
    }
    const cr = await dshRpc('session.create', { sessionId, agentPreset: m.presetId })
    if (cr && cr.result && cr.result.ok) {
      saveIsoState(sessionId, req)
      return { ok: true, sessionId, presetId: m.presetId, skillMissing: m.skillMissing }
    }
    return { ok: false, error: briefRpc(cr), presetId: m.presetId, skillMissing: m.skillMissing }
  } catch (e) { return { ok: false, error: e.message } }
})

/** 对话隔离窗口 */
function createIsolationWindow() {
  isolationWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    resizable: true,
    title: t('isolation_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })
  isolationWindow.loadFile(path.join(__dirname, 'isolation.html'), { query: { lang } })
  isolationWindow.on('closed', () => { isolationWindow = null })
  return isolationWindow
}

// ====== 安全网关窗口 (状态/启停/文件传输入口) ======

let gatewayWindow = null

function httpGetJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c; if (d.length > 1024 * 1024) res.destroy() })
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { try { req.destroy() } catch (e) {} resolve(null) })
  })
}

ipcMain.handle('gateway-status', async () => {
  const port = gatewayPort()
  const token = gatewayToken()
  const api = 'http://127.0.0.1:' + port + '/admin/api/state?token=' + token
  const st = await httpGetJson(api)
  const online = !!(st && st.ok)
  const lanIp = getLanIp()
  return {
    ok: true,
    state: {
      online,
      version: st ? st.version : null,
      upstream: st ? st.upstream : null,
      totalRequests: st ? st.totalRequests : 0,
      deviceCount: st ? st.deviceCount : 0,
      devices: st ? st.devices || [] : [],
      tokenMasked: st ? st.tokenMasked : (token ? token.slice(0, 4) + '…' + token.slice(-4) : '-'),
      fsUrl: 'http://' + lanIp + ':' + port + '/fs/list?token=' + token,
      adminUrl: api,
    },
  }
})

ipcMain.handle('gateway-toggle', async (_e, on) => {
  try {
    if (on) { startRemoteGateway(); return { ok: true } }
    stopRemoteGateway(); return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

function createGatewayWindow() {
  gatewayWindow = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: true,
    title: t('gateway_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })
  gatewayWindow.loadFile(path.join(__dirname, 'gateway.html'), { query: { lang } })
  gatewayWindow.on('closed', () => { gatewayWindow = null })
  return gatewayWindow
}

// ====== 窗口管理 ======

/** 供应商管理窗口 (功能参考 cc-switch, MIT) */
function createProviderWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 640,
    resizable: true,
    title: t('providers_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })
  win.loadFile(path.join(__dirname, 'provider.html'), { query: { lang } })
  return win
}

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
  const SIDEBAR = 210

  // 壳窗口: 左侧边栏 (dshd Red 功能入口); 右侧用 WebContentsView 承载 DSH Web UI
  // (WebContentsView 视口可靠跟随 setBounds, 避免 <webview> guest 卡 150px 的问题)
  mainWindow = new BrowserWindow({
    width, height, minWidth: 720, minHeight: 480,
    title: 'dshd Red',
    backgroundColor: '#0f0f1e',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'shell-preload.js'),
    },
    show: true,
  })

  mainWindow.loadFile(path.join(__dirname, 'shell.html'), {
    query: { dsUrl: url, port: String(port) },
  }).catch(() => {})

  // DSH UI 视图
  dshView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  })
  mainWindow.contentView.addChildView(dshView)

  let dshRetry = 0
  const layoutView = () => {
    const [w, h] = mainWindow.getContentSize()
    dshView.setBounds({ x: SIDEBAR, y: 0, width: Math.max(0, w - SIDEBAR), height: h })
  }
  layoutView()
  mainWindow.on('resize', layoutView)

  const loadDs = () => {
    if (isQuitting) return
    dshView.webContents.loadURL(url).catch(() => { /* did-fail-load 处理 */ })
  }
  dshView.webContents.on('did-fail-load', () => {
    // DSH 未就绪: 隔 3 秒重试 (最多 20 次), 壳侧栏状态灯会显示离线
    if (isQuitting) return
    dshRetry++
    if (dshRetry <= 20) setTimeout(loadDs, 3000)
  })
  dshView.webContents.on('did-finish-load', () => { dshRetry = 0 })

  // DSH 视图渲染进程崩溃自愈
  dshView.webContents.on('render-process-gone', (_event, details) => {
    console.log('dshd Red: DSH 视图渲染进程退出 (' + details.reason + '), 3 秒后重载')
    if (isQuitting) return
    setTimeout(loadDs, 3000)
  })

  loadDs()

  // 壳自身渲染进程崩溃自愈
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.log('dshd Red: 壳渲染进程退出 (' + details.reason + '), 2 秒后自动重载')
    if (isQuitting) return
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, 'shell.html'), { query: { dsUrl: url, port: String(port) } }).catch(() => {})
      }
    }, 2000)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (dshView) { try { dshView.webContents.close() } catch (e) {} dshView = null }
  })

  Menu.setApplicationMenu(buildMenu())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  createTray()
}

// ====== 壳侧栏动作 + DSH 状态推送 ======

ipcMain.on('shell-action', (event, which) => {
  switch (which) {
    case 'conn': createConnectionWindow(); break
    case 'providers': createProviderWindow(); break
    case 'market': createMarketWindow(); break
    case 'isolation': createIsolationWindow(); break
    case 'extras': createMarketWindow(); break // 扩展管理 = 市场(已安装视图)
    case 'gateway': createGatewayWindow(); break
    case 'guardian': createGuardianWindow(); break
    case 'migrate': setupMigrateImport(); break
    case 'restart': restartDsh(); break
  }
})

/** 迁移导入: 一键安装 dsh-claude-move (若未装), 提示在 DSH 界面用 /move 向导 */
async function setupMigrateImport() {
  try {
    const installed = installedPlugins()
    const hasMove = installed.some((n) => n.includes('claude-move') || n.includes('claude2dsh'))
    if (!hasMove) {
      const ok = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: t('migrate_title'),
        message: t('migrate_install_msg'),
        detail: 'dsh-claude-move — 从 Claude Code / Codex / OpenCode / Hermes 迁移会话、记忆、技能、指令',
        buttons: [t('update_go'), t('update_later')],
      })
      if (ok.response !== 0) return
      const r = await runPluginCommand(['plugin', '--profile', 'web', 'add', 'dsh-claude-move'], null)
      if (!r.ok) {
        dialog.showMessageBox(mainWindow, { type: 'error', title: t('migrate_title'), message: '安装失败: ' + (r.error || r.output || '') })
        return
      }
    }
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: t('migrate_title'),
      message: t('migrate_done_msg'),
      detail: '在右侧 DSH 界面输入 /move 打开迁移向导；或输入 /claude2dsh 使用双向同步（Claude Code）。',
    })
  } catch (e) {
    dialog.showMessageBox(mainWindow, { type: 'error', title: t('migrate_title'), message: e.message })
  }
}

// ====== 守护 (内置 dshd Green) ======

let guardianWindow = null

/** 运行内置 dshd-green CLI, 不向窗口推送 (结构化 JSON 用), 返回输出 */
function runGreenSilent(args) {
  return new Promise((resolve) => {
    const cli = path.join(__dirname, 'guardian', 'dshd-green-cli.js')
    const env = { ...process.env, DSH_HOME: dshHome(), ELECTRON_RUN_AS_NODE: '1' }
    try {
      const libCli = path.join(__dirname, '..', '..', '..', 'apps', 'cli', 'lib', 'bin.js')
      if (require('fs').existsSync(libCli)) env.DSH_GREEN_DSH = 'node ' + libCli
      else {
        const devDsh = findDshCommand()
        if (devDsh !== 'dsh' && devDsh.endsWith('.js')) env.DSH_GREEN_DSH = 'node ' + devDsh
      }
    } catch (e) { /* 默认 npx */ }
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolve({ ok: false, error: e.message, output: out }))
    child.on('exit', (code) => resolve({ ok: code === 0, code, output: out }))
  })
}

/** 运行内置 dshd-green CLI (vendor 在 src/guardian), 返回输出 */
function runGreen(args) {
  return new Promise((resolve) => {
    const cli = path.join(__dirname, 'guardian', 'dshd-green-cli.js')
    const env = { ...process.env, DSH_HOME: dshHome(), ELECTRON_RUN_AS_NODE: '1' }
    // 救援进程的 dsh CLI: 开发环境指向本仓库编译版 CLI (无需 tsx), 生产环境走 npx 独立安装
    try {
      const libCli = path.join(__dirname, '..', '..', '..', 'apps', 'cli', 'lib', 'bin.js')
      if (require('fs').existsSync(libCli)) env.DSH_GREEN_DSH = 'node ' + libCli
      else {
        const devDsh = findDshCommand()
        if (devDsh !== 'dsh' && devDsh.endsWith('.js')) env.DSH_GREEN_DSH = 'node ' + devDsh
      }
    } catch (e) { /* 默认 npx */ }
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const push = (t) => {
      out += t
      if (guardianWindow && !guardianWindow.isDestroyed()) guardianWindow.webContents.send('guardian-line', t)
    }
    child.stdout.on('data', (d) => push(d.toString()))
    child.stderr.on('data', (d) => push(d.toString()))
    child.on('error', (e) => resolve({ ok: false, error: e.message, output: out }))
    child.on('exit', (code) => resolve({ ok: code === 0, code, output: out }))
  })
}

ipcMain.handle('guardian-run', async (_e, cmd) => {
  // 兼容字符串 (空格分割) 和数组 (多词参数如救援问题描述)
  const args = Array.isArray(cmd) ? cmd.map(String) : String(cmd || 'status').split(' ')
  return await runGreen(args)
})

ipcMain.handle('guardian-json', async (_e, args) => {
  const r = await runGreenSilent([...(Array.isArray(args) ? args : String(args || 'status').split(' ')), '--json'])
  try {
    const lines = r.output.trim().split(/\r?\n/).filter(Boolean)
    return { ok: true, json: JSON.parse(lines[lines.length - 1]) }
  } catch (e) {
    return { ok: false, error: r.error || 'JSON 解析失败', output: r.output }
  }
})

function createGuardianWindow() {
  guardianWindow = new BrowserWindow({
    width: 620,
    height: 560,
    resizable: true,
    title: t('guardian_title'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    parent: mainWindow,
  })
  guardianWindow.loadFile(path.join(__dirname, 'guardian.html'), { query: { lang } })
  guardianWindow.on('closed', () => { guardianWindow = null })
  return guardianWindow
}

let lastShellStatus = null
function pushShellStatus() {
  if (mainWindow && !mainWindow.isDestroyed() && lastShellStatus) {
    mainWindow.webContents.send('dsh-status', lastShellStatus)
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: t('menu_dsh'),
      submenu: [
        { label: t('menu_remote_connection'), accelerator: 'CmdOrCtrl+R', click: () => createConnectionWindow() },
        { label: t('menu_providers'), accelerator: 'CmdOrCtrl+P', click: () => createProviderWindow() },
        { label: t('menu_plugins'), accelerator: 'CmdOrCtrl+Shift+P', click: () => createMarketWindow() },
        { label: t('menu_isolation'), accelerator: 'CmdOrCtrl+Shift+I', click: () => createIsolationWindow() },
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

  // 任务完成通知: 每 2.5 秒轮询会话状态
  setInterval(pollSessionStatus, 2500)

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
    console.log('dshd Red: DSH already running, connecting...')
    createWindow()
  } else if (store.get('autoStartDsh')) {
    console.log('dshd Red: Starting DSH server...')
    const loading = createLoadingWindow()
    try {
      // 确保 Node.js 运行时（缺则自动下载，带进度条）
      const runtime = await ensureNodeRuntime(loading)
      // 确保 DSH（开发环境用本地；否则 npx 自动下载）
      await startDshInBackground(host, port, runtime, loading)
      console.log('dshd Red: DSH started, opening window...')
      loading.close()
      createWindow()
    } catch (err) {
      console.error('dshd Red: Failed to start DSH:', err.message)
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