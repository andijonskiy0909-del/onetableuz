const db = require('../config/db')
const logger = require('../config/logger')
const asyncHandler = require('../utils/asyncHandler')
const AppError = require('../utils/AppError')

// ── Restaurant CRUD ──────────────────────────────────────────
exports.getRestaurant = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json({ owner: req.owner, restaurant: null })
  const r = await db.query('SELECT * FROM restaurants WHERE id = $1', [req.owner.restaurant_id])
  const owner = { ...req.owner }
  delete owner.password_hash
  res.json({ owner, restaurant: r.rows[0] || null })
})

exports.createRestaurant = asyncHandler(async (req, res) => {
  if (req.owner.restaurant_id) throw AppError.conflict('Allaqachon restoran mavjud')
  const b = req.body || {}
  if (!b.name) throw AppError.badRequest('Restoran nomi kerak')

  const slug = b.name.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    + '-' + Date.now().toString(36)

  const r = await db.query(`
    INSERT INTO restaurants (
      owner_id, name, slug, description, phone, email, address, city,
      working_hours, capacity, price_category, image_url, cover_url,
      cuisine, gallery, deposit_required, deposit_amount,
      min_guests, max_guests, has_parking, has_wifi, has_kids_area, has_outdoor, has_live_music,
      status, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'approved',true)
    RETURNING *
  `, [
    req.owner.id, b.name.trim(), slug,
    b.description || null, b.phone || null, b.email || null, b.address || null, b.city || 'Toshkent',
    b.working_hours || '10:00-23:00', Number(b.capacity) || 50, b.price_category || '$$',
    b.image_url || null, b.cover_url || null,
    Array.isArray(b.cuisine) ? b.cuisine : (b.cuisine ? b.cuisine.split(',').map(s=>s.trim()).filter(Boolean) : []),
    Array.isArray(b.gallery) ? b.gallery : [],
    Boolean(b.deposit_required), Number(b.deposit_amount) || 0,
    Number(b.min_guests) || 1, Number(b.max_guests) || 20,
    Boolean(b.has_parking), Boolean(b.has_wifi), Boolean(b.has_kids_area),
    Boolean(b.has_outdoor), Boolean(b.has_live_music)
  ])

  await db.query('UPDATE owners SET restaurant_id = $1 WHERE id = $2', [r.rows[0].id, req.owner.id])

  const { sign } = require('../utils/jwt')
  const token = sign({ id: req.owner.id, kind: 'owner' })
  const owner = { ...req.owner, restaurant_id: r.rows[0].id }
  delete owner.password_hash

  res.status(201).json({ restaurant: r.rows[0], owner, token })
})

