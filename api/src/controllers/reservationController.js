const db = require('../config/db')
const bookingService = require('../services/bookingService')
const logger = require('../config/logger')

exports.create = async (req, res) => {
  try {
    const reservation = await bookingService.createReservation(req.user.id, req.body)

    const io = req.app.get('io')
    if (io) io.to(`restaurant_${reservation.restaurant_id}`).emit('new_reservation', reservation)

    res.status(201).json(reservation)
  } catch (e) {
    logger.error('reservations.create:', e.message)
    const status = e.status || 500
    res.status(status).json({
      error: e.message || 'Xatolik',
      alternatives: e.alternatives || []
    })
  }
}

exports.myList = async (req, res) => {
  try {
    const r = await db.query(`
      SELECT res.*, r.name AS restaurant_name, r.image_url AS restaurant_image,
             z.name AS zone_name, t.table_number
      FROM reservations res
      JOIN restaurants r ON r.id = res.restaurant_id
      LEFT JOIN zones z ON z.id = res.zone_id
      LEFT JOIN tables t ON t.id = res.table_id
      WHERE res.user_id = $1
      ORDER BY res.date DESC, res.time DESC
    `, [req.user.id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.cancel = async (req, res) => {
  try {
    const r = await db.query(`
      UPDATE reservations SET status = 'cancelled'
      WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'confirmed')
      RETURNING *
    `, [req.params.id, req.user.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${r.rows[0].restaurant_id}`).emit('reservation_updated', r.rows[0])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// Bot uchun: sharh soʻralmagan tugallangan bronlar
exports.pastUnreviewed = async (req, res) => {
  try {
    const r = await db.query(`
      SELECT res.id, res.restaurant_id, u.telegram_id, r.name AS restaurant_name
      FROM reservations res
      JOIN users u ON u.id = res.user_id
      JOIN restaurants r ON r.id = res.restaurant_id
      WHERE res.status IN ('completed', 'confirmed')
        AND res.review_asked = false
        AND (res.date < CURRENT_DATE OR (res.date = CURRENT_DATE AND res.time < CURRENT_TIME))
        AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.reservation_id = res.id)
      LIMIT 20
    `)
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.markReviewAsked = async (req, res) => {
  try {
    await db.query('UPDATE reservations SET review_asked = true WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}
