/**
 * OneTable — Advanced Booking Engine
 * Conflict handling, table assignment, alternative suggestions
 */
const router = require('express').Router()
const pool = require('../db')
const { userAuth } = require('../middleware/auth')
const { validateReservation } = require('../middleware/security')

// ── Yordamchi: Bo'sh stolni topish ───────────────────────────
async function findAvailableTable(client, restaurantId, zoneId, date, time, guests) {
  // 1. Shu vaqtda band bo'lgan stollarni topish
  const bookedTables = await client.query(`
    SELECT DISTINCT table_id FROM reservations
    WHERE restaurant_id = $1 AND date = $2 AND time = $3
      AND status NOT IN ('cancelled')
      AND table_id IS NOT NULL
  `, [restaurantId, date, time])

  const bookedIds = bookedTables.rows.map(r => r.table_id)

  // 2. Bo'sh va yetarli sig'imli stol topish
  let query = `
    SELECT t.* FROM tables t
    WHERE t.restaurant_id = $1
      AND t.is_available = true
      AND t.capacity >= $2
  `
  const params = [restaurantId, guests]

  if (zoneId) {
    params.push(zoneId)
    query += ` AND t.zone_id = $${params.length}`
  }

  if (bookedIds.length) {
    query += ` AND t.id NOT IN (${bookedIds.join(',')})`
  }

  query += ' ORDER BY t.capacity ASC LIMIT 1'

  const result = await client.query(query, params)
  return result.rows[0] || null
}

// ── Yordamchi: Eng yaqin bo'sh vaqtlarni topish ───────────────
async function findAlternativeTimes(restaurantId, date, time, guests) {
  // Shu kunda band vaqtlarni olish
  const bookedTimes = await pool.query(`
    SELECT DISTINCT time FROM reservations
    WHERE restaurant_id = $1 AND date = $2
      AND status NOT IN ('cancelled')
  `, [restaurantId, date])

  const booked = bookedTimes.rows.map(r => String(r.time).slice(0, 5))

  // Restoran ish vaqti slotlari
  const allSlots = []
  for (let h = 10; h <= 21; h++) {
    allSlots.push(`${String(h).padStart(2, '0')}:00`)
    allSlots.push(`${String(h).padStart(2, '0')}:30`)
  }
  allSlots.push('22:00')

  // Bo'sh vaqtlar
  const freeSlots = allSlots.filter(s => !booked.includes(s))

  // Tanlangan vaqtga eng yaqin 3 ta slot
  const timeMinutes = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1])
  const sorted = freeSlots
    .map(s => {
      const [h, m] = s.split(':').map(Number)
      return { time: s, diff: Math.abs(h * 60 + m - timeMinutes) }
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time)

  return sorted
}

// ── POST /api/reservations — Bron yaratish ────────────────────
router.post('/', userAuth, validateReservation, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const {
      restaurant_id, date, time, guests,
      comment, zone_id, pre_order,
      special_request, food_ready_time
    } = req.body

    // Restoran mavjudligini tekshirish
    const resto = await client.query(
      `SELECT id, name, capacity FROM restaurants
       WHERE id = $1 AND status = 'approved'`,
      [restaurant_id]
    )
    if (!resto.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Restoran topilmadi' })
    }

    const { name: restaurantName } = resto.rows[0]

    // Bloklangan vaqt tekshirish
    const blocked = await client.query(`
      SELECT id FROM availability
      WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true
    `, [restaurant_id, date, time])

    if (blocked.rows.length) {
      await client.query('ROLLBACK')
      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests)
      return res.status(400).json({
        error: 'Bu vaqt bloklangan',
        alternatives
      })
    }

    // Bo'sh stol topish
    const availableTable = await findAvailableTable(
      client, restaurant_id, zone_id, date, time, guests
    )

    if (!availableTable) {
      await client.query('ROLLBACK')
      // Muqobil vaqtlarni taklif qilish
      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests)
      return res.status(400).json({
        error: 'Bu vaqtda bo\'sh joy mavjud emas',
        alternatives,
        message: alternatives.length
          ? `Quyidagi vaqtlarda joy bor: ${alternatives.join(', ')}`
          : 'Bu kunda joy yo\'q. Boshqa kun tanlang.'
      })
    }

    // Pre-order hisoblash
    let preOrderTotal = 0
    const preOrderList = pre_order || []
    if (preOrderList.length) {
      // Menu narxlarini DB dan olish
      const itemIds = preOrderList.map(i => i.id).filter(Boolean)
      if (itemIds.length) {
        const menuItems = await client.query(
          `SELECT id, price FROM menu_items WHERE id = ANY($1) AND restaurant_id = $2`,
          [itemIds, restaurant_id]
        )
        const priceMap = {}
        menuItems.rows.forEach(m => { priceMap[m.id] = m.price })
        preOrderTotal = preOrderList.reduce((sum, item) => {
          return sum + (priceMap[item.id] || 0) * (item.qty || 1)
        }, 0)
      }
    }

    // Bron yaratish — TRANSACTION ichida
    const result = await client.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, table_id,
        date, time, guests, comment,
        special_request, food_ready_time,
        pre_order, pre_order_total, status, payment_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending','unpaid')
      RETURNING *
    `, [
      req.user.id, restaurant_id,
      zone_id || null, availableTable.id,
      date, time, guests, comment,
      special_request || null,
      food_ready_time || null,
      JSON.stringify(preOrderList),
      preOrderTotal
    ])

    await client.query('COMMIT')
    const booking = result.rows[0]

    // Foydalanuvchi ma'lumotlari
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id = $1',
      [req.user.id]
    )
    const user = userResult.rows[0]

    // Zona nomi
    let zoneName = ''
    if (zone_id) {
      const zoneRes = await pool.query('SELECT name FROM zones WHERE id = $1', [zone_id])
      zoneName = zoneRes.rows[0]?.name || ''
    }

    // Foydalanuvchiga Telegram xabar
    if (user?.telegram_id) {
      const text =
        `🎉 <b>Bron qabul qilindi!</b>\n\n` +
        `🍽 <b>${restaurantName}</b>\n` +
        `📅 Sana: ${date}\n` +
        `⏰ Vaqt: ${time}\n` +
        `👥 Mehmonlar: ${guests} kishi\n` +
        `🪑 Stol: #${availableTable.table_number}\n` +
        `${zoneName ? `🏠 Zona: ${zoneName}\n` : ''}` +
        `${special_request ? `⭐ Maxsus: ${special_request}\n` : ''}` +
        `${comment ? `💬 Izoh: ${comment}\n` : ''}` +
        `${preOrderTotal ? `🍜 Pre-order: ${preOrderTotal.toLocaleString()} so'm\n` : ''}` +
        `\n⏳ Restoran tasdiqlaguncha kuting.`
      sendTelegramMsg(user.telegram_id, text).catch(() => {})
    }

    // Restoran egasiga xabar
    const ownerResult = await pool.query(
      'SELECT telegram_id FROM restaurant_owners WHERE restaurant_id = $1',
      [restaurant_id]
    )
    if (ownerResult.rows[0]?.telegram_id) {
      const ownerText =
        `🔔 <b>Yangi bron!</b>\n\n` +
        `👤 Mijoz: ${user?.first_name || 'Noma\'lum'}\n` +
        `📅 ${date} — ⏰ ${time}\n` +
        `👥 ${guests} kishi | 🪑 Stol #${availableTable.table_number}\n` +
        `${zoneName ? `🏠 ${zoneName}\n` : ''}` +
        `${special_request ? `⭐ Maxsus so'rov: ${special_request}\n` : ''}` +
        `${preOrderTotal ? `🍜 Pre-order: ${preOrderTotal.toLocaleString()} so'm\n` : ''}`
      sendTelegramMsg(ownerResult.rows[0].telegram_id, ownerText).catch(() => {})
    }

    // Socket.io real-time
    const io = req.app.get('io')
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', {
        id: booking.id,
        guest_name: user?.first_name || "Noma'lum",
        date, time, guests, comment,
        zone_name: zoneName,
        table_number: availableTable.table_number,
        special_request,
        pre_order_total: preOrderTotal,
        status: 'pending'
      })
    }

    res.status(201).json({
      ...booking,
      table_number: availableTable.table_number,
      zone_name: zoneName,
      restaurant_name: restaurantName
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Bron xatoligi:', err.message)

    // Unique constraint — double booking
    if (err.code === '23505') {
      const alternatives = await findAlternativeTimes(
        req.body.restaurant_id, req.body.date, req.body.time, req.body.guests
      )
      return res.status(400).json({
        error: 'Bu stol allaqachon band',
        alternatives
      })
    }
    res.status(500).json({ error: 'Server xatoligi' })
  } finally {
    client.release()
  }
})

