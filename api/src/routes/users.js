const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

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

// Profil
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Profil yangilash
router.put('/me', auth, async (req, res) => {
  try {
    const { first_name, last_name, phone } = req.body;
    const result = await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, phone=$3 WHERE id=$4 RETURNING *',
      [first_name, last_name, phone, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
