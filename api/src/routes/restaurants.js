/**
 * OneTable — Restaurants (MVP Complete)
 * - Demo filter
 * - Nearby sorting
 * - Reels feed
 */
const router = require('express').Router()
const pool = require('../db')

// ── GET /api/restaurants ──────────────────────────────────────
// Faqat real, active, non-demo restoranlar
router.get('/', async (req, res) => {
  try {
    const { cuisine, price, search, lat, lng, limit = 50 } = req.query

    // Agar koordinata berilsa — masofaga qarab saralash
    let query, params = []

    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      // Haversine formula (km)
      query = `
        SELECT *,
          ROUND((
            6371 * acos(
              cos(radians($1)) * cos(radians(latitude)) *
              cos(radians(longitude) - radians($2)) +
              sin(radians($1)) * sin(radians(latitude))
            )
          )::numeric, 1) AS distance_km
        FROM restaurants
        WHERE is_active = true AND is_demo = false AND status = 'approved'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
      `
      params = [parseFloat(lat), parseFloat(lng)]
    } else {
      query = `
        SELECT *, NULL as distance_km
        FROM restaurants
        WHERE is_active = true AND is_demo = false AND status = 'approved'
      `
    }

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

    if (lat && lng) {
      query += ` ORDER BY distance_km ASC`
    } else {
      query += ` ORDER BY is_premium DESC, rating DESC`
    }

    params.push(parseInt(limit))
    query += ` LIMIT $${params.length}`

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/reels ────────────────────────────────
// Reels feed — barcha active restoranlar video/reels
router.get('/reels', async (req, res) => {
  try {
    const { lat, lng, limit = 20 } = req.query
    let distanceSelect = 'NULL as distance_km'
    let distanceWhere = ''
    const params = []

    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      distanceSelect = `
        ROUND((6371 * acos(
          cos(radians(${parseFloat(lat)})) * cos(radians(res.latitude)) *
          cos(radians(res.longitude) - radians(${parseFloat(lng)})) +
          sin(radians(${parseFloat(lat)})) * sin(radians(res.latitude))
        ))::numeric, 1) AS distance_km`
    }

    params.push(parseInt(limit))
    const result = await pool.query(`
      SELECT
        m.id, m.restaurant_id, m.type, m.url, m.thumbnail_url,
        m.caption, m.sort_order, m.duration_seconds,
        res.name as restaurant_name,
        res.cuisine, res.price_category,
        res.rating, res.address, res.image_url,
        ${distanceSelect}
      FROM restaurant_media m
      JOIN restaurants res ON m.restaurant_id = res.id
      WHERE m.type IN ('video','reel')
        AND m.is_active = true
        AND res.is_active = true
        AND res.is_demo = false
        AND res.status = 'approved'
      ORDER BY res.is_premium DESC, m.sort_order ASC, m.created_at DESC
      LIMIT $1
    `, params)

    res.json(result.rows)
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/nearby ───────────────────────────────
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 5, limit = 10 } = req.query
    if (!lat || !lng) return res.status(400).json({ error: 'lat va lng kerak' })

    const result = await pool.query(`
      SELECT *,
        ROUND((6371 * acos(
          cos(radians($1)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(latitude))
        ))::numeric, 1) AS distance_km
      FROM restaurants
      WHERE is_active = true AND is_demo = false AND status = 'approved'
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND (6371 * acos(
          cos(radians($1)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(latitude))
        )) <= $3
      ORDER BY distance_km ASC
      LIMIT $4
    `, [parseFloat(lat), parseFloat(lng), parseFloat(radius), parseInt(limit)])

    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ── GET /api/restaurants/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1 AND is_active = true',
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
      GROUP BY z.id ORDER BY z.created_at
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
      WHERE restaurant_id=$1 AND date=$2 AND is_blocked=true
    `, [req.params.id, date])
    const booked = await pool.query(`
      SELECT DISTINCT time FROM reservations
      WHERE restaurant_id=$1 AND date=$2 AND status NOT IN ('cancelled')
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

// ── GET /api/restaurants/:id/media ───────────────────────────
router.get('/:id/media', async (req, res) => {
  try {
    const { type } = req.query
    let query = `SELECT * FROM restaurant_media WHERE restaurant_id=$1 AND is_active=true`
    const params = [req.params.id]
    if (type) { params.push(type); query += ` AND type=$${params.length}` }
    query += ' ORDER BY sort_order ASC, created_at DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
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
      WHERE rv.restaurant_id=$1
      ORDER BY rv.created_at DESC LIMIT 50
    `, [req.params.id])
    const stats = await pool.query(`
      SELECT AVG(rating)::numeric(3,1) as avg_rating, COUNT(*) as total,
        COUNT(*) FILTER (WHERE rating=5) as five_star,
        COUNT(*) FILTER (WHERE rating=4) as four_star,
        COUNT(*) FILTER (WHERE rating=3) as three_star,
        COUNT(*) FILTER (WHERE rating=2) as two_star,
        COUNT(*) FILTER (WHERE rating=1) as one_star
      FROM reviews WHERE restaurant_id=$1
    `, [req.params.id])
    res.json({ reviews: result.rows, stats: stats.rows[0] })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
