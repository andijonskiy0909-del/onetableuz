const db = require('../config/db')
const logger = require('../config/logger')

exports.create = async (req, res) => {
  try {
    const { telegram_id, reservation_id, restaurant_id, rating, comment, photo_url } = req.body || {}
    if (!restaurant_id || !rating) return res.status(400).json({ error: 'Maydonlar yetishmaydi' })

    let userId = null
    if (telegram_id) {
      const u = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id])
      if (u.rows.length) userId = u.rows[0].id
    }

    const r = await db.query(`
      INSERT INTO reviews (user_id, restaurant_id, reservation_id, rating, comment, photo_url)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [userId, restaurant_id, reservation_id || null, rating, comment || null, photo_url || null])

    await db.query(`
      UPDATE restaurants SET
        rating = (SELECT AVG(rating) FROM reviews WHERE restaurant_id = $1),
        review_count = (SELECT COUNT(*) FROM reviews WHERE restaurant_id = $1)
      WHERE id = $1
    `, [restaurant_id])

    res.status(201).json(r.rows[0])
  } catch (e) {
    logger.error('reviews.create:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}
