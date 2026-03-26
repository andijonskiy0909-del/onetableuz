// src/routes/users.js
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const { userAuth } = require('../middleware/auth');

// GET /api/users/me
router.get('/me', userAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, telegram_id, first_name, last_name, phone, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/users/me
router.put('/me', userAuth, async (req, res, next) => {
  try {
    const { first_name, last_name, phone } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET first_name=$1, last_name=$2, phone=$3 WHERE id=$4
       RETURNING id, telegram_id, first_name, last_name, phone`,
      [first_name, last_name, phone, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
