/**
 * OneTable — Reservations
 * No-show bo'lgan foydalanuvchilar keyingi bronda depozit to'laydi
 */
const router = require('express').Router()
const pool = require('../db')
const { userAuth } = require('../middleware/auth')

const DEPOSIT_AMOUNT = 50000 // so'm

// ── Yordamchi: Bo'sh vaqtlarni topish ────────────────────────
async function findAlternativeTimes(restaurantId, date, time) {
  const bookedTimes = await pool.query(`
    SELECT DISTINCT time FROM reservations
    WHERE restaurant_id = $1 AND date = $2 AND status NOT IN ('cancelled')
  `, [restaurantId, date])

  const booked = bookedTimes.rows.map(r => String(r.time).slice(0, 5))
  const allSlots = []
  for (let h = 10; h <= 21; h++) {
    allSlots.push(`${String(h).padStart(2, '0')}:00`)
    allSlots.push(`${String(h).padStart(2, '0')}:30`)
  }
  allSlots.push('22:00')

  const freeSlots = allSlots.filter(s => !booked.includes(s))
  const [hh, mm] = time.split(':').map(Number)
  const timeMinutes = hh * 60 + mm

  return freeSlots
    .map(s => {
      const [h, m] = s.split(':').map(Number)
      return { time: s, diff: Math.abs(h * 60 + m - timeMinutes) }
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time)
}

// ── Telegram xabar ───────────────────────────────────────────
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
    console.error('Telegram xato:', e.message)
  }
}

