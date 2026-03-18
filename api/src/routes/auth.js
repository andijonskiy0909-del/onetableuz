const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// ── Telegram auth ────────────────────────────────────────────
router.post('/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body;
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

    let result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegram_id]
    );

    if (result.rows.length === 0) {
      // Yangi foydalanuvchi
      result = await pool.query(
        `INSERT INTO users (telegram_id, first_name, last_name)
         VALUES ($1, $2, $3) RETURNING *`,
        [telegram_id, first_name || username || 'User', last_name || '']
      );
    } else {
      // Mavjud foydalanuvchini yangilash
      result = await pool.query(
        `UPDATE users SET first_name = $1, last_name = $2
         WHERE telegram_id = $3 RETURNING *`,
        [first_name || result.rows[0].first_name, last_name || result.rows[0].last_name, telegram_id]
      );
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, telegram_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
