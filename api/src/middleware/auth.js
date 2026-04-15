const { verify } = require('../utils/jwt')
const db = require('../config/db')
const AppError = require('../utils/AppError')

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

function extractToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

module.exports = { authUser, authUserOptional, authOwner, authAdmin }
