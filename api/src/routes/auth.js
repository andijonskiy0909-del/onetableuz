const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Telegram auth
router.post('/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body;
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

    let user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);

    if (user.rows.length === 0) {
      user = await pool.query(
        'INSERT INTO users (telegram_id, username, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING *',
        [telegram_id, username, first_name, last_name]
      );
    }

    const token = jwt.sign({ id: user.rows[0].id, telegram_id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: user.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
