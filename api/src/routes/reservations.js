const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Bron yaratish
router.post('/', auth, async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, comment } = req.body;
    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    const result = await pool.query(
      `INSERT INTO reservations 
       (user_id, restaurant_id, date, time, guests, comment, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') 
       RETURNING *`,
      [req.user.id, restaurant_id, date, time, guests, comment]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Foydalanuvchi bronlari
router.get('/my', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, res.name, res.address, res.image_url 
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