exports.updateRestaurant = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yaratilmagan')
  const b = req.body || {}
  const fields = []
  const values = []
  let i = 1

  const push = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val) }

  if (b.name !== undefined) push('name', b.name)
  if (b.description !== undefined) push('description', b.description)
  if (b.phone !== undefined) push('phone', b.phone)
  if (b.email !== undefined) push('email', b.email)
  if (b.address !== undefined) push('address', b.address)
  if (b.city !== undefined) push('city', b.city)
  if (b.working_hours !== undefined) push('working_hours', b.working_hours)
  if (b.capacity !== undefined) push('capacity', Number(b.capacity) || 0)
  if (b.price_category !== undefined) push('price_category', b.price_category)
  if (b.image_url !== undefined) push('image_url', b.image_url)
  if (b.cover_url !== undefined) push('cover_url', b.cover_url)
  if (b.logo_url !== undefined) push('logo_url', b.logo_url)
  if (b.cuisine !== undefined) {
    const arr = Array.isArray(b.cuisine) ? b.cuisine : (b.cuisine ? b.cuisine.split(',').map(s=>s.trim()).filter(Boolean) : [])
    push('cuisine', arr)
  }
  if (b.gallery !== undefined) push('gallery', Array.isArray(b.gallery) ? b.gallery : [])
  if (b.deposit_required !== undefined) push('deposit_required', Boolean(b.deposit_required))
  if (b.deposit_amount !== undefined) push('deposit_amount', Number(b.deposit_amount) || 0)
  if (b.min_guests !== undefined) push('min_guests', Number(b.min_guests) || 1)
  if (b.max_guests !== undefined) push('max_guests', Number(b.max_guests) || 20)
  if (b.has_parking !== undefined) push('has_parking', Boolean(b.has_parking))
  if (b.has_wifi !== undefined) push('has_wifi', Boolean(b.has_wifi))
  if (b.has_kids_area !== undefined) push('has_kids_area', Boolean(b.has_kids_area))
  if (b.has_outdoor !== undefined) push('has_outdoor', Boolean(b.has_outdoor))
  if (b.has_live_music !== undefined) push('has_live_music', Boolean(b.has_live_music))

  if (!fields.length) return res.json(null)
  values.push(req.owner.restaurant_id)

  const r = await db.query(
    `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  )
  res.json(r.rows[0])
})

exports.updateLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body || {}
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  if (latitude == null || longitude == null) throw AppError.badRequest('Koordinatalar kerak')

  await db.query(
    'UPDATE restaurants SET latitude = $1, longitude = $2 WHERE id = $3',
    [latitude, longitude, req.owner.restaurant_id]
  )
  res.json({ ok: true })
})

// ── Reservations ─────────────────────────────────────────────
exports.listReservations = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const { status, date, page = 1, limit = 200 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let where = 'WHERE res.restaurant_id = $1'
  const params = [req.owner.restaurant_id]

  if (status && status !== 'all') {
    params.push(status)
    where += ` AND res.status = $${params.length}`
  }
  if (date) {
    params.push(date)
    where += ` AND res.date = $${params.length}`
  }

  const r = await db.query(`
    SELECT res.*,
      u.first_name, u.last_name, u.phone AS user_phone, u.username, u.telegram_id AS user_telegram,
      z.name AS zone_name, t.table_number,
      COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))), ''), u.username, 'Mijoz') AS user_name
    FROM reservations res
    LEFT JOIN users u ON u.id = res.user_id
    LEFT JOIN zones z ON z.id = res.zone_id
    LEFT JOIN tables t ON t.id = res.table_id
    ${where}
    ORDER BY res.date DESC, res.time DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, Number(limit), offset])

  res.json(r.rows)
})

exports.updateReservation = asyncHandler(async (req, res) => {
  const { status } = req.body || {}
  const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'noshow']
  if (!validStatuses.includes(status)) throw AppError.badRequest('Yaroqsiz holat')

  // ✅ SQL injection xavfi tuzatildi — endi parametrlashtirilgan
  const setClauses = ['status = $1']
  const params = [status]
  let pi = 2

  if (status === 'confirmed') setClauses.push(`confirmed_at = NOW()`)
  if (status === 'completed') setClauses.push(`completed_at = NOW()`)
  if (status === 'cancelled') {
    setClauses.push(`cancelled_by = 'owner'`)
    if (req.body.reason) {
      setClauses.push(`cancel_reason = $${pi++}`)
      params.push(req.body.reason)
    }
  }

  params.push(req.params.id, req.owner.restaurant_id)

  const r = await db.query(`
    UPDATE reservations SET ${setClauses.join(', ')}
    WHERE id = $${pi++} AND restaurant_id = $${pi} RETURNING *
  `, params)

  if (!r.rows.length) throw AppError.notFound('Bron topilmadi')

  const io = req.app.get('io')
  if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', r.rows[0])

  res.json(r.rows[0])
})

// ── Menu CRUD ────────────────────────────────────────────────
exports.listMenu = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const r = await db.query(
    'SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY sort_order, category NULLS LAST, id',
    [req.owner.restaurant_id]
  )
  res.json(r.rows)
})

