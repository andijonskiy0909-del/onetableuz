const db = require('../config/db')
const logger = require('../config/logger')

// Haversine km
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

exports.list = async (req, res) => {
  try {
    const { lat, lng } = req.query
    const r = await db.query(`
      SELECT r.*, COALESCE(AVG(rv.rating), r.rating) AS avg_rating, COUNT(rv.id)::int AS review_count
      FROM restaurants r
      LEFT JOIN reviews rv ON rv.restaurant_id = r.id
      WHERE r.is_active = true AND r.status = 'approved'
      GROUP BY r.id
      ORDER BY r.is_premium DESC, avg_rating DESC NULLS LAST
    `)
    let list = r.rows.map(x => ({
      ...x,
      rating: x.avg_rating != null ? Number(Number(x.avg_rating).toFixed(2)) : 0
    }))
    if (lat && lng) {
      const la = Number(lat), lo = Number(lng)
      list = list.map(x => ({
        ...x,
        distance_km: (x.latitude != null && x.longitude != null)
          ? Number(distanceKm(la, lo, Number(x.latitude), Number(x.longitude)).toFixed(2))
          : null
      }))
    }
    res.json(list)
  } catch (e) {
    logger.error('restaurants.list:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getById = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM restaurants WHERE id = $1 AND is_active = true', [req.params.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    res.json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getMenu = async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM menu_items WHERE restaurant_id = $1 AND is_available = true ORDER BY sort_order, id',
      [req.params.id]
    )
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getZones = async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM zones WHERE restaurant_id = $1 AND is_available = true ORDER BY id',
      [req.params.id]
    )
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getReviews = async (req, res) => {
  try {
    const r = await db.query(`
      SELECT rv.*, u.first_name, u.last_name, u.username
      FROM reviews rv
      LEFT JOIN users u ON u.id = rv.user_id
      WHERE rv.restaurant_id = $1
      ORDER BY rv.created_at DESC
      LIMIT 50
    `, [req.params.id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getAvailability = async (req, res) => {
  try {
    const { date } = req.query
    if (!date) return res.json([])
    const r = await db.query(`
      SELECT time FROM reservations
      WHERE restaurant_id = $1 AND date = $2 AND status NOT IN ('cancelled')
    `, [req.params.id, date])
    const times = r.rows.map(x => String(x.time).slice(0, 5))
    res.json(times)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getReels = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50)
    const r = await db.query(`
      SELECT re.*, r.name AS restaurant_name, r.cuisine, r.rating, r.working_hours, r.image_url AS restaurant_image
      FROM reels re
      JOIN restaurants r ON r.id = re.restaurant_id
      WHERE re.is_published = true AND r.is_active = true
      ORDER BY re.created_at DESC
      LIMIT $1
    `, [limit])
    const reels = r.rows.map(row => ({
      id: row.id,
      restaurant_id: row.restaurant_id,
      type: row.type,
      url: row.url,
      thumbnail_url: row.thumbnail_url,
      caption: row.caption,
      views: row.views,
      likes: row.likes,
      restaurant: {
        name: row.restaurant_name,
        cuisine: row.cuisine,
        rating: row.rating,
        working_hours: row.working_hours,
        image_url: row.restaurant_image
      }
    }))
    res.json(reels)
  } catch (e) {
    logger.error('getReels:', e.message)
    res.json([])
  }
}
