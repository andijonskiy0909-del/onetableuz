/**
 * OneTable — Owner Routes (dashboard + mini-app compatible)
 *
 * Fixes:
 * - register vaqtida restaurant_name bo'lsa restaurant ham yaratadi
 * - stale JWT restaurant_id muammosini bartaraf qiladi (har so'rovda owner DB dan olinadi)
 * - dashboard kutayotgan response field'larni alias qiladi (user_name, guest_name, payment)
 * - GET/POST/PUT restaurant flow'ni silliq ishlatadi
 * - premium/request response'ni dashboard bilan moslashtiradi
 */

const router = require('express').Router()
const pool = require('../db')
const bcrypt = require('bcryptjs')
const { ownerAuth, createToken } = require('../middleware/auth')

const VALID_RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'noshow']
const VALID_MEDIA_TYPES = ['video', 'image', 'reel']
const VALID_PREMIUM_PLANS = ['monthly', 'yearly']

function badRequest(res, error, details = null) {
  return res.status(400).json({ error, details })
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullableText(value, fallback = null) {
  if (value === undefined || value === null) return fallback
  const normalized = String(value).trim()
  return normalized.length ? normalized : fallback
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'ha'].includes(normalized)) return true
    if (['false', '0', 'no', "yo'q"].includes(normalized)) return false
  }
  if (typeof value === 'number') return value === 1
  return fallback
}

function sanitizeOwner(owner) {
  if (!owner) return null
  const { password_hash, ...safeOwner } = owner
  return safeOwner
}

async function getFreshOwner(ownerId) {
  const result = await pool.query(
    `SELECT id, email, full_name, phone, role, restaurant_id, telegram_id
     FROM restaurant_owners
     WHERE id = $1`,
    [ownerId]
  )

  return result.rows[0] || null
}

async function requireFreshOwner(req, res) {
  const owner = await getFreshOwner(req.owner?.id)
  if (!owner) {
    res.status(401).json({ error: 'Avtorizatsiya yaroqsiz' })
    return null
  }
  return owner
}

async function getRestaurantByOwnerId(ownerId) {
  const owner = await getFreshOwner(ownerId)
  if (!owner?.restaurant_id) return { owner, restaurant: null }

  const restaurantResult = await pool.query(
    'SELECT * FROM restaurants WHERE id = $1',
    [owner.restaurant_id]
  )

  return {
    owner,
    restaurant: restaurantResult.rows[0] || null,
  }
}

function validateOwnerRegister(req, res, next) {
  const { email, password, full_name } = req.body
  if (!email || !password || !full_name) {
    return badRequest(res, 'email, password, full_name majburiy')
  }
  if (String(password).length < 6) {
    return badRequest(res, 'Parol kamida 6 ta belgi')
  }
  next()
}

function validateRestaurantCreate(req, res, next) {
  const { name } = req.body
  if (!name || !String(name).trim()) {
    return badRequest(res, 'name majburiy')
  }
  next()
}

function validateMenuItemInput(req, res, next) {
  const { name, price } = req.body
  if (!name || price === undefined || price === null || price === '') {
    return badRequest(res, 'name va price majburiy')
  }
  next()
}