exports.createMenu = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  const { name, description, price, image_url, category, is_popular } = req.body || {}
  if (!name || price == null) throw AppError.badRequest('Nom va narx kerak')

  const r = await db.query(`
    INSERT INTO menu_items (restaurant_id, name, description, price, image_url, category, is_popular, is_available)
    VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *
  `, [req.owner.restaurant_id, name, description || null, Number(price), image_url || null, category || null, Boolean(is_popular)])

  res.status(201).json(r.rows[0])
})

exports.updateMenu = asyncHandler(async (req, res) => {
  const { name, description, price, image_url, category, is_available, is_popular, sort_order } = req.body || {}
  const r = await db.query(`
    UPDATE menu_items SET
      name = COALESCE($1, name), description = COALESCE($2, description),
      price = COALESCE($3, price), image_url = COALESCE($4, image_url),
      category = COALESCE($5, category), is_available = COALESCE($6, is_available),
      is_popular = COALESCE($7, is_popular), sort_order = COALESCE($8, sort_order)
    WHERE id = $9 AND restaurant_id = $10 RETURNING *
  `, [name, description, price != null ? Number(price) : null, image_url, category,
      is_available, is_popular, sort_order != null ? Number(sort_order) : null,
      req.params.id, req.owner.restaurant_id])

  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

exports.deleteMenu = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
  res.json({ ok: true })
})

// ── Zones CRUD ───────────────────────────────────────────────
exports.listZones = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const r = await db.query('SELECT * FROM zones WHERE restaurant_id = $1 ORDER BY sort_order NULLS LAST, id', [req.owner.restaurant_id])
  res.json(r.rows)
})

// ✅ FIX: image_url endi saqlanadi
exports.createZone = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  const { name, description, capacity, image_url, sort_order } = req.body || {}
  if (!name) throw AppError.badRequest('Zona nomi kerak')

  const r = await db.query(`
    INSERT INTO zones (restaurant_id, name, description, capacity, image_url, sort_order, is_available)
    VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *
  `, [
    req.owner.restaurant_id,
    name,
    description || null,
    Number(capacity) || 20,
    image_url || null,
    Number(sort_order) || 0
  ])

  res.status(201).json(r.rows[0])
})

// ✅ FIX: image_url va sort_order endi yangilanadi
exports.updateZone = asyncHandler(async (req, res) => {
  const { name, description, capacity, image_url, sort_order, is_available } = req.body || {}
  const r = await db.query(`
    UPDATE zones SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      capacity = COALESCE($3, capacity),
      image_url = COALESCE($4, image_url),
      sort_order = COALESCE($5, sort_order),
      is_available = COALESCE($6, is_available)
    WHERE id = $7 AND restaurant_id = $8 RETURNING *
  `, [
    name,
    description,
    capacity != null ? Number(capacity) : null,
    image_url,
    sort_order != null ? Number(sort_order) : null,
    is_available,
    req.params.id,
    req.owner.restaurant_id
  ])

  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

exports.deleteZone = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM zones WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
  res.json({ ok: true })
})

// ── Tables CRUD ──────────────────────────────────────────────
exports.listTables = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const r = await db.query(`
    SELECT t.*, z.name AS zone_name FROM tables t
    LEFT JOIN zones z ON z.id = t.zone_id
    WHERE t.restaurant_id = $1
    ORDER BY z.sort_order NULLS LAST, t.sort_order NULLS LAST, t.id
  `, [req.owner.restaurant_id])
  res.json(r.rows)
})

// ✅ FIX: image_url va sort_order endi saqlanadi
exports.createTable = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  const { zone_id, table_number, capacity, min_guests, shape, image_url, sort_order } = req.body || {}
  if (!table_number) throw AppError.badRequest('Stol raqami kerak')

  const r = await db.query(`
    INSERT INTO tables (restaurant_id, zone_id, table_number, capacity, min_guests, shape, image_url, sort_order, is_available)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *
  `, [
    req.owner.restaurant_id,
    zone_id || null,
    String(table_number),
    Number(capacity) || 4,
    Number(min_guests) || 1,
    shape || 'round',
    image_url || null,
    Number(sort_order) || 0
  ])

  res.status(201).json(r.rows[0])
})

