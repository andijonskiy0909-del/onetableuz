const { verify } = require('../utils/jwt')
const db = require('../config/db')

async function authOwner(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Token yoʻq' })

    const payload = verify(token)
    if (!payload || payload.kind !== 'owner') return res.status(401).json({ error: 'Yaroqsiz token' })

    const r = await db.query('SELECT * FROM owners WHERE id = $1', [payload.id])
    if (!r.rows.length) return res.status(401).json({ error: 'Egasi topilmadi' })

    req.owner = r.rows[0]
    next()
  } catch (e) {
    res.status(401).json({ error: 'Auth xatolik' })
  }
}

module.exports = { authOwner }
