const db = require('../config/db')
const asyncHandler = require('../utils/asyncHandler')
const AppError = require('../utils/AppError')

exports.create = asyncHandler(async (req, res) => {
  const { telegram_id, reservation_id, restaurant_id, rating, comment, photo_url } = req.body || {}
  if (!restaurant_id || !rating) throw AppError.badRequest('restaurant_id va rating kerak')
  if (rating < 1 || rating > 5) throw AppError.badRequest('Rating 1-5 oraligida')

  let userId = null
  if (telegram_id) {
    const u = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id])
    if (u.rows.length) userId = u.rows[0].id
  } else if (req.user) {
    userId = req.user.id
  }

  // Check duplicate
  if (reservation_id) {
    const dup = await db.query(
      'SELECT id FROM reviews WHERE reservation_id = $1',
      [reservation_id]
    )
    if (dup.rows.length) throw AppError.conflict('Bu bron uchun sharh allaqachon mavjud')
  }

  const r = await db.query(`
    INSERT INTO reviews (user_id, restaurant_id, reservation_id, rating, comment, photo_url)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [userId, restaurant_id, reservation_id || null, rating, comment || null, photo_url || null])

  // Update restaurant average
  await db.query(`
    UPDATE restaurants SET
      rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE restaurant_id = $1 AND is_visible = true), 0),
      review_count = COALESCE((SELECT COUNT(*) FROM reviews WHERE restaurant_id = $1 AND is_visible = true), 0)
    WHERE id = $1
  `, [restaurant_id])

  res.status(201).json(r.rows[0])
})

exports.listByRestaurant = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT rv.*, u.first_name, u.last_name, u.username
    FROM reviews rv
    LEFT JOIN users u ON u.id = rv.user_id
    WHERE rv.restaurant_id = $1 AND rv.is_visible = true
    ORDER BY rv.created_at DESC LIMIT 50
  `, [req.params.id])
  res.json(r.rows)
})