// ── POST /api/reservations — Bron yaratish ───────────────────
router.post('/', userAuth, async (req, res) => {
  try {
    const {
      restaurant_id, date, time, guests,
      comment, special_request,
      zone_id, pre_order
    } = req.body

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: "Barcha maydonlarni to'ldiring" })
    }

    // Restoran tekshirish
    const resto = await pool.query(
      `SELECT id, name, capacity FROM restaurants WHERE id = $1 AND status = 'approved'`,
      [restaurant_id]
    )
    if (!resto.rows.length) return res.status(404).json({ error: 'Restoran topilmadi' })
    const { name: restaurantName, capacity } = resto.rows[0]

    // Bloklangan vaqt
    const blocked = await pool.query(`
      SELECT id FROM availability
      WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true
    `, [restaurant_id, date, time])

    if (blocked.rows.length) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time)
      return res.status(400).json({ error: 'Bu vaqt bloklangan', alternatives })
    }

    // Sig'im tekshirish
    const conflict = await pool.query(`
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = $1 AND date = $2 AND time = $3
        AND status NOT IN ('cancelled')
    `, [restaurant_id, date, time])

    if (parseInt(conflict.rows[0].count) >= capacity) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time)
      return res.status(400).json({
        error: 'Bu vaqtda joy mavjud emas',
        alternatives,
        message: alternatives.length
          ? `Bo'sh vaqtlar: ${alternatives.join(', ')}`
          : "Bu kunda joy yo'q. Boshqa kun tanlang."
      })
    }

    // No-show tekshirish
    const noShowRes = await pool.query(
      `SELECT COUNT(*) FROM reservations WHERE user_id = $1 AND status = 'noshow'`,
      [req.user.id]
    )
    const noShow = parseInt(noShowRes.rows[0].count) > 0
    const requiresDeposit = noShow
    const paymentStatus = noShow ? 'unpaid' : 'not_required'

    // Pre-order hisoblash
    let preOrderTotal = 0
    const preOrderList = pre_order || []
    if (preOrderList.length) {
      const itemIds = preOrderList.map(i => i.id).filter(Boolean)
      if (itemIds.length) {
        const menuItems = await pool.query(
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

    // Bron yaratish
    const result = await pool.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, date, time, guests,
        comment, special_request, pre_order, pre_order_total,
        status, requires_deposit, payment_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        CASE WHEN $11 THEN 'waiting_payment' ELSE 'pending' END,
        $11, $12)
      RETURNING *
    `, [
      req.user.id, restaurant_id, zone_id || null,
      date, time, guests,
      comment || null, special_request || null,
      JSON.stringify(preOrderList), preOrderTotal,
      requiresDeposit, paymentStatus
    ])

    const booking = result.rows[0]

    // Foydalanuvchi ma'lumotlari
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id = $1', [req.user.id]
    )
    const user = userResult.rows[0]

    // Zona nomi
    let zoneName = ''
    if (zone_id) {
      const zoneRes = await pool.query('SELECT name FROM zones WHERE id = $1', [zone_id])
      zoneName = zoneRes.rows[0]?.name || ''
    }

    // Telegram xabar (foydalanuvchiga)
    if (user?.telegram_id) {
      let text
      if (requiresDeposit) {
        text =
          `⚠️ <b>Depozit talab qilinadi!</b>\n\n` +
          `🍽 <b>${restaurantName}</b>\n` +
          `📅 ${date} — ⏰ ${time}\n` +
          `👥 ${guests} kishi\n\n` +
          `❗ Avvalgi broningizda kelmadingiz.\n` +
          `💳 <b>${DEPOSIT_AMOUNT.toLocaleString()} so'm</b> depozit to'lang.`
      } else {
        text =
          `🎉 <b>Bron qabul qilindi!</b>\n\n` +
          `🍽 <b>${restaurantName}</b>\n` +
          `📅 ${date} — ⏰ ${time}\n` +
          `👥 ${guests} kishi\n` +
          `${zoneName ? `🏠 Zona: ${zoneName}\n` : ''}` +
          `${comment ? `💬 ${comment}\n` : ''}` +
          `${special_request ? `⭐ ${special_request}\n` : ''}` +
          `${preOrderTotal ? `🍜 Pre-order: ${preOrderTotal.toLocaleString()} so'm\n` : ''}` +
          `\n⏳ Restoran tasdiqlaguncha kuting.`
      }
      sendTelegramMsg(user.telegram_id, text).catch(() => {})
    }

    // Restoran egasiga xabar
    const ownerResult = await pool.query(
      'SELECT telegram_id FROM restaurant_owners WHERE restaurant_id = $1', [restaurant_id]
    )
    if (ownerResult.rows[0]?.telegram_id) {
      const ownerText =
        `🔔 <b>Yangi bron!</b>\n\n` +
        `👤 ${user?.first_name || "Noma'lum"}\n` +
        `📅 ${date} — ⏰ ${time}\n` +
        `👥 ${guests} kishi\n` +
        `${zoneName ? `🏠 ${zoneName}\n` : ''}` +
        `${special_request ? `⭐ ${special_request}\n` : ''}` +
        `${preOrderTotal ? `🍜 Pre-order: ${preOrderTotal.toLocaleString()} so'm\n` : ''}`
      sendTelegramMsg(ownerResult.rows[0].telegram_id, ownerText).catch(() => {})
    }

    // Socket.io real-time
    const io = req.app.get('io')
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', {
        id: booking.id,
        guest_name: user?.first_name || "Noma'lum",
        date, time, guests, comment, zone_name: zoneName,
        special_request, pre_order_total: preOrderTotal,
        status: 'pending'
      })
    }

    res.status(201).json({
      ...booking,
      zone_name: zoneName,
      restaurant_name: restaurantName,
      requires_deposit: requiresDeposit,
      deposit_amount: requiresDeposit ? DEPOSIT_AMOUNT : 0,
      message: requiresDeposit
        ? `Depozit to'lash kerak: ${DEPOSIT_AMOUNT.toLocaleString()} so'm`
        : 'Bron qabul qilindi'
    })

  } catch(err) {
    console.error('Bron xatoligi:', err.message)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/reservations/my ─────────────────────────────────
router.get('/my', userAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*,
             res.name AS restaurant_name,
             res.address, res.image_url,
             z.name AS zone_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      LEFT JOIN zones z ON r.zone_id = z.id
      WHERE r.user_id = $1
      ORDER BY r.date DESC, r.time DESC
    `, [req.user.id])
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/reservations/check ──────────────────────────────
router.get('/check', async (req, res) => {
  try {
    const { restaurant_id, date, time, guests } = req.query
    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Parametrlar yetishmayapti' })
    }

    const conflict = await pool.query(`
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = $1 AND date = $2 AND time = $3
        AND status NOT IN ('cancelled')
    `, [restaurant_id, date, time])

    const resto = await pool.query('SELECT capacity FROM restaurants WHERE id=$1', [restaurant_id])
    const capacity = resto.rows[0]?.capacity || 50

    if (parseInt(conflict.rows[0].count) >= capacity) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time)
      return res.json({ available: false, alternatives })
    }

    res.json({ available: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── DELETE /api/reservations/:id ─────────────────────────────
router.delete('/:id', userAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: "ID noto'g'ri" })

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
      return res.status(400).json({ error: "O'tgan bronni bekor qilib bo'lmaydi" })

    await pool.query('UPDATE reservations SET status=$1 WHERE id=$2', ['cancelled', id])

    const io = req.app.get('io')
    if (io) io.to(`restaurant_${booking.restaurant_id}`).emit('reservation_cancelled', { id })

    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [req.user.id])
    if (userResult.rows[0]?.telegram_id) {
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `🗑 <b>Bron bekor qilindi</b>\n\n🍽 ${booking.restaurant_name}\n📅 ${String(booking.date).split('T')[0]} — ⏰ ${booking.time}`
      ).catch(() => {})
    }

    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── PUT /api/reservations/:id/noshow ─────────────────────────
router.put('/:id/noshow', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE reservations SET status = 'noshow' WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Topilmadi' })

    const booking = result.rows[0]
    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [booking.user_id])
    if (userResult.rows[0]?.telegram_id) {
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `⚠️ <b>Eslatma!</b>\n\nSiz bugungi broningizga kelmagandingiz.\n\n` +
        `Keyingi bronda <b>${DEPOSIT_AMOUNT.toLocaleString()} so'm</b> depozit talab qilinadi.`
      ).catch(() => {})
    }
    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/reservations/past-unreviewed ────────────────────
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
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── PUT /api/reservations/:id/review-asked ───────────────────
router.put('/:id/review-asked', async (req, res) => {
  try {
    await pool.query('UPDATE reservations SET review_asked=true WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
