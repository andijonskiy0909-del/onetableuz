const { verify } = require('../utils/jwt')
const db = require('../config/db')

async function authUser(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Token yoʻq' })

    const payload = verify(token)
    if (!payload || payload.kind !== 'user') return res.status(401).json({ error: 'Yaroqsiz token' })

    const r = await db.query('SELECT * FROM users WHERE id = $1', [payload.id])
    if (!r.rows.length) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' })

    req.user = r.rows[0]
    next()
  } catch (e) {
    res.status(401).json({ error: 'Auth xatolik' })
  }
}

async function authUserOptional(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return next()
    const payload = verify(token)
    if (payload && payload.kind === 'user') {
      const r = await db.query('SELECT * FROM users WHERE id = $1', [payload.id])
      if (r.rows.length) req.user = r.rows[0]
    }
    next()
  } catch { next() }
}

module.exports = { authUser, authUserOptional }
