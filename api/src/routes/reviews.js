const router = require('express').Router();
const pool = require('../db');

// ── Review saqlash (bot dan chaqiriladi) ─────────────────────
router.post('/', async (req, res) => {
  try {
    const { telegram_id, reservation_id, restaurant_id, rating, comment, photo_url } = req.body;

    if (!telegram_id || !restaurant_id || !rating) {
      return res.status(400).json({ error: 'telegram_id, restaurant_id, rating kerak' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating 1-5 orasida bo\'lishi kerak' });
    }

    // Foydalanuvchini topish
    const userRes = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1', [String(telegram_id)]
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }
    const userId = userRes.rows[0].id;

    // Avval shu restoran uchun review bormi?
    const existing = await pool.query(
      `SELECT id FROM reviews WHERE user_id = $1 AND restaurant_id = $2`,
      [userId, restaurant_id]
    );

    let result;
    if (existing.rows.length) {
      // Mavjud reviewni yangilash
      result = await pool.query(
        `UPDATE reviews SET rating=$1, comment=$2, photo_url=$3, updated_at=NOW()
         WHERE user_id=$4 AND restaurant_id=$5 RETURNING *`,
        [rating, comment || null, photo_url || null, userId, restaurant_id]
      );
    } else {
      // Yangi review qo'shish
      result = await pool.query(
        `INSERT INTO reviews (user_id, restaurant_id, reservation_id, rating, comment, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, restaurant_id, reservation_id || null, rating, comment || null, photo_url || null]
      );
    }

    // Restoran o'rtacha reytingini yangilash
    await pool.query(
      `UPDATE restaurants SET
         rating = (SELECT AVG(rating)::numeric(3,1) FROM reviews WHERE restaurant_id = $1),
         review_count = (SELECT COUNT(*) FROM reviews WHERE restaurant_id = $1)
       WHERE id = $1`,
      [restaurant_id]
    );

    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran reviewlarini olish ───────────────────────────────
router.get('/restaurant/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rv.*, u.first_name, u.last_name
       FROM reviews rv
       JOIN users u ON rv.user_id = u.id
       WHERE rv.restaurant_id = $1
       ORDER BY rv.created_at DESC`,
      [req.params.id]
    );

    const stats = await pool.query(
      `SELECT
         AVG(rating)::numeric(3,1) as avg_rating,
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE rating = 5) as five_star,
         COUNT(*) FILTER (WHERE rating = 4) as four_star,
         COUNT(*) FILTER (WHERE rating = 3) as three_star,
         COUNT(*) FILTER (WHERE rating = 2) as two_star,
         COUNT(*) FILTER (WHERE rating = 1) as one_star
       FROM reviews WHERE restaurant_id = $1`,
      [req.params.id]
    );

    res.json({
      reviews: result.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
