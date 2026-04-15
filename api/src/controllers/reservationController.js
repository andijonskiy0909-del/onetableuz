const db = require('../config/db')
const bookingService = require('../services/bookingService')
const asyncHandler = require('../utils/asyncHandler')
const AppError = require('../utils/AppError')

exports.create = asyncHandler(async (req, res) => {
  const io = req.app.get('io')
  const reservation = await bookingService.createReservation(req.user.id, req.body, io)
  res.status(201).json(reservation)
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
