/**
 * OneTable — Restaurants
 * Public va owner routes
 */
const router = require('express').Router()
const pool = require('../db')

// ── GET /api/restaurants — Barcha restoranlar ─────────────────
router.get('/', async (req, res) => {
  try {
    const { cuisine, price, search } = req.query
    let query = `SELECT * FROM restaurants WHERE status = 'approved'`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length})`
    }
    if (cuisine) {
      params.push(cuisine)
      query += ` AND $${params.length} = ANY(cuisine)`
    }
    if (price) {
      params.push(price)
      query += ` AND price_category = $${params.length}`
    }

    query += ` ORDER BY is_premium DESC, rating DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id — Bitta restoran ─────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Restoran topilmadi' })
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id/zones ───────────────────────────
router.get('/:id/zones', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT z.*, COUNT(t.id) as table_count
      FROM zones z
      LEFT JOIN tables t ON t.zone_id = z.id AND t.is_available = true
      WHERE z.restaurant_id = $1 AND z.is_available = true
      GROUP BY z.id
      ORDER BY z.created_at
    `, [req.params.id])
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id/menu ────────────────────────────
router.get('/:id/menu', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM menu_items
      WHERE restaurant_id = $1 AND is_available = true
      ORDER BY category, name
    `, [req.params.id])
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id/availability ────────────────────
router.get('/:id/availability', async (req, res) => {
  try {
    const { date } = req.query
    if (!date) return res.json([])

    const blocked = await pool.query(`
      SELECT time FROM availability
      WHERE restaurant_id = $1 AND date = $2 AND is_blocked = true
    `, [req.params.id, date])

    const booked = await pool.query(`
      SELECT DISTINCT time FROM reservations
      WHERE restaurant_id = $1 AND date = $2
        AND status NOT IN ('cancelled')
    `, [req.params.id, date])

    const busyTimes = [
      ...blocked.rows.map(r => String(r.time).slice(0, 5)),
      ...booked.rows.map(r => String(r.time).slice(0, 5))
    ]

    res.json([...new Set(busyTimes)])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id/reviews ─────────────────────────
router.get('/:id/reviews', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rv.*, u.first_name, u.last_name
      FROM reviews rv
      JOIN users u ON rv.user_id = u.id
      WHERE rv.restaurant_id = $1
      ORDER BY rv.created_at DESC
      LIMIT 50
    `, [req.params.id])

    const stats = await pool.query(`
      SELECT
        AVG(rating)::numeric(3,1) as avg_rating,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE rating = 5) as five_star,
        COUNT(*) FILTER (WHERE rating = 4) as four_star,
        COUNT(*) FILTER (WHERE rating = 3) as three_star,
        COUNT(*) FILTER (WHERE rating = 2) as two_star,
        COUNT(*) FILTER (WHERE rating = 1) as one_star
      FROM reviews WHERE restaurant_id = $1
    `, [req.params.id])

    res.json({ reviews: result.rows, stats: stats.rows[0] })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
