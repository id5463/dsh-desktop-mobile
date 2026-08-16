'use strict'
/**
 * LAN 网关鉴权 (首次访问需连接码/令牌, 通过后下发 Cookie)
 *
 * 集成自开源社区 (MIT):
 *   - dsh-Remote 网关 token 鉴权思路 (https://github.com/Blank-not-black/dsh-Remote)
 *   - dsh-mobile-gate 首次访问审批思路 (https://github.com/Bernardxu123/dsh-mobile-gate)
 *
 * 职责:
 *   1. 校验请求携带的令牌: URL ?token= / Authorization Bearer / Cookie
 *   2. 未授权时返回输入页(连接码/令牌), 提交校验通过后 Set-Cookie 放行
 *   3. 每 IP 限速(防暴力猜连接码)
 *   4. WebSocket 升级同样校验
 *   5. 转发到上游前剥离 ?token= 参数
 */
const crypto = require('node:crypto')

function createGate(opts) {
  const getSecrets = opts.getSecrets || (() => [])
  const cookieName = opts.cookieName || 'dsh_gate'
  const maxTries = opts.maxTries || 5
  const windowMs = opts.windowMs || 60 * 1000
  const lockoutMs = opts.lockoutMs || 60 * 1000
  const attempts = new Map() // ip -> { count, resetAt, lockedUntil }

  function secrets() {
    return (getSecrets() || []).filter(Boolean).map(String)
  }

  function isSecret(value) {
    if (!value) return false
    const s = secrets()
    for (const secret of s) {
      if (value.length === secret.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(secret))) {
        return true
      }
    }
    return false
  }

  function clientToken(req, url) {
    if (url && url.searchParams) {
      const q = url.searchParams.get('token')
      if (q) return q
    }
    const auth = String(req.headers.authorization || '')
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) return m[1]
    const cookie = String(req.headers.cookie || '')
    const mm = new RegExp('(?:^|;)\\s*' + cookieName + '=([^;]+)').exec(cookie)
    return mm ? decodeURIComponent(mm[1]) : null
  }

  function isAuthed(req, url) {
    return isSecret(clientToken(req, url))
  }

  function record(ip) {
    const now = Date.now()
    let a = attempts.get(ip)
    if (!a || now > a.resetAt) {
      a = { count: 0, resetAt: now + windowMs, lockedUntil: 0 }
      attempts.set(ip, a)
    }
    return a
  }

  function rateLimited(ip) {
    const a = record(ip)
    return Date.now() < a.lockedUntil
  }

  function attemptEntry(ip, value) {
    const a = record(ip)
    if (isSecret(value)) {
      attempts.delete(ip)
      return true
    }
    a.count++
    if (a.count >= maxTries) {
      a.lockedUntil = Date.now() + lockoutMs
      a.count = 0
    }
    return false
  }

  function stripToken(rawUrl) {
    const u = new URL(rawUrl, 'http://dsh.local')
    u.searchParams.delete('token')
    return u.pathname + u.search
  }

  function entryHtml(req, url, ip) {
    const action = '/__dsh_gate'
    const back = stripToken(req.url)
    const lock = rateLimited(ip)
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>DSH Access</title><style>' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;padding:32px 16px}' +
      '.card{background:#16213e;border-radius:12px;padding:32px;max-width:360px;width:100%;text-align:center}' +
      'h1{font-size:18px;color:#fff;margin-bottom:8px}' +
      'p{font-size:13px;color:#a0a0b0;margin-bottom:20px}' +
      'input{width:100%;padding:12px;border-radius:8px;border:1px solid #0f3460;background:#0f3460;' +
      'color:#fff;font-size:18px;text-align:center;letter-spacing:2px;margin-bottom:12px;outline:none}' +
      'button{width:100%;padding:12px;border:none;border-radius:8px;background:#dc3545;color:#fff;' +
      'font-size:15px;cursor:pointer}' +
      '.err{color:#ef9a9a;font-size:13px;margin-bottom:12px;display:none}' +
      '</style></head><body><div class="card">' +
      '<h1>DSH Remote Access</h1>' +
      '<p>输入桌面端「远程连接」窗口中显示的连接码<br>Enter the connection code shown in the desktop app</p>' +
      (lock ? '<p class="err" style="display:block">尝试次数过多，请 1 分钟后再试 / Too many attempts, wait a minute</p>' : '') +
      '<form method="POST" action="' + action + '">' +
      '<input type="hidden" name="back" value="' + back.replace(/"/g, '&quot;') + '">' +
      '<input type="text" name="code" placeholder="连接码 / Code" autocomplete="off" autocapitalize="characters" required>' +
      '<button type="submit">连接 / Connect</button>' +
      '</form></div></body></html>'
  }

  function hasCookie(req) {
    return new RegExp('(?:^|;)\\s*' + cookieName + '=').test(String(req.headers.cookie || ''))
  }

  /**
   * 在 HTTP 请求处理中调用: 返回 true 表示已自行应答(未授权/限速/提交校验),
   * 返回 false 表示已授权, 调用方继续代理转发。
   */
  function handle(req, res, url, ip) {
    if (isAuthed(req, url)) {
      // 授权来自 URL/头而非 cookie 时, 顺手下发 cookie, 保证 SPA 前端路由跳转后仍保持登录
      if (!hasCookie(req)) {
        res.setHeader('set-cookie', cookieName + '=' + encodeURIComponent(secrets()[0] || '') + '; Path=/; HttpOnly; SameSite=Lax')
      }
      return false
    }

    if (rateLimited(ip)) {
      res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' })
      res.end(entryHtml(req, url, ip))
      return true
    }

    if (req.method === 'POST' && url.pathname === '/__dsh_gate') {
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy() })
      req.on('end', () => {
        const form = new URLSearchParams(body)
        const code = String(form.get('code') || '').trim().toUpperCase()
        const back = String(form.get('back') || '/')
        if (attemptEntry(ip, code)) {
          res.writeHead(302, {
            location: back.startsWith('/') ? back : '/',
            'set-cookie': cookieName + '=' + encodeURIComponent(secrets()[0] || '') + '; Path=/; HttpOnly; SameSite=Lax',
          })
          res.end()
        } else {
          res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' })
          res.end(entryHtml(req, url, ip))
        }
      })
      return true
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(entryHtml(req, url, ip))
    return true
  }

  /** WebSocket 升级校验: 通过返回 true。 */
  function checkUpgrade(req, url) {
    return isAuthed(req, url)
  }

  return { handle, checkUpgrade, stripToken, isAuthed, isSecret }
}

module.exports = { createGate }
