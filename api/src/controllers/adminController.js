const db = require('../config/db')
const asyncHandler = require('../utils/asyncHandler')
const AppError = require('../utils/AppError')

// ── Dashboard stats ──
exports.stats = asyncHandler(async (req, res) => {
  const [users, owners, restaurants, reservations, reviews, revenue, pending] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS c FROM users WHERE is_active = true'),
    db.query('SELECT COUNT(*)::int AS c FROM owners WHERE is_active = true'),
    db.query('SELECT COUNT(*)::int AS c FROM restaurants WHERE is_active = true'),
    db.query('SELECT COUNT(*)::int AS c FROM reservations'),
    db.query('SELECT COUNT(*)::int AS c FROM reviews'),
    db.query(`SELECT COALESCE(SUM(pre_order_total),0)::numeric AS s FROM reservations WHERE status NOT IN ('cancelled')`),
    db.query(`SELECT COUNT(*)::int AS c FROM restaurants WHERE status = 'pending'`)
  ])

  const dailyBookings = await db.query(`
    SELECT date, COUNT(*)::int AS c
    FROM reservations WHERE date >= CURRENT_DATE - 30 AND status NOT IN ('cancelled')
    GROUP BY date ORDER BY date
  `)

  const statusBreakdown = await db.query(`
    SELECT status, COUNT(*)::int AS c FROM reservations GROUP BY status
  `)

  res.json({
    totalUsers: users.rows[0].c,
    totalOwners: owners.rows[0].c,
    totalRestaurants: restaurants.rows[0].c,
    totalReservations: reservations.rows[0].c,
    totalReviews: reviews.rows[0].c,
    totalRevenue: Number(revenue.rows[0].s),
    pendingApprovals: pending.rows[0].c,
    dailyBookings: dailyBookings.rows,
    statusBreakdown: statusBreakdown.rows
  })
})

// ── Users management ──
exports.listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let where = 'WHERE 1=1'
  const params = []
  if (search) {
    params.push(`%${search}%`)
    where += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR username ILIKE $${params.length} OR email ILIKE $${params.length})`
  }

  const total = await db.query(`SELECT COUNT(*)::int AS c FROM users ${where}`, params)
  const r = await db.query(`
    SELECT u.*, u.trust_score, u.total_bookings, u.noshow_count,
      (SELECT COUNT(*)::int FROM reservations WHERE user_id = u.id) AS booking_count,
      (SELECT COUNT(*)::int FROM reviews WHERE user_id = u.id) AS review_count,
      (SELECT COUNT(*)::int FROM favorites WHERE user_id = u.id) AS favorite_count
    FROM users u ${where}
    ORDER BY u.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, Number(limit), offset])

  res.json({ users: r.rows, total: total.rows[0].c, page: Number(page), limit: Number(limit) })
})

exports.toggleUser = asyncHandler(async (req, res) => {
  const r = await db.query(
    'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active',
    [req.params.id]
  )
  if (!r.rows.length) throw AppError.notFound('Foydalanuvchi topilmadi')
  res.json(r.rows[0])
})

// ── Owners management ──
exports.listOwners = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT o.id, o.full_name, o.email, o.phone, o.role, o.restaurant_id, o.is_active, o.created_at,
      r.name AS restaurant_name, r.status AS restaurant_status
    FROM owners o
    LEFT JOIN restaurants r ON r.id = o.restaurant_id
    ORDER BY o.created_at DESC LIMIT 200
  `)
  res.json(r.rows)
})

// ── Restaurants management ──
exports.listRestaurants = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let where = 'WHERE 1=1'
  const params = []
  if (status && status !== 'all') {
    params.push(status)
    where += ` AND r.status = $${params.length}`
  }

  const r = await db.query(`
    SELECT r.*, o.full_name AS owner_name, o.email AS owner_email,
      (SELECT COUNT(*)::int FROM reservations WHERE restaurant_id = r.id) AS booking_count,
      (SELECT COUNT(*)::int FROM reviews WHERE restaurant_id = r.id) AS review_count_actual
    FROM restaurants r
    LEFT JOIN owners o ON o.id = r.owner_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, Number(limit), offset])

  res.json(r.rows)
})