// ── GET /api/reservations/my ──────────────────────────────────
router.get('/my', userAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit

    const result = await pool.query(`
      SELECT r.*,
             res.name AS restaurant_name,
             res.address, res.image_url,
             z.name AS zone_name,
             t.table_number
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      LEFT JOIN zones z ON r.zone_id = z.id
      LEFT JOIN tables t ON r.table_id = t.id
      WHERE r.user_id = $1
      ORDER BY r.date DESC, r.time DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset])

    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/reservations/check — Bo'sh joyni tekshirish ──────
router.get('/check', async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, zone_id } = req.query

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Parametrlar yetishmayapti' })
    }

    const client = await pool.connect()
    try {
      const table = await findAvailableTable(
        client, restaurant_id, zone_id, date, time, guests
      )

      if (table) {
        return res.json({ available: true, table_number: table.table_number })
      }

      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests)
      res.json({
        available: false,
        message: 'Bu vaqtda joy yo\'q',
        alternatives
      })
    } finally {
      client.release()
    }
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── DELETE /api/reservations/:id — Bekor qilish ───────────────
router.delete('/:id', userAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'ID noto\'g\'ri' })

    const check = await pool.query(`
      SELECT r.*, res.name AS restaurant_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE r.id = $1 AND r.user_id = $2
    `, [id, req.user.id])

    if (!check.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const booking = check.rows[0]
    if (booking.status === 'cancelled')
      return res.status(400).json({ error: 'Bron allaqachon bekor qilingan' })

    const bookingDate = new Date(`${String(booking.date).split('T')[0]}T${booking.time}`)
    if (bookingDate < new Date())
      return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' })

    await pool.query(
      'UPDATE reservations SET status = $1 WHERE id = $2',
      ['cancelled', id]
    )

    // Socket.io
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${booking.restaurant_id}`).emit('reservation_cancelled', { id })

    // Telegram
    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [req.user.id])
    if (userResult.rows[0]?.telegram_id) {
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `🗑 <b>Bron bekor qilindi</b>\n\n🍽 ${booking.restaurant_name}\n📅 ${String(booking.date).split('T')[0]} — ⏰ ${booking.time}`
      ).catch(() => {})
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── O'tgan bronlar (review uchun) ─────────────────────────────
router.get('/past-unreviewed', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.date, r.time, r.restaurant_id,
             res.name AS restaurant_name, u.telegram_id
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
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/:id/review-asked', async (req, res) => {
  try {
    await pool.query('UPDATE reservations SET review_asked=true WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Telegram yuborish ─────────────────────────────────────────
async function sendTelegramMsg(telegramId, text) {
  const token = process.env.BOT_TOKEN
  if (!token || !telegramId) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
  })
}

module.exports = router