// ✅ FIX: table_number, image_url, sort_order endi yangilanadi
exports.updateTable = asyncHandler(async (req, res) => {
  const { table_number, capacity, min_guests, is_available, shape, zone_id, image_url, sort_order } = req.body || {}
  const r = await db.query(`
    UPDATE tables SET
      table_number = COALESCE($1, table_number),
      capacity = COALESCE($2, capacity),
      min_guests = COALESCE($3, min_guests),
      is_available = COALESCE($4, is_available),
      shape = COALESCE($5, shape),
      zone_id = COALESCE($6, zone_id),
      image_url = COALESCE($7, image_url),
      sort_order = COALESCE($8, sort_order)
    WHERE id = $9 AND restaurant_id = $10 RETURNING *
  `, [
    table_number != null ? String(table_number) : null,
    capacity != null ? Number(capacity) : null,
    min_guests != null ? Number(min_guests) : null,
    is_available,
    shape,
    zone_id,
    image_url,
    sort_order != null ? Number(sort_order) : null,
    req.params.id,
    req.owner.restaurant_id
  ])

  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

exports.deleteTable = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM tables WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
  res.json({ ok: true })
})

// ── Reels CRUD ───────────────────────────────────────────────
exports.listReels = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const r = await db.query('SELECT * FROM reels WHERE restaurant_id = $1 ORDER BY created_at DESC', [req.owner.restaurant_id])
  res.json(r.rows)
})

exports.createReel = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  const { url, thumbnail_url, caption, type, is_published } = req.body || {}
  if (!url) throw AppError.badRequest('URL kerak')

  const r = await db.query(`
    INSERT INTO reels (restaurant_id, url, thumbnail_url, caption, type, is_published)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [
    req.owner.restaurant_id,
    url,
    thumbnail_url || null,
    caption || null,
    type || 'video',
    is_published !== false  // undefined yoki true → published
  ])

  res.status(201).json(r.rows[0])
})

// ✅ YANGI: reel yangilash (publish/unpublish toggle)
exports.updateReel = asyncHandler(async (req, res) => {
  const { caption, thumbnail_url, is_published } = req.body || {}
  const r = await db.query(`
    UPDATE reels SET
      caption = COALESCE($1, caption),
      thumbnail_url = COALESCE($2, thumbnail_url),
      is_published = COALESCE($3, is_published)
    WHERE id = $4 AND restaurant_id = $5 RETURNING *
  `, [caption, thumbnail_url, is_published, req.params.id, req.owner.restaurant_id])
  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

exports.deleteReel = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM reels WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
  res.json({ ok: true })
})

// ── Reviews management ───────────────────────────────────────
exports.listReviews = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json([])
  const r = await db.query(`
    SELECT rv.*, u.first_name, u.last_name, u.username
    FROM reviews rv LEFT JOIN users u ON u.id = rv.user_id
    WHERE rv.restaurant_id = $1 ORDER BY rv.created_at DESC LIMIT 100
  `, [req.owner.restaurant_id])
  res.json(r.rows)
})

exports.replyReview = asyncHandler(async (req, res) => {
  const { reply } = req.body || {}
  const r = await db.query(`
    UPDATE reviews SET owner_reply = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING *
  `, [reply || null, req.params.id, req.owner.restaurant_id])
  if (!r.rows.length) throw AppError.notFound('Topilmadi')
  res.json(r.rows[0])
})

// ── Analytics ────────────────────────────────────────────────
exports.analytics = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json({ today: 0, weekly: 0, monthly: 0, revenue: 0 })
  const rid = req.owner.restaurant_id

  const [today, week, month, revenue, topZones, hourly] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled')`, [rid]),
    db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date >= CURRENT_DATE - 7 AND status NOT IN ('cancelled')`, [rid]),
    db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date >= CURRENT_DATE - 30 AND status NOT IN ('cancelled')`, [rid]),
    db.query(`SELECT COALESCE(SUM(pre_order_total),0)::numeric AS s FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled')`, [rid]),
    db.query(`
      SELECT z.name, COUNT(*)::int AS c FROM reservations res
      JOIN zones z ON z.id = res.zone_id
      WHERE res.restaurant_id=$1 AND res.date >= CURRENT_DATE - 30 AND res.status NOT IN ('cancelled')
      GROUP BY z.name ORDER BY c DESC LIMIT 5
    `, [rid]),
    db.query(`
      SELECT EXTRACT(HOUR FROM time)::int AS hour, COUNT(*)::int AS c
      FROM reservations WHERE restaurant_id=$1 AND date >= CURRENT_DATE - 30 AND status NOT IN ('cancelled')
      GROUP BY hour ORDER BY hour
    `, [rid])
  ])

  const todayGuests = await db.query(
    `SELECT COALESCE(SUM(guests),0)::int AS g FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled')`,
    [rid]
  )

  res.json({
    today: today.rows[0].c,
    todayGuests: todayGuests.rows[0].g,
    weekly: week.rows[0].c,
    monthly: month.rows[0].c,
    todayRevenue: Number(revenue.rows[0].s || 0),
    revenue: Number(revenue.rows[0].s || 0),
    topZones: topZones.rows,
    hourlyDistribution: hourly.rows
  })
})

