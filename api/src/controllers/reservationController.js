const db = require('../config/db')
const bookingService = require('../services/bookingService')
const asyncHandler = require('../utils/asyncHandler')
const AppError = require('../utils/AppError')
const { sendTelegramMessage } = require('../utils/telegram')

function safeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatReservationTime(time) {
  if (!time) return '—'
  return String(time).slice(0, 5)
}

function formatReservationDate(date) {
  if (!date) return '—'
  return String(date).slice(0, 10)
}

async function getReservationDetails(reservationId) {
  const result = await db.query(`
    SELECT 
      res.id,
      res.date,
      res.time,
      res.guests,
      res.status,
      res.restaurant_id,
      res.zone_id,
      res.table_id,
      u.telegram_id,
      r.name AS restaurant_name,
      r.address AS restaurant_address,
      z.name AS zone_name,
      t.table_number
    FROM reservations res
    JOIN users u ON u.id = res.user_id
    JOIN restaurants r ON r.id = res.restaurant_id
    LEFT JOIN zones z ON z.id = res.zone_id
    LEFT JOIN tables t ON t.id = res.table_id
    WHERE res.id = $1
    LIMIT 1
  `, [reservationId])

  return result.rows[0] || null
}

function buildCreatedMessage(booking) {
  return `
✅ <b>Bron qabul qilindi!</b>

🍽 <b>Restoran:</b> ${safeHtml(booking.restaurant_name)}
📅 <b>Sana:</b> ${formatReservationDate(booking.date)}
⏰ <b>Vaqt:</b> ${formatReservationTime(booking.time)}
👥 <b>Mehmonlar:</b> ${booking.guests} kishi
${booking.zone_name ? `📍 <b>Zona:</b> ${safeHtml(booking.zone_name)}\n` : ''}${booking.table_number ? `🪑 <b>Stol:</b> ${safeHtml(booking.table_number)}\n` : ''}
📌 <b>Holat:</b> Kutilmoqda

Restoran tasdiqlagandan keyin sizga yana xabar yuboramiz.
`
}

function buildUserCancelledMessage(booking) {
  return `
❌ <b>Bron bekor qilindi</b>

🍽 <b>Restoran:</b> ${safeHtml(booking.restaurant_name)}
📅 <b>Sana:</b> ${formatReservationDate(booking.date)}
⏰ <b>Vaqt:</b> ${formatReservationTime(booking.time)}
👥 <b>Mehmonlar:</b> ${booking.guests} kishi

Siz bronni bekor qildingiz. Boshqa vaqt tanlab qayta bron qilishingiz mumkin.
`
}

async function sendReservationCreatedNotification(reservation) {
  try {
    const reservationId = reservation?.id || reservation?.reservation?.id || reservation?.data?.id

    if (!reservationId) {
      console.warn('[Telegram] reservation id topilmadi')
      return
    }

    const booking = await getReservationDetails(reservationId)

    if (!booking) {
      console.warn('[Telegram] reservation details topilmadi')
      return
    }

    if (!booking.telegram_id) {
      console.warn('[Telegram] user telegram_id yo‘q')
      return
    }

    await sendTelegramMessage(booking.telegram_id, buildCreatedMessage(booking))
  } catch (err) {
    console.error('[Telegram] bron yaratildi xabarida xato:', err.message)
  }
}

async function sendReservationCancelledNotification(reservationId) {
  try {
    const booking = await getReservationDetails(reservationId)

    if (!booking) {
      console.warn('[Telegram] cancelled reservation details topilmadi')
      return
    }

    if (!booking.telegram_id) {
      console.warn('[Telegram] user telegram_id yo‘q')
      return
    }

    await sendTelegramMessage(booking.telegram_id, buildUserCancelledMessage(booking))
  } catch (err) {
    console.error('[Telegram] bron bekor qilindi xabarida xato:', err.message)
  }
}

exports.create = asyncHandler(async (req, res) => {
  const io = req.app.get('io')

  const reservation = await bookingService.createReservation(req.user.id, req.body, io)

  res.status(201).json(reservation)

  sendReservationCreatedNotification(reservation).catch(err => {
    console.error('[Telegram] create notification error:', err.message)
  })
})

exports.myList = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let where = 'WHERE res.user_id = $1'
  const params = [req.user.id]

  if (status && status !== 'all') {
    params.push(status)
    where += ` AND res.status = $${params.length}`
  }

  const r = await db.query(`
    SELECT res.*, r.name AS restaurant_name, r.image_url AS restaurant_image,
           r.slug AS restaurant_slug, r.address AS restaurant_address,
           z.name AS zone_name, t.table_number
    FROM reservations res
    JOIN restaurants r ON r.id = res.restaurant_id
    LEFT JOIN zones z ON z.id = res.zone_id
    LEFT JOIN tables t ON t.id = res.table_id
    ${where}
    ORDER BY res.date DESC, res.time DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, Number(limit), offset])

  res.json(r.rows)
})

exports.cancel = asyncHandler(async (req, res) => {
  const r = await db.query(`
    UPDATE reservations SET status = 'cancelled', cancelled_by = 'user', cancel_reason = $3
    WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'confirmed')
    RETURNING *
  `, [req.params.id, req.user.id, req.body.reason || null])

  if (!r.rows.length) throw AppError.notFound('Bron topilmadi')

  const io = req.app.get('io')
  if (io) io.to(`restaurant_${r.rows[0].restaurant_id}`).emit('reservation_updated', r.rows[0])

  res.json({ ok: true, reservation: r.rows[0] })

  sendReservationCancelledNotification(r.rows[0].id).catch(err => {
    console.error('[Telegram] cancel notification error:', err.message)
  })
})

// Bot review cron endpoints
exports.pastUnreviewed = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT res.id, res.restaurant_id, u.telegram_id, r.name AS restaurant_name
    FROM reservations res
    JOIN users u ON u.id = res.user_id
    JOIN restaurants r ON r.id = res.restaurant_id
    WHERE res.status IN ('completed', 'confirmed')
      AND res.review_asked = false
      AND (res.date < CURRENT_DATE OR (res.date = CURRENT_DATE AND res.time < CURRENT_TIME - INTERVAL '2 hours'))
      AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.reservation_id = res.id)
      AND u.telegram_id IS NOT NULL
    LIMIT 20
  `)
  res.json(r.rows)
})

exports.markReviewAsked = asyncHandler(async (req, res) => {
  await db.query('UPDATE reservations SET review_asked = true WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})
