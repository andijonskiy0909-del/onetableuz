// src/routes/reviews.js
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const { apiLimiter, validate } = require('../middleware/security');

// POST /api/reviews
router.post('/', apiLimiter, validate('review'), async (req, res, next) => {
  try {
    const { telegram_id, reservation_id, restaurant_id, rating, comment, photo_url } = req.body;

    const { rows: users } = await pool.query(
      'SELECT id FROM users WHERE telegram_id=$1', [String(telegram_id)]
    );
    if (!users.length) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const userId = users[0].id;

    const { rows: existing } = await pool.query(
      'SELECT id FROM reviews WHERE user_id=$1 AND restaurant_id=$2', [userId, restaurant_id]
    );

    let result;
    if (existing.length) {
      result = await pool.query(
        `UPDATE reviews SET rating=$1,comment=$2,photo_url=$3,updated_at=NOW()
         WHERE user_id=$4 AND restaurant_id=$5 RETURNING *`,
        [rating, comment || null, photo_url || null, userId, restaurant_id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO reviews (user_id,restaurant_id,reservation_id,rating,comment,photo_url)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [userId, restaurant_id, reservation_id || null, rating, comment || null, photo_url || null]
      );
    }

    // Update restaurant average rating
    await pool.query(
      `UPDATE restaurants SET
         rating=(SELECT AVG(rating)::numeric(3,1) FROM reviews WHERE restaurant_id=$1),
         review_count=(SELECT COUNT(*)::int FROM reviews WHERE restaurant_id=$1)
       WHERE id=$1`,
      [restaurant_id]
    );

    res.json({ success: true, review: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/reviews/restaurant/:id
router.get('/restaurant/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT rv.*, u.first_name, u.last_name FROM reviews rv
       JOIN users u ON rv.user_id=u.id WHERE rv.restaurant_id=$1 ORDER BY rv.created_at DESC LIMIT 50`, [id]
    );
    const { rows: stats } = await pool.query(
      `SELECT AVG(rating)::numeric(3,1) as avg_rating, COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE rating=5)::int as five_star,
              COUNT(*) FILTER (WHERE rating=4)::int as four_star,
              COUNT(*) FILTER (WHERE rating=3)::int as three_star,
              COUNT(*) FILTER (WHERE rating=2)::int as two_star,
              COUNT(*) FILTER (WHERE rating=1)::int as one_star
       FROM reviews WHERE restaurant_id=$1`, [id]
    );
    res.json({ reviews: rows, stats: stats[0] });
  } catch (err) { next(err); }
});

module.exports = router;
