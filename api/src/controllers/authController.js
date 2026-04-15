const bcrypt = require('bcryptjs')
const db = require('../config/db')
const { sign } = require('../utils/jwt')
const logger = require('../config/logger')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

// ── Telegram auth (Mini App) ──
exports.telegramLogin = asyncHandler(async (req, res) => {
  const { telegram_id, first_name, last_name, username, language, phone } = req.body || {}
  if (!telegram_id) throw AppError.badRequest('telegram_id kerak')

  const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id])
  let user

  if (existing.rows.length) {
    const r = await db.query(`
      UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
        username = COALESCE($3, username), language = COALESCE($4, language), updated_at = NOW()
      WHERE telegram_id = $5 RETURNING *
    `, [first_name, last_name, username, language || 'uz', telegram_id])
    user = r.rows[0]
  } else {
    const r = await db.query(`
      INSERT INTO users (telegram_id, first_name, last_name, username, language, phone)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [telegram_id, first_name, last_name, username, language || 'uz', phone])
    user = r.rows[0]
  }

  const token = sign({ id: user.id, kind: 'user' })
  res.json({ token, user })
})

// ── Owner register ──
exports.ownerRegister = asyncHandler(async (req, res) => {
  const { full_name, email, phone, password, restaurant_name } = req.body || {}
  if (!full_name || !email || !password || !restaurant_name) {
    throw AppError.badRequest('Barcha maydonlar to\'ldirilishi shart')
  }
  if (password.length < 6) throw AppError.badRequest('Parol kamida 6 belgi')

  const exists = await db.query('SELECT id FROM owners WHERE email = $1', [email.toLowerCase().trim()])
  if (exists.rows.length) throw AppError.conflict('Bu email allaqachon mavjud')

  const hash = await bcrypt.hash(password, 10)
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const o = await client.query(`
      INSERT INTO owners (full_name, email, phone, password_hash, role)
      VALUES ($1,$2,$3,$4,'owner') RETURNING id, full_name, email, phone, role, created_at
    `, [full_name.trim(), email.toLowerCase().trim(), phone || null, hash])
    const owner = o.rows[0]

    // Create slug from restaurant name
    const slug = restaurant_name.toLowerCase().trim()
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
      + '-' + Date.now().toString(36)

    const r = await client.query(`
      INSERT INTO restaurants (owner_id, name, slug, status, is_active)
      VALUES ($1, $2, $3, 'approved', true) RETURNING *
    `, [owner.id, restaurant_name.trim(), slug])
    const restaurant = r.rows[0]

    await client.query('UPDATE owners SET restaurant_id = $1 WHERE id = $2', [restaurant.id, owner.id])
    owner.restaurant_id = restaurant.id

    await client.query('COMMIT')

    const token = sign({ id: owner.id, kind: 'owner' })
    res.status(201).json({ token, owner, restaurant })
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})

// ── Owner login ──
exports.ownerLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) throw AppError.badRequest('Email va parol kerak')

  const r = await db.query('SELECT * FROM owners WHERE email = $1 AND is_active = true', [email.toLowerCase().trim()])
  if (!r.rows.length) throw AppError.unauthorized('Email yoki parol xato')

  const owner = r.rows[0]
  const ok = await bcrypt.compare(password, owner.password_hash)
  if (!ok) throw AppError.unauthorized('Email yoki parol xato')

  delete owner.password_hash
  const token = sign({ id: owner.id, kind: 'owner' })
  res.json({ token, owner })
})

// ── Admin login ──
exports.adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) throw AppError.badRequest('Email va parol kerak')

  const r = await db.query('SELECT * FROM admins WHERE email = $1 AND is_active = true', [email.toLowerCase().trim()])
  if (!r.rows.length) throw AppError.unauthorized('Email yoki parol xato')

  const admin = r.rows[0]
  const ok = await bcrypt.compare(password, admin.password_hash)
  if (!ok) throw AppError.unauthorized('Email yoki parol xato')

  delete admin.password_hash
  const token = sign({ id: admin.id, kind: 'admin' })
  res.json({ token, admin })
})
