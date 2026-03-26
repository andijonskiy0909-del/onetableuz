// src/routes/auth.js — Telegram authentication
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const { createToken } = require('../middleware/auth');
const { authLimiter, validate } = require('../middleware/security');

// POST /api/auth/telegram
router.post('/telegram', authLimiter, validate('telegramAuth'), async (req, res, next) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body;
    const tid = String(telegram_id);

    // Upsert user
    const { rows } = await pool.query(
      `INSERT INTO users (telegram_id, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE
         SET first_name = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name  = COALESCE(EXCLUDED.last_name,  users.last_name)
       RETURNING *`,
      [tid, first_name || username || 'User', last_name || '']
    );

    const user = rows[0];
    const token = createToken({ id: user.id, telegram_id: tid });
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
