const bcrypt = require('bcryptjs')
const db = require('../config/db')
const { sign } = require('../utils/jwt')
const logger = require('../config/logger')

// ── Mini App: Telegram login ────────────────────────────────
exports.telegramLogin = async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, language } = req.body || {}
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id kerak' })

    const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id])
    let user
    if (existing.rows.length) {
      const r = await db.query(`
        UPDATE users SET first_name=$1, last_name=$2, username=$3, language=$4, updated_at=NOW()
        WHERE telegram_id=$5 RETURNING *
      `, [first_name || null, last_name || null, username || null, language || 'uz', telegram_id])
      user = r.rows[0]
    } else {
      const r = await db.query(`
        INSERT INTO users (telegram_id, first_name, last_name, username, language)
        VALUES ($1,$2,$3,$4,$5) RETURNING *
      `, [telegram_id, first_name || null, last_name || null, username || null, language || 'uz'])
      user = r.rows[0]
    }

    const token = sign({ id: user.id, kind: 'user' })
    res.json({ token, user })
  } catch (e) {
    logger.error('telegramLogin:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Owner: Register ──────────────────────────────────────────
exports.ownerRegister = async (req, res) => {
  try {
    const { full_name, email, phone, password, restaurant_name } = req.body || {}
    if (!full_name || !email || !password || !restaurant_name) {
      return res.status(400).json({ error: 'Barcha maydonlar toʻldirilishi shart' })
    }
    if (password.length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi' })

    const exists = await db.query('SELECT id FROM owners WHERE email = $1', [email.toLowerCase()])
    if (exists.rows.length) return res.status(409).json({ error: 'Bu email allaqachon mavjud' })

    const hash = await bcrypt.hash(password, 10)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const o = await client.query(`
        INSERT INTO owners (full_name, email, phone, password_hash, role)
        VALUES ($1,$2,$3,$4,'owner') RETURNING *
      `, [full_name, email.toLowerCase(), phone || null, hash])
      const owner = o.rows[0]

      const r = await client.query(`
        INSERT INTO restaurants (owner_id, name, status, is_active)
        VALUES ($1, $2, 'approved', true) RETURNING *
      `, [owner.id, restaurant_name])
      const restaurant = r.rows[0]

      await client.query('UPDATE owners SET restaurant_id = $1 WHERE id = $2', [restaurant.id, owner.id])
      owner.restaurant_id = restaurant.id

      await client.query('COMMIT')

      delete owner.password_hash
      const token = sign({ id: owner.id, kind: 'owner' })
      res.json({ token, owner, restaurant })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    logger.error('ownerRegister:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Owner: Login ─────────────────────────────────────────────
exports.ownerLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' })

    const r = await db.query('SELECT * FROM owners WHERE email = $1', [email.toLowerCase()])
    if (!r.rows.length) return res.status(401).json({ error: 'Email yoki parol xato' })

    const owner = r.rows[0]
    const ok = await bcrypt.compare(password, owner.password_hash)
    if (!ok) return res.status(401).json({ error: 'Email yoki parol xato' })

    delete owner.password_hash
    const token = sign({ id: owner.id, kind: 'owner' })
    res.json({ token, owner })
  } catch (e) {
    logger.error('ownerLogin:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}
