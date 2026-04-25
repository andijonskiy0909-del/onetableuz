const { verify } = require('../utils/jwt')
const db = require('../config/db')
const AppError = require('../utils/AppError')
const crypto = require('crypto')

// ── User auth (Mini App customers) ──
async function authUser(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) throw AppError.unauthorized('Token yo\'q')

    const payload = verify(token)
    if (!payload || payload.kind !== 'user') throw AppError.unauthorized('Yaroqsiz token')

    const r = await db.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.id])
    if (!r.rows.length) throw AppError.unauthorized('Foydalanuvchi topilmadi')

    req.user = r.rows[0]
    next()
  } catch (e) {
    if (e.isOperational) return res.status(e.status).json({ error: e.message })
    res.status(401).json({ error: 'Auth xatolik' })
  }
}

// ── Optional user auth ──
async function authUserOptional(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return next()
    const payload = verify(token)
    if (payload && payload.kind === 'user') {
      const r = await db.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.id])
      if (r.rows.length) req.user = r.rows[0]
    }
    next()
  } catch { next() }
}

// ── Owner auth (Dashboard) ──
async function authOwner(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) throw AppError.unauthorized('Token yo\'q')

    const payload = verify(token)
    if (!payload || payload.kind !== 'owner') throw AppError.unauthorized('Yaroqsiz token')

    const r = await db.query('SELECT * FROM owners WHERE id = $1 AND is_active = true', [payload.id])
    if (!r.rows.length) throw AppError.unauthorized('Egasi topilmadi')

    req.owner = r.rows[0]
    next()
  } catch (e) {
    if (e.isOperational) return res.status(e.status).json({ error: e.message })
    res.status(401).json({ error: 'Auth xatolik' })
  }
}

// ── Admin auth ──
async function authAdmin(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) throw AppError.unauthorized('Token yo\'q')

    const payload = verify(token)
    if (!payload || payload.kind !== 'admin') throw AppError.unauthorized('Admin emas')

    const r = await db.query('SELECT * FROM admins WHERE id = $1 AND is_active = true', [payload.id])
    if (!r.rows.length) throw AppError.unauthorized('Admin topilmadi')

    req.admin = r.rows[0]
    next()
  } catch (e) {
    if (e.isOperational) return res.status(e.status).json({ error: e.message })
    res.status(401).json({ error: 'Auth xatolik' })
  }
}

// ── Telegram WebApp initData validation ──
// Validates data from Telegram Mini App to prevent spoofing
function authTelegramWebApp(req, res, next) {
  try {
    const initData = req.headers['x-telegram-init-data'] || req.body?.initData
    if (!initData) return next() // Allow non-Telegram clients in dev

    const botToken = process.env.BOT_TOKEN
    if (!botToken) return next() // Skip validation if no bot token

    const parsed = new URLSearchParams(initData)
    const hash = parsed.get('hash')
    if (!hash) throw AppError.unauthorized('Invalid initData: no hash')

    parsed.delete('hash')
    const entries = [...parsed.entries()].sort(([a], [b]) => a.localeCompare(b))
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

    if (computedHash !== hash) throw AppError.unauthorized('Invalid Telegram initData')

    // Parse user data from validated initData
    const userStr = parsed.get('user')
    if (userStr) {
      try { req.telegramUser = JSON.parse(userStr) } catch {}
    }

    // Check auth_date is not too old (5 minutes)
    const authDate = Number(parsed.get('auth_date'))
    if (authDate && Date.now() / 1000 - authDate > 300) {
      throw AppError.unauthorized('Telegram initData expired')
    }

    next()
  } catch (e) {
    if (e.isOperational) return res.status(e.status).json({ error: e.message })
    res.status(401).json({ error: 'Telegram auth xatolik' })
  }
}

// ── Extract token from Authorization header OR HttpOnly cookie ──
function extractToken(req) {
  // 1. Try Authorization header first
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7)

  // 2. Fallback to HttpOnly cookie
  if (req.cookies?.ot_token) return req.cookies.ot_token
  if (req.cookies?.ot_owner_token) return req.cookies.ot_owner_token
  if (req.cookies?.ot_admin_token) return req.cookies.ot_admin_token

  return null
}

module.exports = { authUser, authUserOptional, authOwner, authAdmin, authTelegramWebApp }

