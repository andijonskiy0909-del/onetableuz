/**
 * OneTable — All Routes (combined)
 * auth / restaurants / reservations / owner / payments / chat / reviews / admin
 */
const router = require('express').Router()
const db = require('../db')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { userAuth, ownerAuth, adminAuth, createToken } = require('../middleware/auth')
const { validateReservation, validateOwnerRegister, validateMenuItem, validateRestaurant } = require('../middleware/security')
const { createReservation, findAlternativeTimes } = require('../services/bookingService')
const notify = require('../services/notificationService')
const logger = require('../logger')

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

// Telegram login
router.post('/auth/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name } = req.body
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id kerak' })

    let result = await db.query('SELECT * FROM users WHERE telegram_id=$1', [telegram_id])
    if (!result.rows.length) {
      result = await db.query(
        `INSERT INTO users (telegram_id, first_name, last_name) VALUES ($1,$2,$3) RETURNING *`,
        [telegram_id, first_name || username || 'User', last_name || '']
      )
    } else {
      result = await db.query(
        `UPDATE users SET first_name=$1, last_name=$2, updated_at=NOW() WHERE telegram_id=$3 RETURNING *`,
        [first_name || result.rows[0].first_name, last_name || result.rows[0].last_name, telegram_id]
      )
    }
    const user = result.rows[0]
    if (user.is_blocked) return res.status(403).json({ error: 'Bloklangan foydalanuvchi' })
    const token = createToken({ id: user.id, telegram_id })
    res.json({ token, user })
  } catch(e) { logger.error('auth/telegram', e.message); res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// RESTAURANTS
// ════════════════════════════════════════════════════════════════

router.get('/restaurants', async (req, res) => {
  try {
    const { search, cuisine, price, sort = 'rating', page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit
    let q = `SELECT * FROM restaurants WHERE status='approved' AND is_active=true`
    const params = []
    if (search) { params.push(`%${search}%`); q += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length})` }
    if (cuisine) { params.push(cuisine); q += ` AND $${params.length}=ANY(cuisine)` }
    if (price) { params.push(price); q += ` AND price_category=$${params.length}` }
    q += ` ORDER BY is_premium DESC, ${sort === 'rating' ? 'rating' : 'created_at'} DESC`
    params.push(limit, offset); q += ` LIMIT $${params.length-1} OFFSET $${params.length}`
    const result = await db.query(q, params)
    res.json(result.rows)
  } catch(e) { logger.error('GET /restaurants', e.message); res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/restaurants/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, COALESCE(json_agg(DISTINCT jsonb_build_object('id',z.id,'name',z.name,'icon',z.icon,'capacity',z.capacity)) FILTER(WHERE z.id IS NOT NULL),'[]') AS zones
       FROM restaurants r LEFT JOIN zones z ON z.restaurant_id=r.id AND z.is_available=true
       WHERE r.id=$1 GROUP BY r.id`, [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    res.json(result.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/restaurants/:id/menu', async (req, res) => {
  try {
    const cats = await db.query(
      `SELECT mc.*, COALESCE(json_agg(mi ORDER BY mi.name) FILTER(WHERE mi.id IS NOT NULL),'[]') AS items
       FROM menu_categories mc
       LEFT JOIN menu_items mi ON mi.category_id=mc.id AND mi.is_available=true AND mi.restaurant_id=$1
       WHERE mc.restaurant_id=$1 GROUP BY mc.id ORDER BY mc.sort_order`,
      [req.params.id]
    )
    // Kategoriyasiz taomlar
    const uncatItems = await db.query(
      `SELECT * FROM menu_items WHERE restaurant_id=$1 AND category_id IS NULL AND is_available=true`,
      [req.params.id]
    )
    const result = cats.rows
    if (uncatItems.rows.length) result.push({ id: null, name: 'Boshqalar', items: uncatItems.rows })
    res.json(result)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/restaurants/:id/zones', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT z.*, COUNT(t.id) AS table_count
       FROM zones z LEFT JOIN tables t ON t.zone_id=z.id AND t.is_available=true
       WHERE z.restaurant_id=$1 AND z.is_available=true GROUP BY z.id ORDER BY z.name`,
      [req.params.id]
    )
    res.json(result.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/restaurants/:id/availability', async (req, res) => {
  try {
    const { date } = req.query
    if (!date) return res.status(400).json({ error: 'date kerak' })
    const result = await db.query(
      `SELECT DISTINCT time FROM reservations
       WHERE restaurant_id=$1 AND date=$2 AND status NOT IN ('cancelled')
       UNION
       SELECT time FROM availability WHERE restaurant_id=$1 AND date=$2 AND is_blocked=true`,
      [req.params.id, date]
    )
    res.json(result.rows.map(r => String(r.time).slice(0, 5)))
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/restaurants/:id/reviews', async (req, res) => {
  try {
    const [reviews, stats] = await Promise.all([
      db.query(
        `SELECT rv.*, u.first_name FROM reviews rv JOIN users u ON rv.user_id=u.id
         WHERE rv.restaurant_id=$1 ORDER BY rv.created_at DESC LIMIT 20`,
        [req.params.id]
      ),
      db.query(
        `SELECT AVG(rating)::numeric(3,1) AS avg, COUNT(*) AS total,
           COUNT(*) FILTER(WHERE rating=5) AS five,
           COUNT(*) FILTER(WHERE rating=4) AS four,
           COUNT(*) FILTER(WHERE rating=3) AS three,
           COUNT(*) FILTER(WHERE rating=2) AS two,
           COUNT(*) FILTER(WHERE rating=1) AS one
         FROM reviews WHERE restaurant_id=$1`,
        [req.params.id]
      )
    ])
    res.json({ reviews: reviews.rows, stats: stats.rows[0] })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// RESERVATIONS
// ════════════════════════════════════════════════════════════════

router.post('/reservations', userAuth, validateReservation, async (req, res) => {
  try {
    const booking = await createReservation(req.user.id, req.body)

    // Userga xabar
    const user = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])
    let zoneName = ''
    if (booking.zone_id) {
      const z = await db.query('SELECT name FROM zones WHERE id=$1', [booking.zone_id])
      zoneName = z.rows[0]?.name || ''
    }
    notify.notifyBookingCreated(booking, user.rows[0], zoneName).catch(() => {})

    // Owner ga xabar
    const owner = await db.query('SELECT telegram_id FROM restaurant_owners WHERE restaurant_id=$1', [booking.restaurant_id])
    notify.notifyOwnerNewBooking(booking, user.rows[0], owner.rows[0]?.telegram_id, zoneName).catch(() => {})

    // Socket.io
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${booking.restaurant_id}`).emit('new_reservation', booking)

    res.status(201).json(booking)
  } catch(err) {
    const status = err.status || 500
    res.status(status).json({ error: err.message, alternatives: err.alternatives, suggest: err.suggest })
  }
})

router.get('/reservations/check', async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, zone_id } = req.query
    if (!restaurant_id || !date || !time || !guests) return res.status(400).json({ error: 'Parametrlar yetishmayapti' })
    const client = await db.connect()
    try {
      const { findAvailableTable } = require('../services/bookingService')
      const table = await findAvailableTable(client, restaurant_id, zone_id, date, time, guests)
      if (table) return res.json({ available: true, table_number: table.table_number })
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      res.json({ available: false, alternatives: alts })
    } finally { client.release() }
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/reservations/my', userAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const result = await db.query(
      `SELECT r.*, res.name AS restaurant_name, res.address, res.image_url,
              z.name AS zone_name, t.table_number
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id=res.id
       LEFT JOIN zones z ON r.zone_id=z.id
       LEFT JOIN tables t ON r.table_id=t.id
       WHERE r.user_id=$1
       ORDER BY r.date DESC, r.time DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, (page-1)*limit]
    )
    res.json(result.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/reservations/:id', userAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const r = await db.query(
      `SELECT r.*, res.name AS restaurant_name FROM reservations r
       JOIN restaurants res ON r.restaurant_id=res.id
       WHERE r.id=$1 AND r.user_id=$2`, [id, req.user.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const b = r.rows[0]
    if (b.status === 'cancelled') return res.status(400).json({ error: 'Allaqachon bekor' })
    if (new Date(`${String(b.date).split('T')[0]}T${b.time}`) < new Date())
      return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' })
    await db.query('UPDATE reservations SET status=$1, updated_at=NOW() WHERE id=$2', ['cancelled', id])
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${b.restaurant_id}`).emit('reservation_cancelled', { id })
    const u = await db.query('SELECT telegram_id FROM users WHERE id=$1', [req.user.id])
    notify.notifyBookingStatus(u.rows[0]?.telegram_id, 'cancelled', b).catch(() => {})
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/reservations/past-unreviewed', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.id, r.date, r.time, r.restaurant_id, res.name AS restaurant_name, u.telegram_id
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id=res.id
      JOIN users u ON r.user_id=u.id
      LEFT JOIN reviews rv ON rv.reservation_id=r.id
      WHERE r.status='confirmed' AND r.date<CURRENT_DATE AND rv.id IS NULL
        AND r.review_asked=false AND u.telegram_id IS NOT NULL LIMIT 20
    `)
    res.json(result.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/reservations/:id/review-asked', async (req, res) => {
  try {
    await db.query('UPDATE reservations SET review_asked=true WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// OWNER
// ════════════════════════════════════════════════════════════════

router.post('/owner/register', validateOwnerRegister, async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body
    const ex = await db.query('SELECT id FROM restaurant_owners WHERE email=$1', [email.toLowerCase()])
    if (ex.rows.length) return res.status(400).json({ error: 'Email allaqachon ro\'yxatdan o\'tgan' })
    const hash = await bcrypt.hash(password, 12)
    const r = await db.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, phone) VALUES ($1,$2,$3,$4) RETURNING id,email,full_name,phone,role,restaurant_id`,
      [email.toLowerCase(), hash, full_name, phone]
    )
    const token = createToken({ id: r.rows[0].id, role: r.rows[0].role, restaurant_id: r.rows[0].restaurant_id })
    res.status(201).json({ token, owner: r.rows[0] })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' })
    const r = await db.query('SELECT * FROM restaurant_owners WHERE email=$1', [email.toLowerCase()])
    if (!r.rows.length || !await bcrypt.compare(password, r.rows[0].password_hash))
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' })
    const owner = r.rows[0]
    await db.query('UPDATE restaurant_owners SET last_login=NOW() WHERE id=$1', [owner.id])
    const { password_hash, ...safe } = owner
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id })
    res.json({ token, owner: safe })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/owner/restaurant', ownerAuth, async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null)
    const r = await db.query('SELECT * FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
    res.json(r.rows[0] || null)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/restaurants', ownerAuth, validateRestaurant, async (req, res) => {
  try {
    const { name, description, address, phone, email, cuisine, price_category, capacity, image_url, working_hours } = req.body
    const r = await db.query(
      `INSERT INTO restaurants (name,description,address,phone,email,cuisine,price_category,capacity,image_url,working_hours,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved') RETURNING *`,
      [name, description, address, phone, email, cuisine, price_category, capacity||50, image_url, working_hours||'10:00-22:00']
    )
    await db.query('UPDATE restaurant_owners SET restaurant_id=$1 WHERE id=$2', [r.rows[0].id, req.owner.id])
    res.status(201).json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/owner/restaurant', ownerAuth, async (req, res) => {
  try {
    const { name, description, address, phone, email, cuisine, price_category, capacity, image_url, working_hours, gallery } = req.body
    const r = await db.query(
      `UPDATE restaurants SET name=$1,description=$2,address=$3,phone=$4,email=$5,cuisine=$6,
       price_category=$7,capacity=$8,image_url=$9,working_hours=$10,gallery=$11,updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name, description, address, phone, email, cuisine, price_category, capacity, image_url, working_hours, gallery, req.owner.restaurant_id]
    )
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/owner/restaurant/location', ownerAuth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body
    if (isNaN(latitude) || isNaN(longitude)) return res.status(400).json({ error: 'Koordinatalar noto\'g\'ri' })
    await db.query('UPDATE restaurants SET latitude=$1,longitude=$2 WHERE id=$3', [latitude, longitude, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Bronlar
router.get('/owner/reservations', ownerAuth, async (req, res) => {
  try {
    const { date, status, page=1, limit=50 } = req.query
    let q = `SELECT r.*, u.first_name, u.last_name, u.phone, z.name AS zone_name, t.table_number
             FROM reservations r JOIN users u ON r.user_id=u.id
             LEFT JOIN zones z ON r.zone_id=z.id LEFT JOIN tables t ON r.table_id=t.id
             WHERE r.restaurant_id=$1`
    const params = [req.owner.restaurant_id]
    if (date) { params.push(date); q += ` AND r.date=$${params.length}` }
    if (status) { params.push(status); q += ` AND r.status=$${params.length}` }
    params.push(limit, (page-1)*limit)
    q += ` ORDER BY r.date ASC, r.time ASC LIMIT $${params.length-1} OFFSET $${params.length}`
    const r = await db.query(q, params)
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/owner/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body
    if (!['confirmed','cancelled','completed'].includes(status))
      return res.status(400).json({ error: 'Noto\'g\'ri status' })
    const r = await db.query(
      `UPDATE reservations SET status=$1, updated_at=NOW() WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [status, req.params.id, req.owner.restaurant_id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const booking = r.rows[0]
    const [u, resto] = await Promise.all([
      db.query('SELECT telegram_id FROM users WHERE id=$1', [booking.user_id]),
      db.query('SELECT name FROM restaurants WHERE id=$1', [booking.restaurant_id])
    ])
    const enriched = { ...booking, restaurant_name: resto.rows[0]?.name }
    notify.notifyBookingStatus(u.rows[0]?.telegram_id, status, enriched).catch(() => {})
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', { id: booking.id, status })
    res.json(booking)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Menu
router.get('/owner/menu', ownerAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM menu_items WHERE restaurant_id=$1 ORDER BY name', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/menu', ownerAuth, validateMenuItem, async (req, res) => {
  try {
    const { name, category_id, price, description, image_url, prep_time } = req.body
    const r = await db.query(
      `INSERT INTO menu_items (restaurant_id,name,category_id,price,description,image_url,prep_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.owner.restaurant_id, name, category_id||null, price, description, image_url, prep_time||30]
    )
    res.status(201).json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/owner/menu/:id', ownerAuth, async (req, res) => {
  try {
    const { name, price, description, image_url, is_available, prep_time } = req.body
    const r = await db.query(
      `UPDATE menu_items SET name=$1,price=$2,description=$3,image_url=$4,is_available=$5,prep_time=$6
       WHERE id=$7 AND restaurant_id=$8 RETURNING *`,
      [name, price, description, image_url, is_available, prep_time, req.params.id, req.owner.restaurant_id]
    )
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/owner/menu/:id', ownerAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Menu Categories
router.get('/owner/menu/categories', ownerAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM menu_categories WHERE restaurant_id=$1 ORDER BY sort_order', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/menu/categories', ownerAuth, async (req, res) => {
  try {
    const { name, sort_order } = req.body
    if (!name) return res.status(400).json({ error: 'Kategoriya nomi kerak' })
    const r = await db.query(
      'INSERT INTO menu_categories (restaurant_id,name,sort_order) VALUES ($1,$2,$3) RETURNING *',
      [req.owner.restaurant_id, name, sort_order||0]
    )
    res.status(201).json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Zones
router.get('/owner/zones', ownerAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT z.*, COUNT(t.id) AS table_count FROM zones z
       LEFT JOIN tables t ON t.zone_id=z.id WHERE z.restaurant_id=$1 GROUP BY z.id ORDER BY z.name`,
      [req.owner.restaurant_id]
    )
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/zones', ownerAuth, async (req, res) => {
  try {
    const { name, description, capacity, icon } = req.body
    if (!name) return res.status(400).json({ error: 'Zona nomi kerak' })
    const r = await db.query(
      'INSERT INTO zones (restaurant_id,name,description,capacity,icon) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.owner.restaurant_id, name, description, capacity||10, icon||'🪑']
    )
    res.status(201).json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/owner/zones/:id', ownerAuth, async (req, res) => {
  try {
    const { name, description, capacity, icon, is_available } = req.body
    const r = await db.query(
      'UPDATE zones SET name=$1,description=$2,capacity=$3,icon=$4,is_available=$5 WHERE id=$6 AND restaurant_id=$7 RETURNING *',
      [name, description, capacity, icon, is_available, req.params.id, req.owner.restaurant_id]
    )
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/owner/zones/:id', ownerAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM zones WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Tables
router.get('/owner/tables', ownerAuth, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT t.*, z.name AS zone_name FROM tables t LEFT JOIN zones z ON t.zone_id=z.id WHERE t.restaurant_id=$1 ORDER BY t.table_number',
      [req.owner.restaurant_id]
    )
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/owner/tables', ownerAuth, async (req, res) => {
  try {
    const { table_number, zone_id, capacity } = req.body
    if (!table_number) return res.status(400).json({ error: 'Stol raqami kerak' })
    const r = await db.query(
      'INSERT INTO tables (restaurant_id,zone_id,table_number,capacity) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.owner.restaurant_id, zone_id||null, table_number, capacity||4]
    )
    res.status(201).json(r.rows[0])
  } catch(e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu raqamli stol mavjud' })
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/owner/tables/:id', ownerAuth, async (req, res) => {
  try {
    const { capacity, is_available, zone_id } = req.body
    const r = await db.query(
      'UPDATE tables SET capacity=$1,is_available=$2,zone_id=$3 WHERE id=$4 AND restaurant_id=$5 RETURNING *',
      [capacity, is_available, zone_id, req.params.id, req.owner.restaurant_id]
    )
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/owner/tables/:id', ownerAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM tables WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Availability
router.post('/owner/availability/block', ownerAuth, async (req, res) => {
  try {
    const { date, time, reason } = req.body
    if (!date || !time) return res.status(400).json({ error: 'date va time kerak' })
    await db.query(
      `INSERT INTO availability (restaurant_id,date,time,is_blocked,reason) VALUES ($1,$2,$3,true,$4)
       ON CONFLICT (restaurant_id,date,time) DO UPDATE SET is_blocked=true,reason=$4`,
      [req.owner.restaurant_id, date, time, reason]
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Owner — Analytics
router.get('/owner/analytics', ownerAuth, async (req, res) => {
  try {
    const rid = req.owner.restaurant_id
    if (!rid) return res.json({})
    const [today, weekly, monthly, peakHours, daily, revenue] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status!='cancelled'`, [rid]),
      db.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-7 AND status!='cancelled'`, [rid]),
      db.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date>=DATE_TRUNC('month',CURRENT_DATE) AND status!='cancelled'`, [rid]),
      db.query(`SELECT time, COUNT(*) AS count FROM reservations WHERE restaurant_id=$1 AND status!='cancelled' GROUP BY time ORDER BY count DESC LIMIT 5`, [rid]),
      db.query(`SELECT date, COUNT(*) AS count FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-7 GROUP BY date ORDER BY date`, [rid]),
      db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE restaurant_id=$1 AND status='paid' AND created_at>=DATE_TRUNC('month',CURRENT_DATE)`, [rid])
    ])
    res.json({
      today: +today.rows[0].count,
      weekly: +weekly.rows[0].count,
      monthly: +monthly.rows[0].count,
      revenue: +revenue.rows[0].total,
      peakHours: peakHours.rows,
      dailyStats: daily.rows
    })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════════

router.post('/payments/create/payme', userAuth, async (req, res) => {
  try {
    const { reservation_id, type='deposit' } = req.body
    const r = await db.query(
      `SELECT r.*, res.name AS restaurant_name FROM reservations r
       JOIN restaurants res ON r.restaurant_id=res.id WHERE r.id=$1 AND r.user_id=$2`,
      [reservation_id, req.user.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const booking = r.rows[0]
    const amount = type === 'deposit' ? 50000 : (booking.pre_order_total || 100000)
    const p = await db.query(
      `INSERT INTO payments (reservation_id,user_id,restaurant_id,amount,type,provider) VALUES ($1,$2,$3,$4,$5,'payme') RETURNING id`,
      [reservation_id, req.user.id, booking.restaurant_id, amount, type]
    )
    const params = Buffer.from(JSON.stringify({
      m: process.env.PAYME_MERCHANT_ID,
      ac: { order_id: p.rows[0].id },
      a: amount * 100, l: 'uz'
    })).toString('base64')
    const url = `${process.env.NODE_ENV==='production'?'https://checkout.paycom.uz':'https://test.paycom.uz'}/${params}`
    res.json({ payment_id: p.rows[0].id, url, amount, type })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/payments/create/click', userAuth, async (req, res) => {
  try {
    const { reservation_id, type='deposit' } = req.body
    const r = await db.query(
      `SELECT r.*, res.name AS restaurant_name FROM reservations r
       JOIN restaurants res ON r.restaurant_id=res.id WHERE r.id=$1 AND r.user_id=$2`,
      [reservation_id, req.user.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const booking = r.rows[0]
    const amount = type === 'deposit' ? 50000 : (booking.pre_order_total || 100000)
    const p = await db.query(
      `INSERT INTO payments (reservation_id,user_id,restaurant_id,amount,type,provider) VALUES ($1,$2,$3,$4,$5,'click') RETURNING id`,
      [reservation_id, req.user.id, booking.restaurant_id, amount, type]
    )
    const url = `https://my.click.uz/services/pay?service_id=${process.env.CLICK_SERVICE_ID}&merchant_id=${process.env.CLICK_MERCHANT_ID}&amount=${amount}&transaction_param=${p.rows[0].id}&return_url=${process.env.WEBAPP_URL}`
    res.json({ payment_id: p.rows[0].id, url, amount, type })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/payments/webhook/payme', async (req, res) => {
  try {
    const auth = req.headers.authorization
    if (!auth) return res.json({ error: { code: -32504, message: 'Unauthorized' } })
    const pass = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':')[1]
    const key = process.env.NODE_ENV==='production' ? process.env.PAYME_KEY : process.env.PAYME_TEST_KEY
    if (pass !== key) return res.json({ error: { code: -32504, message: 'Wrong key' } })

    const { method, params, id } = req.body
    if (method === 'CheckPerformTransaction') {
      const p = await db.query('SELECT * FROM payments WHERE id=$1', [params.account.order_id])
      if (!p.rows.length) return res.json({ id, error: { code: -31050, message: 'Not found' } })
      return res.json({ id, result: { allow: true } })
    }
    if (method === 'PerformTransaction') {
      await db.query('UPDATE payments SET status=$1,transaction_id=$2,paid_at=NOW() WHERE transaction_id=$2 OR id=$3',
        ['paid', params.id, params.account?.order_id])
      const p = await db.query('SELECT * FROM payments WHERE transaction_id=$1', [params.id])
      if (p.rows[0]) {
        await db.query(`UPDATE reservations SET status='confirmed',payment_status='deposit_paid',updated_at=NOW() WHERE id=$1`, [p.rows[0].reservation_id])
        const [u, r] = await Promise.all([
          db.query('SELECT telegram_id FROM users WHERE id=$1', [p.rows[0].user_id]),
          db.query('SELECT name FROM restaurants WHERE id=$1', [p.rows[0].restaurant_id])
        ])
        notify.notifyPaymentSuccess(u.rows[0]?.telegram_id, { ...p.rows[0], restaurant_name: r.rows[0]?.name }).catch(() => {})
      }
      return res.json({ id, result: { transaction: params.id, perform_time: Date.now(), state: 2 } })
    }
    if (method === 'CancelTransaction') {
      await db.query('UPDATE payments SET status=$1 WHERE transaction_id=$2', ['cancelled', params.id])
      return res.json({ id, result: { transaction: params.id, cancel_time: Date.now(), state: -1 } })
    }
    res.json({ id, result: null, error: { code: -32601, message: 'Method not found' } })
  } catch(e) { res.json({ id: req.body?.id, error: { code: -31008, message: 'Server error' } }) }
})

router.post('/payments/webhook/click/prepare', async (req, res) => {
  try {
    const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string } = req.body
    const mySign = crypto.createHash('md5').update(`${click_trans_id}${service_id}${process.env.CLICK_SECRET}${merchant_trans_id}${amount}${action}${sign_time}`).digest('hex')
    if (mySign !== sign_string) return res.json({ error: -1, error_note: 'SIGN CHECK FAILED!' })
    const p = await db.query('SELECT * FROM payments WHERE id=$1', [merchant_trans_id])
    if (!p.rows.length) return res.json({ error: -5, error_note: 'Not found' })
    res.json({ click_trans_id, merchant_trans_id, merchant_prepare_id: merchant_trans_id, error: 0, error_note: 'Success' })
  } catch(e) { res.json({ error: -9, error_note: 'Server error' }) }
})

router.post('/payments/webhook/click/complete', async (req, res) => {
  try {
    const { click_trans_id, service_id, merchant_trans_id, merchant_prepare_id, amount, action, error, sign_time, sign_string } = req.body
    const mySign = crypto.createHash('md5').update(`${click_trans_id}${service_id}${process.env.CLICK_SECRET}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`).digest('hex')
    if (mySign !== sign_string) return res.json({ error: -1, error_note: 'SIGN CHECK FAILED!' })
    if (parseInt(error) < 0) {
      await db.query('UPDATE payments SET status=$1 WHERE id=$2', ['failed', merchant_trans_id])
      return res.json({ error: 0, error_note: 'Success' })
    }
    await db.query('UPDATE payments SET status=$1,transaction_id=$2,paid_at=NOW() WHERE id=$3', ['paid', click_trans_id, merchant_trans_id])
    const p = await db.query('SELECT * FROM payments WHERE id=$1', [merchant_trans_id])
    if (p.rows[0]) {
      await db.query(`UPDATE reservations SET status='confirmed',payment_status='deposit_paid',updated_at=NOW() WHERE id=$1`, [p.rows[0].reservation_id])
      const [u, r] = await Promise.all([
        db.query('SELECT telegram_id FROM users WHERE id=$1', [p.rows[0].user_id]),
        db.query('SELECT name FROM restaurants WHERE id=$1', [p.rows[0].restaurant_id])
      ])
      notify.notifyPaymentSuccess(u.rows[0]?.telegram_id, { ...p.rows[0], restaurant_name: r.rows[0]?.name }).catch(() => {})
    }
    res.json({ error: 0, error_note: 'Success' })
  } catch(e) { res.json({ error: -9, error_note: 'Server error' }) }
})

// ════════════════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════════════════

router.post('/chat/:reservation_id/messages', userAuth, async (req, res) => {
  try {
    const { message } = req.body
    if (!message?.trim()) return res.status(400).json({ error: 'Xabar bo\'sh bo\'lishi mumkin emas' })
    const r = await db.query('SELECT * FROM reservations WHERE id=$1 AND user_id=$2', [req.params.reservation_id, req.user.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const msg = await db.query(
      `INSERT INTO chat_messages (reservation_id,restaurant_id,user_id,sender_type,message) VALUES ($1,$2,$3,'user',$4) RETURNING *`,
      [req.params.reservation_id, r.rows[0].restaurant_id, req.user.id, message.trim()]
    )
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${r.rows[0].restaurant_id}`).emit('new_message', msg.rows[0])
    const owner = await db.query('SELECT telegram_id FROM restaurant_owners WHERE restaurant_id=$1', [r.rows[0].restaurant_id])
    const u = await db.query('SELECT first_name FROM users WHERE id=$1', [req.user.id])
    notify.notifyOwnerNewMessage(owner.rows[0]?.telegram_id, u.rows[0]?.first_name||'Mijoz', message, req.params.reservation_id).catch(() => {})
    res.status(201).json(msg.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/chat/:reservation_id/messages/owner', ownerAuth, async (req, res) => {
  try {
    const { message } = req.body
    if (!message?.trim()) return res.status(400).json({ error: 'Xabar bo\'sh' })
    const r = await db.query('SELECT * FROM reservations WHERE id=$1 AND restaurant_id=$2', [req.params.reservation_id, req.owner.restaurant_id])
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const msg = await db.query(
      `INSERT INTO chat_messages (reservation_id,restaurant_id,user_id,sender_type,message) VALUES ($1,$2,$3,'owner',$4) RETURNING *`,
      [req.params.reservation_id, req.owner.restaurant_id, r.rows[0].user_id, message.trim()]
    )
    const io = req.app.get('io')
    if (io) io.to(`user_${r.rows[0].user_id}`).emit('new_message', msg.rows[0])
    const u = await db.query('SELECT telegram_id FROM users WHERE id=$1', [r.rows[0].user_id])
    const resto = await db.query('SELECT name FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
    if (u.rows[0]?.telegram_id) notify.sendTelegram(u.rows[0].telegram_id, `💬 <b>${resto.rows[0]?.name}:</b>\n${message}`).catch(() => {})
    await db.query(`UPDATE chat_messages SET is_read=true WHERE reservation_id=$1 AND sender_type='user' AND is_read=false`, [req.params.reservation_id])
    res.status(201).json(msg.rows[0])
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/chat/:reservation_id/messages', userAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT id FROM reservations WHERE id=$1 AND user_id=$2', [req.params.reservation_id, req.user.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const msgs = await db.query(
      `SELECT cm.*, u.first_name FROM chat_messages cm LEFT JOIN users u ON cm.user_id=u.id
       WHERE cm.reservation_id=$1 ORDER BY cm.created_at ASC`, [req.params.reservation_id]
    )
    await db.query(`UPDATE chat_messages SET is_read=true WHERE reservation_id=$1 AND sender_type='owner'`, [req.params.reservation_id])
    res.json(msgs.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/chat/owner/messages', ownerAuth, async (req, res) => {
  try {
    const msgs = await db.query(
      `SELECT cm.*, u.first_name, u.last_name, r.date, r.time, r.guests
       FROM chat_messages cm JOIN users u ON cm.user_id=u.id JOIN reservations r ON cm.reservation_id=r.id
       WHERE cm.restaurant_id=$1 ORDER BY cm.created_at DESC LIMIT 100`,
      [req.owner.restaurant_id]
    )
    const unread = await db.query(
      `SELECT COUNT(*) FROM chat_messages WHERE restaurant_id=$1 AND sender_type='user' AND is_read=false`,
      [req.owner.restaurant_id]
    )
    res.json({ messages: msgs.rows, unread_count: +unread.rows[0].count })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════════════════════════════

router.post('/reviews', async (req, res) => {
  try {
    const { telegram_id, reservation_id, restaurant_id, rating, comment, photo_url } = req.body
    if (!telegram_id || !restaurant_id || !rating) return res.status(400).json({ error: 'telegram_id, restaurant_id, rating kerak' })
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 orasida bo\'lishi kerak' })
    const u = await db.query('SELECT id FROM users WHERE telegram_id=$1', [String(telegram_id)])
    if (!u.rows.length) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' })
    const userId = u.rows[0].id
    const existing = await db.query('SELECT id FROM reviews WHERE user_id=$1 AND restaurant_id=$2', [userId, restaurant_id])
    let result
    if (existing.rows.length) {
      result = await db.query(
        `UPDATE reviews SET rating=$1,comment=$2,photo_url=$3,updated_at=NOW() WHERE user_id=$4 AND restaurant_id=$5 RETURNING *`,
        [rating, comment||null, photo_url||null, userId, restaurant_id]
      )
    } else {
      result = await db.query(
        `INSERT INTO reviews (user_id,restaurant_id,reservation_id,rating,comment,photo_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [userId, restaurant_id, reservation_id||null, rating, comment||null, photo_url||null]
      )
    }
    await db.query(
      `UPDATE restaurants SET rating=(SELECT AVG(rating)::numeric(3,1) FROM reviews WHERE restaurant_id=$1), review_count=(SELECT COUNT(*) FROM reviews WHERE restaurant_id=$1) WHERE id=$1`,
      [restaurant_id]
    )
    res.json({ success: true, review: result.rows[0] })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// AI
// ════════════════════════════════════════════════════════════════

router.post('/ai/chat', async (req, res) => {
  try {
    const { message, lang='uz', history=[] } = req.body
    if (!message) return res.status(400).json({ error: 'Xabar kerak' })

    let context = ''
    try {
      const r = await db.query(`SELECT name, cuisine, price_category, address FROM restaurants WHERE is_active=true AND status='approved' LIMIT 5`)
      context = r.rows.map(r => `- ${r.name} (${r.cuisine?.join(', ')}, ${r.price_category}, ${r.address})`).join('\n')
    } catch(e) {}

    const prompts = {
      uz: `Sen OneTable AI yordamchisisisan. Toshkentdagi restoran bron platformasi.\n${context?`Restoranlar:\n${context}`:''}\nQisqa va foydali javob ber. O'zbek tilida.`,
      ru: `Ты AI-ассистент OneTable. Рестораны Ташкента.\n${context?`Рестораны:\n${context}`:''}\nОтвечай кратко по-русски.`,
      en: `You are OneTable AI assistant for Tashkent restaurants.\n${context?`Restaurants:\n${context}`:''}\nBe brief and helpful.`
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: prompts[lang]||prompts.uz }, ...history.slice(-10), { role: 'user', content: message }],
        max_tokens: 500, temperature: 0.7
      })
    })
    const data = await groqRes.json()
    const reply = data.choices?.[0]?.message?.content
    if (!reply) throw new Error('No reply from AI')
    res.json({ reply })
  } catch(e) { logger.error('AI chat error:', e.message); res.status(500).json({ error: 'AI xatoligi' }) }
})

// ════════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════════

router.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, restaurants, reservations, revenue] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM restaurants WHERE status=$1', ['approved']),
      db.query('SELECT COUNT(*) FROM reservations WHERE date>=CURRENT_DATE-30'),
      db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='paid' AND created_at>=DATE_TRUNC('month',CURRENT_DATE)`)
    ])
    res.json({
      users: +users.rows[0].count,
      restaurants: +restaurants.rows[0].count,
      reservations: +reservations.rows[0].count,
      revenue: +revenue.rows[0].total
    })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.get('/admin/restaurants', adminAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM restaurants ORDER BY created_at DESC LIMIT 100')
    res.json(r.rows)
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/admin/restaurants/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body
    await db.query('UPDATE restaurants SET status=$1 WHERE id=$2', [status, req.params.id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Server xatoligi' }) }
})

module.exports = router
