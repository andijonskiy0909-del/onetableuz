const db = require('../config/db')
const logger = require('../config/logger')
const asyncHandler = require('../utils/asyncHandler')

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

exports.list = asyncHandler(async (req, res) => {
  const { lat, lng, search, cuisine, price, sort } = req.query

  let whereClause = `WHERE r.is_active = true AND r.status = 'approved' AND r.is_demo = false`
  const params = []

  if (search) {
    params.push(`%${search}%`)
    whereClause += ` AND (r.name ILIKE $${params.length} OR r.address ILIKE $${params.length} OR r.description ILIKE $${params.length})`
  }
  if (cuisine) {
    params.push(cuisine)
    whereClause += ` AND $${params.length} = ANY(r.cuisine)`
  }
  if (price) {
    params.push(price)
    whereClause += ` AND r.price_category = $${params.length}`
  }

  const r = await db.query(`
    SELECT r.*,
      COALESCE((SELECT AVG(rv.rating) FROM reviews rv WHERE rv.restaurant_id = r.id AND rv.is_visible = true), r.rating) AS avg_rating,
      COALESCE((SELECT COUNT(*) FROM reviews rv WHERE rv.restaurant_id = r.id AND rv.is_visible = true), r.review_count)::int AS total_reviews
    FROM restaurants r
    ${whereClause}
    ORDER BY r.is_premium DESC, avg_rating DESC NULLS LAST, r.created_at DESC
  `, params)

  let list = r.rows.map(x => ({
    ...x,
    rating: x.avg_rating != null ? Number(Number(x.avg_rating).toFixed(2)) : 0,
    review_count: x.total_reviews || 0
  }))

  if (lat && lng) {
    const la = Number(lat), lo = Number(lng)
    list = list.map(x => ({
      ...x,
      distance_km: (x.latitude && x.longitude)
        ? Number(distanceKm(la, lo, Number(x.latitude), Number(x.longitude)).toFixed(2))
        : null
    }))
    if (sort === 'distance') {
      list.sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
    }
  }

  res.json(list)
})

exports.getById = asyncHandler(async (req, res) => {
  const { id } = req.params
  const q = isNaN(id)
    ? await db.query(`SELECT * FROM restaurants WHERE slug = $1 AND is_active = true`, [id])
    : await db.query(`SELECT * FROM restaurants WHERE id = $1 AND is_active = true`, [id])

  if (!q.rows.length) return res.status(404).json({ error: 'Topilmadi' })
  res.json(q.rows[0])
})

exports.getMenu = asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT * FROM menu_items WHERE restaurant_id = $1 AND is_available = true ORDER BY sort_order, category, id',
    [req.params.id]
  )
  res.json(r.rows)
})

exports.getZones = asyncHandler(async (req, res) => {
  // ✅ is_available filter OLIB TASHLANDI — dashboard yangi yaratganda bu ustun NULL bo'lishi mumkin
  const r = await db.query(
    `SELECT * FROM zones
     WHERE restaurant_id = $1 AND (is_available IS NULL OR is_available = true)
     ORDER BY sort_order NULLS LAST, id`,
    [req.params.id]
  )
  res.json(r.rows)
})

// ✅ YANGI ENDPOINT — stollarni olish
exports.getTables = asyncHandler(async (req, res) => {
  const { zone_id } = req.query
  let query = `SELECT * FROM tables
               WHERE restaurant_id = $1 AND (is_available IS NULL OR is_available = true)`
  const params = [req.params.id]
  if (zone_id) {
    params.push(zone_id)
    query += ` AND zone_id = $${params.length}`
  }
  query += ` ORDER BY sort_order NULLS LAST, table_number NULLS LAST, id`
  const r = await db.query(query, params)
  res.json(r.rows)
})

exports.getReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const offset = (Number(page) - 1) * Number(limit)
  const r = await db.query(`
    SELECT rv.*, u.first_name, u.last_name, u.username, u.avatar_url AS user_avatar
    FROM reviews rv
    LEFT JOIN users u ON u.id = rv.user_id
    WHERE rv.restaurant_id = $1 AND rv.is_visible = true
    ORDER BY rv.created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.params.id, Number(limit), offset])
  res.json(r.rows)
})

exports.getAvailability = asyncHandler(async (req, res) => {
  const { date } = req.query
  if (!date) return res.json([])

  const booked = await db.query(`
    SELECT time, COUNT(DISTINCT table_id)::int AS booked_count
    FROM reservations
    WHERE restaurant_id = $1 AND date = $2 AND status NOT IN ('cancelled') AND table_id IS NOT NULL
    GROUP BY time
  `, [req.params.id, date])

  const totalTables = await db.query(
    `SELECT COUNT(*)::int AS c FROM tables WHERE restaurant_id = $1 AND (is_available IS NULL OR is_available = true)`,
    [req.params.id]
  )
  const total = totalTables.rows[0].c || 1

  const blocked = await db.query(
    `SELECT time FROM availability WHERE restaurant_id = $1 AND date = $2 AND is_blocked = true`,
    [req.params.id, date]
  )

  const busyTimes = []
  booked.rows.forEach(r => {
    const t = String(r.time).slice(0, 5)
    if (r.booked_count >= total) busyTimes.push(t)
  })
  blocked.rows.forEach(r => {
    const t = String(r.time).slice(0, 5)
    if (!busyTimes.includes(t)) busyTimes.push(t)
  })

  res.json(busyTimes)
})

exports.getReels = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50)
  // ✅ status shartini yumshatdim — 'approved' bo'lmasa ham ko'rinsin (developmentda)
  const r = await db.query(`
    SELECT re.*, r.name AS restaurant_name, r.cuisine, r.rating, r.working_hours,
           r.image_url AS restaurant_image, r.slug AS restaurant_slug
    FROM reels re
    JOIN restaurants r ON r.id = re.restaurant_id
    WHERE re.is_published = true
      AND r.is_active = true
      AND (r.status = 'approved' OR r.status IS NULL)
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
    is_published: row.is_published,
    restaurant: {
      name: row.restaurant_name,
      slug: row.restaurant_slug,
      cuisine: row.cuisine,
      rating: row.rating,
      working_hours: row.working_hours,
      image_url: row.restaurant_image
    }
  }))
  res.json(reels)
})
