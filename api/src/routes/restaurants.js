const router = require('express').Router();
const pool = require('../db');

// Barcha restoranlar
router.get('/', async (req, res) => {
  try {
    const { q, cuisine, price } = req.query;
    let query = 'SELECT * FROM restaurants WHERE status = $1';
    let params = ['approved'];

    if (q) {
      query += ` AND (name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`;
      params.push(`%${q}%`);
    }
    if (cuisine) {
      query += ` AND $${params.length + 1} = ANY(cuisine)`;
      params.push(cuisine);
    }
    if (price) {
      query += ` AND price_category = $${params.length + 1}`;
      params.push(price);
    }

    query += ' ORDER BY is_premium DESC, rating DESC LIMIT 50';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bitta restoran
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM restaurants WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