// ── Premium ──────────────────────────────────────────────────
exports.premiumStatus = asyncHandler(async (req, res) => {
  if (!req.owner.restaurant_id) return res.json({ is_premium: false })
  const r = await db.query('SELECT is_premium, premium_until FROM restaurants WHERE id = $1', [req.owner.restaurant_id])
  const row = r.rows[0] || {}
  res.json({
    is_premium: row.is_premium || false,
    subscription: row.premium_until ? { until: row.premium_until } : null
  })
})

exports.premiumRequest = asyncHandler(async (req, res) => {
  const { plan } = req.body || {}
  if (!req.owner.restaurant_id) throw AppError.badRequest('Restoran yo\'q')
  const amount = plan === 'yearly' ? 1200000 : 150000

  await db.query(
    'INSERT INTO premium_requests (restaurant_id, owner_id, plan, amount) VALUES ($1,$2,$3,$4)',
    [req.owner.restaurant_id, req.owner.id, plan || 'monthly', amount]
  )

  res.json({
    ok: true,
    payment_instructions: {
      card_number: '9860 0101 2345 6789',
      card_holder: 'ONETABLE UZ',
      amount
    }
  })
})

// ── Owner profile ────────────────────────────────────────────
exports.updateProfile = asyncHandler(async (req, res) => {
  const { full_name, phone, avatar_url } = req.body || {}
  const r = await db.query(`
    UPDATE owners SET
      full_name = COALESCE($1, full_name),
      phone = COALESCE($2, phone),
      avatar_url = COALESCE($3, avatar_url)
    WHERE id = $4 RETURNING id, full_name, email, phone, avatar_url, role, restaurant_id
  `, [full_name, phone, avatar_url, req.owner.id])
  res.json(r.rows[0])
})

exports.changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {}
  if (!current_password || !new_password) throw AppError.badRequest('Parollar kerak')
  if (new_password.length < 6) throw AppError.badRequest('Yangi parol kamida 6 belgi')

  const bcrypt = require('bcryptjs')
  const r = await db.query('SELECT password_hash FROM owners WHERE id = $1', [req.owner.id])
  const ok = await bcrypt.compare(current_password, r.rows[0].password_hash)
  if (!ok) throw AppError.unauthorized('Joriy parol xato')

  const hash = await bcrypt.hash(new_password, 10)
  await db.query('UPDATE owners SET password_hash = $1 WHERE id = $2', [hash, req.owner.id])
  res.json({ ok: true })
})

// ── Notifications ────────────────────────────────────────────
exports.getNotifications = asyncHandler(async (req, res) => {
  const r = await db.query(`
    SELECT * FROM notifications WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 50
  `, [req.owner.id])
  res.json(r.rows)
})

exports.markNotificationsRead = asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET is_read = true WHERE owner_id = $1', [req.owner.id])
  res.json({ ok: true })
})
