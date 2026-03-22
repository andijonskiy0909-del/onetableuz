/**
 * OneTable — Reservations Routes
 * Secure, validated, with review system
 */
const router = require('express').Router()
const pool = require('../db')
const { userAuth } = require('../middleware/auth')
const { validateReservation } = require('../middleware/security')

async function sendTelegramMsg(telegramId, text) {
  try {
    const token = process.env.BOT_TOKEN
    if (!token || !telegramId) return
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
    })
  } catch(e) {
    console.error('Telegram xabar xatoligi:', e.message)
  }
}

// ── Bron yaratish ─────────────────────────────────────────────
router.post('/', userAuth, validateReservation, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { restaurant_id, date, time, guests, comment, zone_id, pre_order } = req.body

    // Restoran mavjudligini tekshirish
    const resto = await client.query(
      'SELECT id, name, capacity FROM restaurants WHERE id = $1 AND status = $2',
      [restaurant_id, 'approved']
    )
    if (!resto.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Restoran topilmadi' })
    }

    const { name: restaurantName, capacity } = resto.rows[0]

    // Konflikt tekshiruvi — TRANSACTION ichida
    const conflict = await client.query(
      `SELECT COUNT(*) as count FROM reservations
       WHERE restaurant_id = $1 AND date = $2 AND time = $3
         AND status NOT IN ('cancelled')
       FOR UPDATE`,
      [restaurant_id, date, time]
    )

    if (parseInt(conflict.rows[0].count) >= capacity) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Bu vaqtda joy mavjud emas' })
    }

    // Bloklangan vaqt tekshirish
    const blocked = await client.query(
      `SELECT id FROM availability
       WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true`,
      [restaurant_id, date, time]
    )
    if (blocked.rows.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Bu vaqt bloklangan' })
    }

    // Bron yaratish
    const result = await client.query(
      `INSERT INTO reservations
       (user_id, restaurant_id, zone_id, date, time, guests, comment, pre_order, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        req.user.id, restaurant_id,
        zone_id || null, date, time,
        guests, comment,
        JSON.stringify(pre_order || [])
      ]
    )

    await client.query('COMMIT')
    const booking = result.rows[0]

    // Telegram xabar (async — response kutmaymiz)
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id = $1',
      [req.user.id]
    )
    const user = userResult.rows[0]

    let zoneName = ''
    if (zone_id) {
      const zoneRes = await pool.query('SELECT name FROM zones WHERE id = $1', [zone_id])
      zoneName = zoneRes.rows[0]?.name || ''
    }

    if (user?.telegram_id) {
      const text =
        `🎉 <b>Bron qabul qilindi!</b>\n\n` +
        `🍽 <b>${restaurantName}</b>\n` +
        `📅 Sana: ${date}\n` +
        `⏰ Vaqt: ${time}\n` +
        `👥 Mehmonlar: ${guests} kishi\n` +
        `${zoneName ? `🏠 Zona: ${zoneName}\n` : ''}` +
        `${comment ? `💬 Izoh: ${comment}\n` : ''}` +
        `\n⏳ Restoran tasdiqlaguncha kuting.`
      sendTelegramMsg(user.telegram_id, text)
    }

    // Socket.io — real-time dashboard
    const io = req.app.get('io')
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', {
        id: booking.id,
        guest_name: `${user?.first_name || ''}`.trim() || "Noma'lum",
        date, time, guests, comment, zone_name: zoneName,
        status: 'pending', created_at: booking.created_at
      })
    }

    res.status(201).json(booking)

  } catch(err) {
    await client.query('ROLLBACK')
    console.error('Bron xatoligi:', err.message)
    res.status(500).json({ error: 'Server xatoligi' })
  } finally {
    client.release()
  }
})

// ── Foydalanuvchi bronlari ────────────────────────────────────
router.get('/my', userAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit

    const result = await pool.query(
      `SELECT r.*, 
              res.name AS restaurant_name, 
              res.address, res.image_url,
              z.name AS zone_name
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       LEFT JOIN zones z ON r.zone_id = z.id
       WHERE r.user_id = $1
       ORDER BY r.date DESC, r.time DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    )
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Bronni bekor qilish ───────────────────────────────────────
router.delete('/:id', userAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'ID noto\'g\'ri' })

    const check = await pool.query(
      `SELECT r.*, res.name AS restaurant_name
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       WHERE r.id = $1 AND r.user_id = $2`,
      [id, req.user.id]
    )

    if (!check.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const booking = check.rows[0]
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Bron allaqachon bekor qilingan' })

    const bookingDate = new Date(`${String(booking.date).split('T')[0]}T${booking.time}`)
    if (bookingDate < new Date()) return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' })

    await pool.query(
      'UPDATE reservations SET status = $1 WHERE id = $2',
      ['cancelled', id]
    )

    // Socket.io
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${booking.restaurant_id}`).emit('reservation_cancelled', { id })

    // Telegram
    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.id])
    if (userResult.rows[0]?.telegram_id) {
      const text = `🗑 <b>Bron bekor qilindi</b>\n\n🍽 ${booking.restaurant_name}\n📅 ${String(booking.date).split('T')[0]} — ⏰ ${booking.time}`
      sendTelegramMsg(userResult.rows[0].telegram_id, text)
    }

    res.json({ success: true })
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── O'tgan va review so'ralmaganlar (bot uchun) ───────────────
router.get('/past-unreviewed', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.date, r.time, r.restaurant_id,
             res.name AS restaurant_name,
             u.telegram_id
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN reviews rv ON rv.reservation_id = r.id
      WHERE r.status = 'confirmed'
        AND r.date < CURRENT_DATE
        AND rv.id IS NULL
        AND r.review_asked = false
        AND u.telegram_id IS NOT NULL
      LIMIT 20
    `)
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Review so'raldi deb belgilash ─────────────────────────────
router.put('/:id/review-asked', async (req, res) => {
  try {
    await pool.query(
      'UPDATE reservations SET review_asked = true WHERE id = $1',
      [req.params.id]
    )
    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
