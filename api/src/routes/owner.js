/**
 * OneTable — Owner Routes
 * Secure with proper auth and validation
 */
const router = require('express').Router()
const pool = require('../db')
const bcrypt = require('bcryptjs')
const { ownerAuth, createToken } = require('../middleware/auth')
const { validateOwnerRegister, validateRestaurantInput, validateMenuItemInput } = require('../middleware/security')

// ── Ro'yxatdan o'tish ─────────────────────────────────────────
router.post('/register', validateOwnerRegister, async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body

    const existing = await pool.query(
      'SELECT id FROM restaurant_owners WHERE email = $1', [email]
    )
    if (existing.rows.length)
      return res.status(400).json({ error: "Bu email allaqachon ro'yxatdan o'tgan" })

    const hash = await bcrypt.hash(password, 12) // 12 rounds — xavfsizroq
    const result = await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, email, full_name, phone, role, restaurant_id`,
      [email.toLowerCase(), hash, full_name, phone]
    )

    const owner = result.rows[0]
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id })
    res.status(201).json({ token, owner })
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' })

    const result = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email = $1',
      [email.toLowerCase()]
    )
    const owner = result.rows[0]
    if (!owner) return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' })

    const valid = await bcrypt.compare(password, owner.password_hash)
    if (!valid) return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' })

    const token = createToken({
      id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id
    })

    // Parolni response da qaytarmaslik
    const { password_hash, ...safeOwner } = owner
    res.json({ token, owner: safeOwner })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Restoran ma'lumotlari ─────────────────────────────────────
router.get('/restaurant', ownerAuth, async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null)
    const result = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1',
      [req.owner.restaurant_id]
    )
    res.json(result.rows[0] || null)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Restoran qo'shish ─────────────────────────────────────────
router.post('/restaurants', ownerAuth, validateRestaurantInput, async (req, res) => {
  try {
    const { name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours } = req.body

    const result = await pool.query(
      `INSERT INTO restaurants
        (name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved') RETURNING *`,
      [name, description, address, phone, cuisine, price_category, capacity || 50, image_url, working_hours || '10:00 — 22:00']
    )

    const restaurant = result.rows[0]
    await pool.query(
      'UPDATE restaurant_owners SET restaurant_id = $1 WHERE id = $2',
      [restaurant.id, req.owner.id]
    )
    res.status(201).json(restaurant)
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Restoran yangilash ────────────────────────────────────────
router.put('/restaurant', ownerAuth, validateRestaurantInput, async (req, res) => {
  try {
    const { name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours } = req.body
    const result = await pool.query(
      `UPDATE restaurants
       SET name=$1, description=$2, address=$3, phone=$4,
           cuisine=$5, price_category=$6, capacity=$7, image_url=$8, working_hours=$9
       WHERE id=$10 RETURNING *`,
      [name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Restoran topilmadi' })
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Lokatsiya saqlash ─────────────────────────────────────────
router.put('/restaurant/location', ownerAuth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude))
      return res.status(400).json({ error: 'latitude va longitude noto\'g\'ri' })
    await pool.query(
      'UPDATE restaurants SET latitude=$1, longitude=$2 WHERE id=$3',
      [latitude, longitude, req.owner.restaurant_id]
    )
    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Bronlar ───────────────────────────────────────────────────
router.get('/reservations', ownerAuth, async (req, res) => {
  try {
    const { date, status, page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit

    let query = `
      SELECT r.*, u.first_name, u.last_name, u.phone,
             z.name AS zone_name
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN zones z ON r.zone_id = z.id
      WHERE r.restaurant_id = $1
    `
    const params = [req.owner.restaurant_id]

    if (date) { params.push(date); query += ` AND r.date = $${params.length}` }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}` }
    query += ` ORDER BY r.date ASC, r.time ASC LIMIT $${params.length+1} OFFSET $${params.length+2}`
    params.push(limit, offset)

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Bronni tasdiqlash / rad etish ─────────────────────────────
router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['confirmed', 'cancelled', 'completed']
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: 'Noto\'g\'ri status' })

    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'ID noto\'g\'ri' })

    const result = await pool.query(
      `UPDATE reservations SET status=$1
       WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [status, id, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const r = result.rows[0]

    // Telegram xabar
    const userRes = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [r.user_id])
    const telegramId = userRes.rows[0]?.telegram_id
    if (telegramId) {
      const dateStr = String(r.date).split('T')[0]
      const timeStr = String(r.time).slice(0, 5)
      const text = status === 'confirmed'
        ? `✅ <b>Broningiz tasdiqlandi!</b>\n📅 ${dateStr} — ⏰ ${timeStr}\n👥 ${r.guests} kishi`
        : status === 'completed'
        ? `🎉 <b>Tashrifingiz uchun rahmat!</b>\n🍽 Restoran haqida fikr qoldiring.`
        : `❌ <b>Broningiz rad etildi.</b>\n📅 ${dateStr} — ⏰ ${timeStr}`

      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
      }).catch(() => {})
    }

    // Socket.io
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', { id, status })

    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Analitika ─────────────────────────────────────────────────
router.get('/analytics', ownerAuth, async (req, res) => {
  try {
    const rid = req.owner.restaurant_id
    if (!rid) return res.json({ today: 0, weekly: 0, revenue: 0, peakHours: [], noshowRate: 0, dailyStats: [] })

    const [today, weekly, revenue, peakHours, noshow, dailyStats] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE restaurant_id=$1 AND created_at>=DATE_TRUNC('month',CURRENT_DATE) AND status='paid'`, [rid]),
      pool.query(`SELECT time, COUNT(*) as count FROM reservations WHERE restaurant_id=$1 AND status!='cancelled' GROUP BY time ORDER BY count DESC LIMIT 6`, [rid]),
      pool.query(`SELECT COUNT(*) FILTER(WHERE status='noshow') as noshow, COUNT(*) as total FROM reservations WHERE restaurant_id=$1`, [rid]),
      pool.query(`SELECT date, COUNT(*) as count FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' GROUP BY date ORDER BY date ASC`, [rid])
    ])

    res.json({
      today: parseInt(today.rows[0].count),
      weekly: parseInt(weekly.rows[0].count),
      revenue: parseInt(revenue.rows[0].total),
      peakHours: peakHours.rows,
      noshowRate: noshow.rows[0].total > 0 ? Math.round(noshow.rows[0].noshow / noshow.rows[0].total * 100) : 0,
      dailyStats: dailyStats.rows
    })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Menyu ─────────────────────────────────────────────────────
router.get('/menu', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE restaurant_id=$1 ORDER BY category, name',
      [req.owner.restaurant_id]
    )
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/menu', ownerAuth, validateMenuItemInput, async (req, res) => {
  try {
    const { name, category, price, description, image_url } = req.body
    const result = await pool.query(
      `INSERT INTO menu_items (restaurant_id, name, category, price, description, image_url, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
      [req.owner.restaurant_id, name, category, price, description, image_url]
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const { name, description, price, available, image_url } = req.body
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'ID noto\'g\'ri' })

    const result = await pool.query(
      `UPDATE menu_items SET name=$1, description=$2, price=$3, is_available=$4, image_url=$5
       WHERE id=$6 AND restaurant_id=$7 RETURNING *`,
      [name, description, price, available, image_url, id, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Taom topilmadi' })
    res.json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'ID noto\'g\'ri' })
    await pool.query('DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2', [id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ── Zonalar ───────────────────────────────────────────────────
router.get('/zones', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM zones WHERE restaurant_id=$1 ORDER BY created_at',
      [req.owner.restaurant_id]
    )
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/zones', ownerAuth, async (req, res) => {
  try {
    const { name, description, capacity, icon } = req.body
    if (!name) return res.status(400).json({ error: 'Zona nomi kerak' })
    const result = await pool.query(
      `INSERT INTO zones (restaurant_id, name, description, capacity, icon, is_available)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [req.owner.restaurant_id, name, description, capacity || 10, icon || '🪑']
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/zones/:id', ownerAuth, async (req, res) => {
  try {
    const { is_available } = req.body
    const result = await pool.query(
      `UPDATE zones SET is_available=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [is_available, req.params.id, req.owner.restaurant_id]
    )
    res.json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/zones/:id', ownerAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM zones WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ── Bo'sh vaqtlar ─────────────────────────────────────────────
router.post('/availability/block', ownerAuth, async (req, res) => {
  try {
    const { date, time, reason } = req.body
    if (!date || !time) return res.status(400).json({ error: 'date va time kerak' })
    await pool.query(
      `INSERT INTO availability (restaurant_id, date, time, is_blocked, reason)
       VALUES ($1,$2,$3,true,$4)
       ON CONFLICT (restaurant_id, date, time) DO UPDATE SET is_blocked=true, reason=$4`,
      [req.owner.restaurant_id, date, time, reason]
    )
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/availability/block', ownerAuth, async (req, res) => {
  try {
    const { date, time } = req.body
    await pool.query(
      `UPDATE availability SET is_blocked=false WHERE restaurant_id=$1 AND date=$2 AND time=$3`,
      [req.owner.restaurant_id, date, time]
    )
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ── Premium ───────────────────────────────────────────────────
router.get('/premium', ownerAuth, async (req, res) => {
  try {
    const [sub, resto] = await Promise.all([
      pool.query(`SELECT * FROM premium_subscriptions WHERE restaurant_id=$1 ORDER BY created_at DESC LIMIT 1`, [req.owner.restaurant_id]),
      pool.query('SELECT is_premium FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
    ])
    res.json({ subscription: sub.rows[0] || null, is_premium: resto.rows[0]?.is_premium || false })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/premium/activate', ownerAuth, async (req, res) => {
  try {
    const { plan } = req.body
    if (!['monthly', 'yearly'].includes(plan)) return res.status(400).json({ error: 'Plan: monthly yoki yearly' })
    const amount = plan === 'yearly' ? 1200000 : 150000
    const expires_at = new Date()
    expires_at.setMonth(expires_at.getMonth() + (plan === 'yearly' ? 12 : 1))
    await pool.query(
      `INSERT INTO premium_subscriptions (restaurant_id, plan, amount, status, expires_at)
       VALUES ($1,$2,$3,'active',$4)`,
      [req.owner.restaurant_id, plan, amount, expires_at]
    )
    await pool.query('UPDATE restaurants SET is_premium=true WHERE id=$1', [req.owner.restaurant_id])
    res.json({ success: true, expires_at })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/premium', ownerAuth, async (req, res) => {
  try {
    await pool.query(`UPDATE premium_subscriptions SET status='cancelled' WHERE restaurant_id=$1`, [req.owner.restaurant_id])
    await pool.query('UPDATE restaurants SET is_premium=false WHERE id=$1', [req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

module.exports = router