async function emitReservationUpdate(req, restaurantId, payload) {
  const io = req.app.get('io')
  if (io) {
    io.to(`restaurant_${restaurantId}`).emit('reservation_updated', payload)
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!chatId || !process.env.BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
  } catch (_) {
    // intentionally ignored
  }
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

router.post('/register', validateOwnerRegister, async (req, res) => {
  const client = await pool.connect()

  try {
    const email = String(req.body.email).trim().toLowerCase()
    const password = String(req.body.password)
    const fullName = String(req.body.full_name).trim()
    const phone = asNullableText(req.body.phone)
    const restaurantName = asNullableText(req.body.restaurant_name)

    await client.query('BEGIN')

    const existing = await client.query(
      'SELECT id FROM restaurant_owners WHERE email = $1',
      [email]
    )

    if (existing.rows.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "Bu email allaqachon ro'yxatdan o'tgan" })
    }

    const hash = await bcrypt.hash(password, 12)

    const ownerResult = await client.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'owner')
       RETURNING id, email, full_name, phone, role, restaurant_id, telegram_id`,
      [email, hash, fullName, phone]
    )

    let owner = ownerResult.rows[0]
    let restaurant = null

    if (restaurantName) {
      const restaurantResult = await client.query(
        `INSERT INTO restaurants (
          name, address, status, is_active, is_demo, onboarding_completed,
          working_hours, capacity
        )
         VALUES ($1, $2, 'approved', true, false, false, '10:00 — 22:00', 50)
         RETURNING *`,
        [restaurantName, 'Manzil kiritilmagan']
      )

      restaurant = restaurantResult.rows[0]

      const ownerUpdate = await client.query(
        `UPDATE restaurant_owners
         SET restaurant_id = $1
         WHERE id = $2
         RETURNING id, email, full_name, phone, role, restaurant_id, telegram_id`,
        [restaurant.id, owner.id]
      )

      owner = ownerUpdate.rows[0]
    }

    await client.query('COMMIT')

    const token = createToken({
      id: owner.id,
      role: owner.role,
      restaurant_id: owner.restaurant_id,
    })

    return res.status(201).json({
      token,
      owner: sanitizeOwner(owner),
      restaurant,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('owner/register error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  } finally {
    client.release()
  }
})

router.post('/login', async (req, res) => {
  try {
    const email = asNullableText(req.body.email, '')?.toLowerCase()
    const password = String(req.body.password || '')

    if (!email || !password) {
      return badRequest(res, 'Email va parol kerak')
    }

    const result = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email = $1',
      [email]
    )

    const owner = result.rows[0]
    if (!owner) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" })
    }

    const valid = await bcrypt.compare(password, owner.password_hash)
    if (!valid) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" })
    }

    const token = createToken({
      id: owner.id,
      role: owner.role,
      restaurant_id: owner.restaurant_id,
    })

    return res.json({
      token,
      owner: sanitizeOwner(owner),
    })
  } catch (err) {
    console.error('owner/login error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// RESTAURANT
// ══════════════════════════════════════════════════════════════

router.get('/restaurant', ownerAuth, async (req, res) => {
  try {
    const data = await getRestaurantByOwnerId(req.owner.id)
    if (!data.owner) {
      return res.status(401).json({ error: 'Avtorizatsiya yaroqsiz' })
    }
    if (!data.restaurant) {
      return res.json({ restaurant: null, owner: sanitizeOwner(data.owner) })
    }

    return res.json({
      restaurant: data.restaurant,
      owner: sanitizeOwner(data.owner),
    })
  } catch (err) {
    console.error('owner/get restaurant error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/restaurants', ownerAuth, validateRestaurantCreate, async (req, res) => {
  const client = await pool.connect()

  try {
    const owner = await getFreshOwner(req.owner.id)
    if (!owner) {
      return res.status(401).json({ error: 'Avtorizatsiya yaroqsiz' })
    }

    if (owner.restaurant_id) {
      const currentRestaurant = await client.query(
        'SELECT * FROM restaurants WHERE id = $1',
        [owner.restaurant_id]
      )

      const token = createToken({
        id: owner.id,
        role: owner.role,
        restaurant_id: owner.restaurant_id,
      })

      return res.status(200).json({
        restaurant: currentRestaurant.rows[0] || null,
        owner: sanitizeOwner(owner),
        token,
      })
    }

    const payload = {
      name: asNullableText(req.body.name, 'Restoran'),
      description: asNullableText(req.body.description),
      address: asNullableText(req.body.address, 'Manzil kiritilmagan'),
      phone: asNullableText(req.body.phone),
      email: asNullableText(req.body.email),
      cuisine: asNullableText(req.body.cuisine),
      price_category: asNullableText(req.body.price_category, '$$'),
      capacity: toInt(req.body.capacity, 50),
      image_url: asNullableText(req.body.image_url),
      working_hours: asNullableText(req.body.working_hours, '10:00 — 22:00'),
      deposit_enabled: asBoolean(req.body.deposit_enabled, false),
      deposit_amount: toNumber(req.body.deposit_amount, 0),
      deposit_notes: asNullableText(req.body.deposit_notes),
    }

    await client.query('BEGIN')

    const restaurantResult = await client.query(
      `INSERT INTO restaurants (
        name, description, address, phone, email, cuisine, price_category,
        capacity, image_url, working_hours, status, is_active, is_demo,
        onboarding_completed, deposit_enabled, deposit_amount, deposit_notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, 'approved', true, false,
        false, $11, $12, $13
      )
      RETURNING *`,
      [
        payload.name,
        payload.description,
        payload.address,
        payload.phone,
        payload.email,
        payload.cuisine,
        payload.price_category,
        payload.capacity,
        payload.image_url,
        payload.working_hours,
        payload.deposit_enabled,
        payload.deposit_amount,
        payload.deposit_notes,
      ]
    )

    const restaurant = restaurantResult.rows[0]

    const ownerUpdate = await client.query(
      `UPDATE restaurant_owners
       SET restaurant_id = $1
       WHERE id = $2
       RETURNING id, email, full_name, phone, role, restaurant_id, telegram_id`,
      [restaurant.id, owner.id]
    )

    const updatedOwner = ownerUpdate.rows[0]

    await client.query('COMMIT')

    const token = createToken({
      id: updatedOwner.id,
      role: updatedOwner.role,
      restaurant_id: updatedOwner.restaurant_id,
    })

    return res.status(201).json({
      restaurant,
      owner: sanitizeOwner(updatedOwner),
      token,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('owner/create restaurant error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  } finally {
    client.release()
  }
})

router.put('/restaurant', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    if (!owner.restaurant_id) {
      return res.status(404).json({ error: 'Avval restoran yarating' })
    }

    const currentResult = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1',
      [owner.restaurant_id]
    )

    const current = currentResult.rows[0]
    if (!current) {
      return res.status(404).json({ error: 'Restoran topilmadi' })
    }

    const payload = {
      name: asNullableText(req.body.name, current.name),
      description: asNullableText(req.body.description, current.description),
      address: asNullableText(req.body.address, current.address || 'Manzil kiritilmagan'),
      phone: asNullableText(req.body.phone, current.phone),
      email: asNullableText(req.body.email, current.email),
      cuisine: asNullableText(req.body.cuisine, current.cuisine),
      price_category: asNullableText(req.body.price_category, current.price_category || '$$'),
      capacity: req.body.capacity !== undefined ? toInt(req.body.capacity, current.capacity || 50) : (current.capacity || 50),
      image_url: asNullableText(req.body.image_url, current.image_url),
      working_hours: asNullableText(req.body.working_hours, current.working_hours || '10:00 — 22:00'),
      deposit_enabled: req.body.deposit_enabled !== undefined ? asBoolean(req.body.deposit_enabled, current.deposit_enabled) : current.deposit_enabled,
      deposit_amount: req.body.deposit_amount !== undefined ? toNumber(req.body.deposit_amount, current.deposit_amount || 0) : (current.deposit_amount || 0),
      deposit_notes: req.body.deposit_notes !== undefined ? asNullableText(req.body.deposit_notes, current.deposit_notes) : current.deposit_notes,
    }

    if (!payload.name) {
      return badRequest(res, 'name majburiy')
    }

    const result = await pool.query(
      `UPDATE restaurants
       SET name = $1,
           description = $2,
           address = $3,
           phone = $4,
           email = $5,
           cuisine = $6,
           price_category = $7,
           capacity = $8,
           image_url = $9,
           working_hours = $10,
           deposit_enabled = $11,
           deposit_amount = $12,
           deposit_notes = $13,
           onboarding_completed = true,
           updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        payload.name,
        payload.description,
        payload.address,
        payload.phone,
        payload.email,
        payload.cuisine,
        payload.price_category,
        payload.capacity,
        payload.image_url,
        payload.working_hours,
        payload.deposit_enabled,
        payload.deposit_amount,
        payload.deposit_notes,
        owner.restaurant_id,
      ]
    )

    return res.json({
      restaurant: result.rows[0],
      owner: sanitizeOwner(owner),
    })
  } catch (err) {
    console.error('owner/update restaurant error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/restaurant/location', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    if (!owner.restaurant_id) {
      return res.status(404).json({ error: 'Restoran topilmadi' })
    }

    const latitude = Number(req.body.latitude)
    const longitude = Number(req.body.longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return badRequest(res, "Koordinatalar noto'g'ri")
    }

    await pool.query(
      `UPDATE restaurants
       SET latitude = $1, longitude = $2, updated_at = NOW()
       WHERE id = $3`,
      [latitude, longitude, owner.restaurant_id]
    )

    return res.json({ success: true, latitude, longitude })
  } catch (err) {
    console.error('owner/update location error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// RESERVATIONS
// ══════════════════════════════════════════════════════════════

router.get('/reservations', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    if (!owner.restaurant_id) {
      return res.json([])
    }

    const date = asNullableText(req.query.date)
    const status = asNullableText(req.query.status)
    const page = Math.max(toInt(req.query.page, 1), 1)
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200)
    const offset = (page - 1) * limit

    let query = `
      SELECT
        r.*,
        TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS user_name,
        TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS guest_name,
        u.first_name,
        u.last_name,
        u.phone,
        z.name AS zone_name,
        t.table_number
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN zones z ON r.zone_id = z.id
      LEFT JOIN tables t ON r.table_id = t.id
      WHERE r.restaurant_id = $1
    `

    const params = [owner.restaurant_id]

    if (date) {
      params.push(date)
      query += ` AND r.date = $${params.length}`
    }

    if (status) {
      params.push(status)
      query += ` AND r.status = $${params.length}`
    }

    query += ` ORDER BY r.date DESC, r.time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result = await pool.query(query, params)
    return res.json(result.rows)
  } catch (err) {
    console.error('owner/get reservations error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    if (!owner.restaurant_id) {
      return res.status(404).json({ error: 'Restoran topilmadi' })
    }

    const id = toInt(req.params.id, NaN)
    const status = asNullableText(req.body.status)

    if (!Number.isFinite(id)) {
      return badRequest(res, "ID noto'g'ri")
    }

    if (!VALID_RESERVATION_STATUSES.includes(status)) {
      return badRequest(res, "Noto'g'ri status")
    }

    const result = await pool.query(
      `UPDATE reservations
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, id, owner.restaurant_id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Bron topilmadi' })
    }

    const reservation = result.rows[0]

    const userRes = await pool.query(
      'SELECT telegram_id, first_name, last_name FROM users WHERE id = $1',
      [reservation.user_id]
    )

    const user = userRes.rows[0]
    const dateStr = String(reservation.date).split('T')[0]
    const timeStr = String(reservation.time || '').slice(0, 5)
    const text = status === 'confirmed'
      ? `✅ <b>Broningiz tasdiqlandi!</b>\n📅 ${dateStr} — ⏰ ${timeStr}\n👥 ${reservation.guests} kishi`
      : status === 'completed'
      ? `🎉 <b>Tashrifingiz uchun rahmat!</b>`
      : status === 'noshow'
      ? `⚠️ <b>Bron noshow sifatida belgilandi.</b>\n📅 ${dateStr} — ⏰ ${timeStr}`
      : `❌ <b>Broningiz bekor qilindi.</b>\n📅 ${dateStr} — ⏰ ${timeStr}`

    await sendTelegramMessage(user?.telegram_id, text)
    await emitReservationUpdate(req, owner.restaurant_id, { id, status })

    return res.json({
      ...reservation,
      user_name: [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || null,
      guest_name: [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || null,
    })
  } catch (err) {
    console.error('owner/update reservation error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════

router.get('/analytics', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    const restaurantId = owner.restaurant_id
    if (!restaurantId) {
      return res.json({
        today: 0,
        weekly: 0,
        monthly: 0,
        revenue: 0,
        todayRevenue: 0,
        peakHours: [],
        dailyStats: [],
      })
    }

    const [
      today,
      weekly,
      monthly,
      revenue,
      todayRevenue,
      peakHours,
      dailyStats,
      confirmedCount,
      cancelledCount,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM reservations
         WHERE restaurant_id = $1 AND date = CURRENT_DATE AND status != 'cancelled'`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM reservations
         WHERE restaurant_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days' AND status != 'cancelled'`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM reservations
         WHERE restaurant_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days' AND status != 'cancelled'`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
         WHERE restaurant_id = $1 AND status = 'paid'`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
         WHERE restaurant_id = $1 AND status = 'paid' AND DATE(created_at) = CURRENT_DATE`,
        [restaurantId]
      ),
      pool.query(
        `SELECT time, COUNT(*) AS count
         FROM reservations
         WHERE restaurant_id = $1 AND status != 'cancelled'
         GROUP BY time
         ORDER BY count DESC, time ASC
         LIMIT 6`,
        [restaurantId]
      ),
      pool.query(
        `SELECT date::text, COUNT(*) AS count
         FROM reservations
         WHERE restaurant_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
         GROUP BY date
         ORDER BY date ASC`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM reservations
         WHERE restaurant_id = $1 AND status IN ('confirmed', 'completed')`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM reservations
         WHERE restaurant_id = $1 AND status = 'cancelled'`,
        [restaurantId]
      ),
    ])

    const payload = {
      today: toInt(today.rows[0]?.count, 0),
      weekly: toInt(weekly.rows[0]?.count, 0),
      monthly: toInt(monthly.rows[0]?.count, 0),
      revenue: toInt(revenue.rows[0]?.total, 0),
      todayRevenue: toInt(todayRevenue.rows[0]?.total, 0),
      peakHours: peakHours.rows,
      dailyStats: dailyStats.rows,
      reservationStats: {
        confirmed: toInt(confirmedCount.rows[0]?.count, 0),
        cancelled: toInt(cancelledCount.rows[0]?.count, 0),
      },
    }

    return res.json(payload)
  } catch (err) {
    console.error('owner/analytics error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════════════════════

router.get('/menu', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json([])

    const result = await pool.query(
      'SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category NULLS LAST, name ASC',
      [owner.restaurant_id]
    )

    return res.json(result.rows)
  } catch (err) {
    console.error('owner/get menu error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/menu', ownerAuth, validateMenuItemInput, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const name = asNullableText(req.body.name)
    const category = asNullableText(req.body.category, 'Asosiy')
    const price = toNumber(req.body.price, 0)
    const description = asNullableText(req.body.description)
    const image_url = asNullableText(req.body.image_url)

    const result = await pool.query(
      `INSERT INTO menu_items (
        restaurant_id, name, category, price, description, image_url, is_available
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *`,
      [owner.restaurant_id, name, category, price, description, image_url]
    )

    return res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('owner/create menu error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    const current = await pool.query(
      'SELECT * FROM menu_items WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    if (!current.rows.length) {
      return res.status(404).json({ error: 'Taom topilmadi' })
    }

    const row = current.rows[0]
    const result = await pool.query(
      `UPDATE menu_items
       SET name = $1,
           category = $2,
           description = $3,
           price = $4,
           is_available = $5,
           image_url = $6
       WHERE id = $7 AND restaurant_id = $8
       RETURNING *`,
      [
        asNullableText(req.body.name, row.name),
        asNullableText(req.body.category, row.category),
        asNullableText(req.body.description, row.description),
        req.body.price !== undefined ? toNumber(req.body.price, row.price) : row.price,
        req.body.is_available !== undefined ? asBoolean(req.body.is_available, row.is_available) : row.is_available,
        asNullableText(req.body.image_url, row.image_url),
        id,
        owner.restaurant_id,
      ]
    )

    return res.json(result.rows[0])
  } catch (err) {
    console.error('owner/update menu error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    await pool.query(
      'DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/delete menu error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// ZONES
// ══════════════════════════════════════════════════════════════

router.get('/zones', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json([])

    const result = await pool.query(
      'SELECT * FROM zones WHERE restaurant_id = $1 ORDER BY created_at ASC, id ASC',
      [owner.restaurant_id]
    )

    return res.json(result.rows)
  } catch (err) {
    console.error('owner/get zones error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/zones', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const name = asNullableText(req.body.name)
    if (!name) return badRequest(res, 'Zona nomi kerak')

    const result = await pool.query(
      `INSERT INTO zones (
        restaurant_id, name, description, capacity, icon, is_available
      )
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *`,
      [
        owner.restaurant_id,
        name,
        asNullableText(req.body.description),
        toInt(req.body.capacity, 10),
        asNullableText(req.body.icon, '🪑'),
      ]
    )

    return res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('owner/create zone error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/zones/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    const current = await pool.query(
      'SELECT * FROM zones WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    if (!current.rows.length) {
      return res.status(404).json({ error: 'Zona topilmadi' })
    }

    const row = current.rows[0]
    const result = await pool.query(
      `UPDATE zones
       SET name = $1,
           description = $2,
           capacity = $3,
           icon = $4,
           is_available = $5
       WHERE id = $6 AND restaurant_id = $7
       RETURNING *`,
      [
        asNullableText(req.body.name, row.name),
        asNullableText(req.body.description, row.description),
        req.body.capacity !== undefined ? toInt(req.body.capacity, row.capacity) : row.capacity,
        asNullableText(req.body.icon, row.icon),
        req.body.is_available !== undefined ? asBoolean(req.body.is_available, row.is_available) : row.is_available,
        id,
        owner.restaurant_id,
      ]
    )

    return res.json(result.rows[0])
  } catch (err) {
    console.error('owner/update zone error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/zones/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    await pool.query(
      'DELETE FROM zones WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/delete zone error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// TABLES
// ══════════════════════════════════════════════════════════════

router.get('/tables', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json([])

    const result = await pool.query(
      `SELECT t.*, z.name AS zone_name
       FROM tables t
       LEFT JOIN zones z ON t.zone_id = z.id
       WHERE t.restaurant_id = $1
       ORDER BY t.table_number ASC, t.id ASC`,
      [owner.restaurant_id]
    )

    return res.json(result.rows)
  } catch (err) {
    console.error('owner/get tables error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/tables', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const table_number = asNullableText(req.body.table_number)
    if (!table_number) return badRequest(res, 'Stol raqami kerak')

    const result = await pool.query(
      `INSERT INTO tables (
        restaurant_id, table_number, zone_id, capacity, is_available
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING *`,
      [
        owner.restaurant_id,
        table_number,
        req.body.zone_id ? toInt(req.body.zone_id, null) : null,
        toInt(req.body.capacity, 4),
      ]
    )

    return res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('owner/create table error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/tables/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    const current = await pool.query(
      'SELECT * FROM tables WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    if (!current.rows.length) {
      return res.status(404).json({ error: 'Stol topilmadi' })
    }

    const row = current.rows[0]
    const result = await pool.query(
      `UPDATE tables
       SET table_number = $1,
           zone_id = $2,
           capacity = $3,
           is_available = $4
       WHERE id = $5 AND restaurant_id = $6
       RETURNING *`,
      [
        asNullableText(req.body.table_number, row.table_number),
        req.body.zone_id !== undefined ? (req.body.zone_id ? toInt(req.body.zone_id, null) : null) : row.zone_id,
        req.body.capacity !== undefined ? toInt(req.body.capacity, row.capacity) : row.capacity,
        req.body.is_available !== undefined ? asBoolean(req.body.is_available, row.is_available) : row.is_available,
        id,
        owner.restaurant_id,
      ]
    )

    return res.json(result.rows[0])
  } catch (err) {
    console.error('owner/update table error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/tables/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    await pool.query(
      'DELETE FROM tables WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/delete table error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// MEDIA
// ══════════════════════════════════════════════════════════════

router.get('/media', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json([])

    const type = asNullableText(req.query.type)
    let query = 'SELECT * FROM restaurant_media WHERE restaurant_id = $1'
    const params = [owner.restaurant_id]

    if (type) {
      params.push(type)
      query += ` AND type = $${params.length}`
    }

    query += ' ORDER BY sort_order ASC, created_at DESC'

    const result = await pool.query(query, params)
    return res.json(result.rows)
  } catch (err) {
    console.error('owner/get media error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/media', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const type = asNullableText(req.body.type)
    const url = asNullableText(req.body.url)
    if (!type || !url) return badRequest(res, 'type va url kerak')
    if (!VALID_MEDIA_TYPES.includes(type)) {
      return badRequest(res, 'type: video, image, reel')
    }

    const result = await pool.query(
      `INSERT INTO restaurant_media (
        restaurant_id, type, url, thumbnail_url, caption,
        sort_order, duration_seconds, uploaded_by, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING *`,
      [
        owner.restaurant_id,
        type,
        url,
        asNullableText(req.body.thumbnail_url),
        asNullableText(req.body.caption),
        toInt(req.body.sort_order, 0),
        req.body.duration_seconds !== undefined ? toInt(req.body.duration_seconds, 0) : null,
        owner.id,
      ]
    )

    return res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('owner/create media error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/media/:id', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    await pool.query(
      'DELETE FROM restaurant_media WHERE id = $1 AND restaurant_id = $2',
      [id, owner.restaurant_id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/delete media error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// PREMIUM / SUBSCRIPTION
// ══════════════════════════════════════════════════════════════

router.get('/premium', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) {
      return res.json({ subscription: null, is_premium: false })
    }

    const [sub, resto] = await Promise.all([
      pool.query(
        `SELECT * FROM premium_subscriptions
         WHERE restaurant_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [owner.restaurant_id]
      ),
      pool.query(
        'SELECT is_premium FROM restaurants WHERE id = $1',
        [owner.restaurant_id]
      ),
    ])

    return res.json({
      subscription: sub.rows[0] || null,
      is_premium: Boolean(resto.rows[0]?.is_premium),
    })
  } catch (err) {
    console.error('owner/get premium error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/premium/request', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const plan = asNullableText(req.body.plan)
    const payment_method = asNullableText(req.body.payment_method, 'manual')

    if (!VALID_PREMIUM_PLANS.includes(plan)) {
      return badRequest(res, 'Plan: monthly yoki yearly')
    }

    const amount = plan === 'yearly' ? 1200000 : 150000
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + (plan === 'yearly' ? 12 : 1))

    await pool.query(
      `UPDATE premium_subscriptions
       SET status = 'cancelled'
       WHERE restaurant_id = $1
         AND status IN ('pending_payment', 'waiting_verification')`,
      [owner.restaurant_id]
    )

    const result = await pool.query(
      `INSERT INTO premium_subscriptions (
        restaurant_id, plan, amount, status, expires_at, payment_method
      )
      VALUES ($1, $2, $3, 'pending_payment', $4, $5)
      RETURNING *`,
      [owner.restaurant_id, plan, amount, expiresAt, payment_method]
    )

    const subscription = result.rows[0]
    const paymentInstructions = {
      card_number: process.env.ADMIN_CARD_NUMBER || '8600 **** **** ****',
      card_holder: process.env.ADMIN_CARD_HOLDER || 'OneTable Admin',
      amount,
      plan,
      note: `To'lov izohida subscription ID: ${subscription.id} ni yozing`,
    }

    await pool.query(
      `INSERT INTO admin_notifications (type, restaurant_id, subscription_id, message)
       VALUES ('subscription_payment', $1, $2, $3)`,
      [
        owner.restaurant_id,
        subscription.id,
        `Yangi subscription so'rov: ${plan}, ${amount.toLocaleString()} so'm`,
      ]
    )

    return res.status(201).json({
      subscription,
      payment_instructions: paymentInstructions,
      payment: paymentInstructions,
      amount,
      plan,
    })
  } catch (err) {
    console.error('owner/premium request error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/premium/:id/proof', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    const proof_url = asNullableText(req.body.proof_url)
    if (!proof_url) return badRequest(res, 'proof_url kerak')

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    const result = await pool.query(
      `UPDATE premium_subscriptions
       SET payment_proof_url = $1,
           status = 'waiting_verification',
           payment_date = NOW()
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [proof_url, id, owner.restaurant_id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Topilmadi' })
    }

    await pool.query(
      `UPDATE admin_notifications
       SET is_read = false
       WHERE subscription_id = $1`,
      [id]
    )

    return res.json({ success: true, subscription: result.rows[0] })
  } catch (err) {
    console.error('owner/premium proof error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/premium/:id/verify', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return

    if (owner.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin' })
    }

    const action = asNullableText(req.body.action)
    const rejection_reason = asNullableText(req.body.rejection_reason)
    const id = toInt(req.params.id, NaN)

    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")
    if (!['approve', 'reject'].includes(action)) {
      return badRequest(res, 'action: approve yoki reject')
    }

    const sub = await pool.query(
      'SELECT * FROM premium_subscriptions WHERE id = $1',
      [id]
    )

    if (!sub.rows.length) {
      return res.status(404).json({ error: 'Topilmadi' })
    }

    const subscription = sub.rows[0]

    if (action === 'approve') {
      await pool.query(
        `UPDATE premium_subscriptions
         SET status = 'active', verified_by = $1, verified_at = NOW()
         WHERE id = $2`,
        [owner.id, id]
      )

      await pool.query(
        'UPDATE restaurants SET is_premium = true WHERE id = $1',
        [subscription.restaurant_id]
      )

      const ownerRes = await pool.query(
        `SELECT telegram_id
         FROM restaurant_owners
         WHERE restaurant_id = $1
         ORDER BY id ASC
         LIMIT 1`,
        [subscription.restaurant_id]
      )

      const ownerChatId = ownerRes.rows[0]?.telegram_id
      const expiresDate = subscription.expires_at
        ? new Date(subscription.expires_at).toISOString().split('T')[0]
        : '—'

      await sendTelegramMessage(
        ownerChatId,
        `💎 <b>Premium faollashtirildi!</b>\n\nRestoran premium ro'yxatga kiritildi. Muddati: ${expiresDate}`
      )
    } else {
      await pool.query(
        `UPDATE premium_subscriptions
         SET status = 'rejected', verified_by = $1, verified_at = NOW(), rejection_reason = $2
         WHERE id = $3`,
        [owner.id, rejection_reason, id]
      )
    }

    return res.json({ success: true, action })
  } catch (err) {
    console.error('owner/premium verify error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/premium', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.status(404).json({ error: 'Restoran topilmadi' })

    await pool.query(
      `UPDATE premium_subscriptions
       SET status = 'cancelled'
       WHERE restaurant_id = $1 AND status = 'active'`,
      [owner.restaurant_id]
    )

    await pool.query(
      'UPDATE restaurants SET is_premium = false WHERE id = $1',
      [owner.restaurant_id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/delete premium error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════

router.get('/payments', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json({ payments: [], total_paid: 0 })

    const status = asNullableText(req.query.status)
    const type = asNullableText(req.query.type)
    const from = asNullableText(req.query.from)
    const to = asNullableText(req.query.to)
    const page = Math.max(toInt(req.query.page, 1), 1)
    const limit = Math.min(Math.max(toInt(req.query.limit, 30), 1), 200)
    const offset = (page - 1) * limit

    let query = `
      SELECT p.*, r.date AS res_date, r.time AS res_time, r.guests,
             u.first_name, u.last_name
      FROM payments p
      LEFT JOIN reservations r ON p.reservation_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE p.restaurant_id = $1
    `

    const params = [owner.restaurant_id]

    if (status) {
      params.push(status)
      query += ` AND p.status = $${params.length}`
    }

    if (type) {
      params.push(type)
      query += ` AND p.type = $${params.length}`
    }

    if (from) {
      params.push(from)
      query += ` AND p.created_at >= $${params.length}`
    }

    if (to) {
      params.push(to)
      query += ` AND p.created_at <= $${params.length}`
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const [result, total] = await Promise.all([
      pool.query(query, params),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
         WHERE restaurant_id = $1 AND status = 'paid'`,
        [owner.restaurant_id]
      ),
    ])

    return res.json({
      payments: result.rows,
      total_paid: toInt(total.rows[0]?.total, 0),
    })
  } catch (err) {
    console.error('owner/payments error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════

router.get('/chat/owner/messages', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (!owner.restaurant_id) return res.json({ messages: [], unread_count: 0 })

    const result = await pool.query(
      `SELECT m.*, u.first_name, u.last_name, r.date, r.time
       FROM chat_messages m
       JOIN reservations r ON m.reservation_id = r.id
       JOIN users u ON r.user_id = u.id
       WHERE r.restaurant_id = $1
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [owner.restaurant_id]
    )

    const unread_count = result.rows.filter(
      (message) => message.sender_type === 'user' && !message.is_read
    ).length

    return res.json({ messages: result.rows, unread_count })
  } catch (err) {
    console.error('owner/chat messages error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// ADMIN NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

router.get('/admin/notifications', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (owner.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin' })
    }

    const result = await pool.query(
      `SELECT n.*, res.name AS restaurant_name,
              ps.plan, ps.amount, ps.status AS sub_status,
              ps.payment_proof_url
       FROM admin_notifications n
       LEFT JOIN restaurants res ON n.restaurant_id = res.id
       LEFT JOIN premium_subscriptions ps ON n.subscription_id = ps.id
       ORDER BY n.created_at DESC
       LIMIT 50`
    )

    return res.json(result.rows)
  } catch (err) {
    console.error('owner/admin notifications error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/admin/notifications/:id/read', ownerAuth, async (req, res) => {
  try {
    const owner = await requireFreshOwner(req, res)
    if (!owner) return
    if (owner.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin' })
    }

    const id = toInt(req.params.id, NaN)
    if (!Number.isFinite(id)) return badRequest(res, "ID noto'g'ri")

    await pool.query(
      'UPDATE admin_notifications SET is_read = true WHERE id = $1',
      [id]
    )

    return res.json({ success: true })
  } catch (err) {
    console.error('owner/read notification error:', err)
    return res.status(500).json({ error: 'Server xatoligi' })
  }
})

module.exports = router