exports.approveRestaurant = asyncHandler(async (req, res) => {
  const r = await db.query(
    `UPDATE restaurants SET status = 'approved', rejection_reason = NULL WHERE id = $1 RETURNING *`,
    [req.params.id]
  )
  if (!r.rows.length) throw AppError.notFound('Restoran topilmadi')

  // Notify owner
  const rest = r.rows[0]
  if (rest.owner_id) {
    await db.query(`
      INSERT INTO notifications (owner_id, type, title, message)
      VALUES ($1, 'restaurant_approved', 'Restoran tasdiqlandi!', $2)
    `, [rest.owner_id, `"${rest.name}" tasdiqlandi va endi foydalanuvchilarga ko'rinadi.`])
  }

  res.json(r.rows[0])
})

exports.rejectRestaurant = asyncHandler(async (req, res) => {
  const { reason } = req.body || {}
  const r = await db.query(
    `UPDATE restaurants SET status = 'rejected', rejection_reason = $2 WHERE id = $1 RETURNING *`,
    [req.params.id, reason || 'Sababsiz']
  )
  if (!r.rows.length) throw AppError.notFound('Restoran topilmadi')

  const rest = r.rows[0]
  if (rest.owner_id) {
    await db.query(`
      INSERT INTO notifications (owner_id, type, title, message)
      VALUES ($1, 'restaurant_rejected', 'Restoran rad etildi', $2)
    `, [rest.owner_id, `"${rest.name}" rad etildi. Sabab: ${reason || 'ko\'rsatilmagan'}`])
  }

  res.json(r.rows[0])
})

exports.toggleRestaurant = asyncHandler(async (req, res) => {
  const r = await db.query(
    'UPDATE restaurants SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
    [req.params.id]
  )
  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

exports.togglePremium = asyncHandler(async (req, res) => {
  const { months = 1 } = req.body || {}
  const r = await db.query(`
    UPDATE restaurants SET
      is_premium = NOT is_premium,
      premium_until = CASE WHEN NOT is_premium THEN NOW() + ($2 || ' months')::interval ELSE NULL END
    WHERE id = $1 RETURNING id, name, is_premium, premium_until
  `, [req.params.id, String(months)])
  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

// ── Bookings list ──
exports.listBookings = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let where = 'WHERE 1=1'
  const params = []
  if (status && status !== 'all') {
    params.push(status)
    where += ` AND res.status = $${params.length}`
  }

  const r = await db.query(`
    SELECT res.*, r.name AS restaurant_name, u.first_name, u.last_name, u.username
    FROM reservations res
    JOIN restaurants r ON r.id = res.restaurant_id
    LEFT JOIN users u ON u.id = res.user_id
    ${where}
    ORDER BY res.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, Number(limit), offset])

  res.json(r.rows)
})

// ── Reviews list ──
exports.listReviews = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT rv.*, r.name AS restaurant_name, u.first_name, u.last_name
    FROM reviews rv
    JOIN restaurants r ON r.id = rv.restaurant_id
    LEFT JOIN users u ON u.id = rv.user_id
    ORDER BY rv.created_at DESC LIMIT 100
  `)
  res.json(r.rows)
})

exports.toggleReviewVisibility = asyncHandler(async (req, res) => {
  const r = await db.query(
    'UPDATE reviews SET is_visible = NOT is_visible WHERE id = $1 RETURNING id, is_visible',
    [req.params.id]
  )
  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

// ── Premium requests ──
exports.listPremiumRequests = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT pr.*, r.name AS restaurant_name, o.full_name AS owner_name, o.email AS owner_email
    FROM premium_requests pr
    JOIN restaurants r ON r.id = pr.restaurant_id
    LEFT JOIN owners o ON o.id = pr.owner_id
    ORDER BY pr.created_at DESC LIMIT 100
  `)
  res.json(r.rows)
})

exports.processPremiumRequest = asyncHandler(async (req, res) => {
  const { action, months = 1 } = req.body || {}
  if (!['approved', 'rejected'].includes(action)) throw AppError.badRequest('Yaroqsiz action')

  const pr = await db.query('SELECT * FROM premium_requests WHERE id = $1', [req.params.id])
  if (!pr.rows.length) throw AppError.notFound('Topilmadi')
  const request = pr.rows[0]

  await db.query(`
    UPDATE premium_requests SET status = $1, processed_by = $2, processed_at = NOW(), notes = $3
    WHERE id = $4
  `, [action, req.admin.id, req.body.notes || null, req.params.id])

  if (action === 'approved') {
    await db.query(`
      UPDATE restaurants SET is_premium = true, premium_until = NOW() + ($2 || ' months')::interval
      WHERE id = $1
    `, [request.restaurant_id, String(months)])
  }

  res.json({ ok: true })
})

// ── Activity log ──
exports.activityLog = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100
  `)
  res.json(r.rows)
})
