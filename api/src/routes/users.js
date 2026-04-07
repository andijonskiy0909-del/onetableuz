const router = require('express').Router()
const pool = require('../db')
const { createToken } = require('../middleware/auth')

// ── POST /api/auth/telegram ───────────────────────────────────
router.post('/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

    let result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [String(telegram_id)]
    )

    if (!result.rows.length) {
      result = await pool.query(
        `INSERT INTO users (telegram_id, first_name, last_name)
         VALUES ($1, $2, $3) RETURNING *`,
        [String(telegram_id), first_name || username || 'User', last_name || '']
      )
    } else {
      result = await pool.query(
        `UPDATE users SET first_name=$1, last_name=$2
         WHERE telegram_id=$3 RETURNING *`,
        [first_name || result.rows[0].first_name, last_name || result.rows[0].last_name, String(telegram_id)]
      )
    }

    const user = result.rows[0]
    const token = createToken({ id: user.id, telegram_id: user.telegram_id })
    res.json({ token, user })
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/users/me ─────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id])
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── PUT /api/users/me ─────────────────────────────────────────
router.put('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const { first_name, last_name, phone } = req.body
    const result = await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, phone=$3 WHERE id=$4 RETURNING *',
      [first_name, last_name, phone, decoded.id]
    )
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
