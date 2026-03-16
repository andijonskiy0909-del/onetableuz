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

// ✅ YANGI: Bo'sh vaqt slotlari
// GET /api/restaurants/:id/availability?date=2025-01-15
router.get('/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date parametri kerak' });
    }

    // Shu restoran, shu kunda band bo'lgan bronlarni ol
    const result = await pool.query(
      `SELECT time FROM reservations
       WHERE restaurant_id = $1
         AND date = $2
         AND status != 'cancelled'`,
      [id, date]
    );

    // Band vaqtlarni "HH:MM" formatida qaytaramiz
    const busy_times = result.rows.map(r => {
      const t = r.time || '';
      return t.substring(0, 5);
    });

    res.json({ busy_times });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ YANGI: Restoran menyusi
// GET /api/restaurants/:id/menu
router.get('/:id/menu', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_items
       WHERE restaurant_id = $1 AND is_available = true
       ORDER BY category, name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// ✅ YANGI: Restoran sharhlari
// GET /api/restaurants/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.restaurant_id = $1
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

module.exports = router;
