/**
 * OneTable — Chat System
 * Mijoz ↔ Restoran xabarlashuvi
 */
const router = require('express').Router()
const pool = require('../db')
const { userAuth } = require('../middleware/auth')
const { ownerAuth } = require('../middleware/auth')

// ── Xabar yuborish (Mijoz) ────────────────────────────────────
router.post('/:reservation_id/messages', userAuth, async (req, res) => {
  try {
    const { message } = req.body
    const reservationId = parseInt(req.params.reservation_id)

    if (!message?.trim()) return res.status(400).json({ error: 'Xabar bo\'sh bo\'lishi mumkin emas' })

    // Bron mavjudligini tekshirish
    const reservation = await pool.query(
      'SELECT * FROM reservations WHERE id=$1 AND user_id=$2',
      [reservationId, req.user.id]
    )
    if (!reservation.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const result = await pool.query(`
      INSERT INTO chat_messages (reservation_id, restaurant_id, user_id, sender_type, message)
      VALUES ($1, $2, $3, 'user', $4) RETURNING *
    `, [reservationId, reservation.rows[0].restaurant_id, req.user.id, message.trim()])

    const newMsg = result.rows[0]

    // Socket.io — real-time
    const io = req.app.get('io')
    if (io) {
      io.to(`restaurant_${reservation.rows[0].restaurant_id}`).emit('new_message', {
        ...newMsg, sender_type: 'user'
      })
    }

    // Restoran egasiga Telegram xabar
    const ownerResult = await pool.query(
      'SELECT telegram_id FROM restaurant_owners WHERE restaurant_id=$1',
      [reservation.rows[0].restaurant_id]
    )
    if (ownerResult.rows[0]?.telegram_id) {
      const userInfo = await pool.query('SELECT first_name FROM users WHERE id=$1', [req.user.id])
      const userName = userInfo.rows[0]?.first_name || 'Mijoz'
      sendTelegramMsg(ownerResult.rows[0].telegram_id,
        `💬 <b>Yangi xabar!</b>\n👤 ${userName}: ${message}\n\n📅 Bron #${reservationId}`
      ).catch(() => {})
    }

    res.status(201).json(newMsg)
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Xabar yuborish (Restoran egasi) ──────────────────────────
router.post('/:reservation_id/messages/owner', ownerAuth, async (req, res) => {
  try {
    const { message } = req.body
    const reservationId = parseInt(req.params.reservation_id)

    if (!message?.trim()) return res.status(400).json({ error: 'Xabar bo\'sh bo\'lishi mumkin emas' })

    const reservation = await pool.query(
      'SELECT * FROM reservations WHERE id=$1 AND restaurant_id=$2',
      [reservationId, req.owner.restaurant_id]
    )
    if (!reservation.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const result = await pool.query(`
      INSERT INTO chat_messages (reservation_id, restaurant_id, user_id, sender_type, message)
      VALUES ($1, $2, $3, 'owner', $4) RETURNING *
    `, [reservationId, req.owner.restaurant_id, reservation.rows[0].user_id, message.trim()])

    const newMsg = result.rows[0]

    // Socket.io
    const io = req.app.get('io')
    if (io) {
      io.to(`user_${reservation.rows[0].user_id}`).emit('new_message', {
        ...newMsg, sender_type: 'owner'
      })
    }

    // Foydalanuvchiga Telegram xabar
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id=$1',
      [reservation.rows[0].user_id]
    )
    if (userResult.rows[0]?.telegram_id) {
      const restoResult = await pool.query('SELECT name FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
      const restoName = restoResult.rows[0]?.name || 'Restoran'
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `💬 <b>${restoName} dan xabar:</b>\n${message}\n\n📅 Bron #${reservationId}`
      ).catch(() => {})
    }

    // O'qilmagan xabarlarni belgilash
    await pool.query(
      `UPDATE chat_messages SET is_read=true
       WHERE reservation_id=$1 AND sender_type='user' AND is_read=false`,
      [reservationId]
    )

    res.status(201).json(newMsg)
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Xabarlarni olish ──────────────────────────────────────────
router.get('/:reservation_id/messages', userAuth, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.reservation_id)

    // Foydalanuvchi o'z bronining xabarlarini ko'ra oladi
    const reservation = await pool.query(
      'SELECT id FROM reservations WHERE id=$1 AND user_id=$2',
      [reservationId, req.user.id]
    )
    if (!reservation.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })

    const result = await pool.query(`
      SELECT cm.*, u.first_name
      FROM chat_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.reservation_id = $1
      ORDER BY cm.created_at ASC
    `, [reservationId])

    // Owner xabarlarini o'qilgan deb belgilash
    await pool.query(
      `UPDATE chat_messages SET is_read=true
       WHERE reservation_id=$1 AND sender_type='owner' AND is_read=false`,
      [reservationId]
    )

    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── Owner uchun barcha xabarlar ───────────────────────────────
router.get('/owner/messages', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cm.*, u.first_name, u.last_name,
             r.date, r.time, r.guests
      FROM chat_messages cm
      JOIN users u ON cm.user_id = u.id
      JOIN reservations r ON cm.reservation_id = r.id
      WHERE cm.restaurant_id = $1
      ORDER BY cm.created_at DESC
      LIMIT 100
    `, [req.owner.restaurant_id])

    // O'qilmagan xabarlar soni
    const unread = await pool.query(
      `SELECT COUNT(*) FROM chat_messages
       WHERE restaurant_id=$1 AND sender_type='user' AND is_read=false`,
      [req.owner.restaurant_id]
    )

    res.json({
      messages: result.rows,
      unread_count: parseInt(unread.rows[0].count)
    })
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

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
