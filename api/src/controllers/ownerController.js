const db = require('../config/db')
const logger = require('../config/logger')
const { sign } = require('../utils/jwt')

// ── Me / Restaurant ──────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const owner = { ...req.owner }
    delete owner.password_hash
    let restaurant = null
    if (owner.restaurant_id) {
      const r = await db.query('SELECT * FROM restaurants WHERE id = $1', [owner.restaurant_id])
      restaurant = r.rows[0] || null
    }
    res.json({ owner, restaurant })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.getRestaurant = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null)
    const r = await db.query('SELECT * FROM restaurants WHERE id = $1', [req.owner.restaurant_id])
    res.json(r.rows[0] || null)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.createRestaurant = async (req, res) => {
  try {
    const b = req.body || {}
    const r = await db.query(`
      INSERT INTO restaurants (
        owner_id, name, description, phone, email, address,
        working_hours, capacity, price_category, image_url, cover_url,
        cuisine, gallery, status, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'approved',true)
      RETURNING *
    `, [
      req.owner.id,
      b.name, b.description || null, b.phone || null, b.email || null, b.address || null,
      b.working_hours || '10:00-23:00', Number(b.capacity) || 50, b.price_category || '$$',
      b.image_url || null, b.cover_url || null,
      Array.isArray(b.cuisine) ? b.cuisine : (b.cuisine ? [b.cuisine] : []),
      Array.isArray(b.gallery) ? b.gallery : []
    ])
    const restaurant = r.rows[0]
    await db.query('UPDATE owners SET restaurant_id = $1 WHERE id = $2', [restaurant.id, req.owner.id])
    const token = sign({ id: req.owner.id, kind: 'owner' })
    res.json({ restaurant, owner: { ...req.owner, restaurant_id: restaurant.id, password_hash: undefined }, token })
  } catch (e) {
    logger.error('createRestaurant:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.updateRestaurant = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran hali yaratilmagan' })
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
    if (b.working_hours !== undefined) push('working_hours', b.working_hours)
    if (b.capacity !== undefined) push('capacity', Number(b.capacity) || 0)
    if (b.price_category !== undefined) push('price_category', b.price_category)
    if (b.image_url !== undefined) push('image_url', b.image_url)
    if (b.cover_url !== undefined) push('cover_url', b.cover_url)
    if (b.cuisine !== undefined) push('cuisine', Array.isArray(b.cuisine) ? b.cuisine : (b.cuisine ? [b.cuisine] : []))
    if (b.gallery !== undefined) push('gallery', Array.isArray(b.gallery) ? b.gallery : [])

    if (!fields.length) return res.json(null)
    values.push(req.owner.restaurant_id)

    const r = await db.query(
      `UPDATE restaurants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    )
    res.json(r.rows[0])
  } catch (e) {
    logger.error('updateRestaurant:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body || {}
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    await db.query(
      'UPDATE restaurants SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3',
      [latitude, longitude, req.owner.restaurant_id]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Reservations ─────────────────────────────────────────────
exports.listReservations = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json([])
    const r = await db.query(`
      SELECT res.*, u.first_name, u.last_name, u.phone AS user_phone, u.username,
             z.name AS zone_name, t.table_number,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))), ''), u.username, 'Mijoz') AS user_name
      FROM reservations res
      LEFT JOIN users u ON u.id = res.user_id
      LEFT JOIN zones z ON z.id = res.zone_id
      LEFT JOIN tables t ON t.id = res.table_id
      WHERE res.restaurant_id = $1
      ORDER BY res.date DESC, res.time DESC
      LIMIT 500
    `, [req.owner.restaurant_id])
    res.json(r.rows)
  } catch (e) {
    logger.error('owner.listReservations:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.updateReservation = async (req, res) => {
  try {
    const { status } = req.body || {}
    if (!['pending','confirmed','cancelled','completed','noshow'].includes(status)) {
      return res.status(400).json({ error: 'Yaroqsiz holat' })
    }
    const r = await db.query(`
      UPDATE reservations SET status = $1, updated_at = NOW()
      WHERE id = $2 AND restaurant_id = $3 RETURNING *
    `, [status, req.params.id, req.owner.restaurant_id])
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })

    const io = req.app.get('io')
    if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', r.rows[0])

    res.json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Menu ─────────────────────────────────────────────────────
exports.listMenu = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json([])
    const r = await db.query('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY sort_order, id', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.createMenu = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    const { name, description, price, image_url, category } = req.body || {}
    if (!name || price == null) return res.status(400).json({ error: 'Nom va narx kerak' })
    const r = await db.query(`
      INSERT INTO menu_items (restaurant_id, name, description, price, image_url, category, is_available)
      VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *
    `, [req.owner.restaurant_id, name, description || null, Number(price), image_url || null, category || null])
    res.status(201).json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.updateMenu = async (req, res) => {
  try {
    const { name, description, price, image_url, category, is_available } = req.body || {}
    const r = await db.query(`
      UPDATE menu_items
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          price = COALESCE($3, price),
          image_url = COALESCE($4, image_url),
          category = COALESCE($5, category),
          is_available = COALESCE($6, is_available)
      WHERE id = $7 AND restaurant_id = $8 RETURNING *
    `, [name, description, price != null ? Number(price) : null, image_url, category, is_available, req.params.id, req.owner.restaurant_id])
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    res.json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.deleteMenu = async (req, res) => {
  try {
    await db.query('DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Zones ────────────────────────────────────────────────────
exports.listZones = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json([])
    const r = await db.query('SELECT * FROM zones WHERE restaurant_id = $1 ORDER BY id', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.createZone = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    const { name, description, capacity } = req.body || {}
    const r = await db.query(`
      INSERT INTO zones (restaurant_id, name, description, capacity, is_available)
      VALUES ($1,$2,$3,$4,true) RETURNING *
    `, [req.owner.restaurant_id, name, description || null, Number(capacity) || 20])
    res.status(201).json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.updateZone = async (req, res) => {
  try {
    const { name, description, capacity, is_available } = req.body || {}
    const r = await db.query(`
      UPDATE zones SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        capacity = COALESCE($3, capacity),
        is_available = COALESCE($4, is_available)
      WHERE id = $5 AND restaurant_id = $6 RETURNING *
    `, [name, description, capacity != null ? Number(capacity) : null, is_available, req.params.id, req.owner.restaurant_id])
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    res.json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.deleteZone = async (req, res) => {
  try {
    await db.query('DELETE FROM zones WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Tables ───────────────────────────────────────────────────
exports.listTables = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json([])
    const r = await db.query('SELECT * FROM tables WHERE restaurant_id = $1 ORDER BY id', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.createTable = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    const { zone_id, table_number, capacity } = req.body || {}
    const r = await db.query(`
      INSERT INTO tables (restaurant_id, zone_id, table_number, capacity, is_available)
      VALUES ($1,$2,$3,$4,true) RETURNING *
    `, [req.owner.restaurant_id, zone_id || null, String(table_number), Number(capacity) || 4])
    res.status(201).json(r.rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu stol raqami mavjud' })
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.deleteTable = async (req, res) => {
  try {
    await db.query('DELETE FROM tables WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Reels ────────────────────────────────────────────────────
exports.listReels = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json([])
    const r = await db.query('SELECT * FROM reels WHERE restaurant_id = $1 ORDER BY created_at DESC', [req.owner.restaurant_id])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.createReel = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    const { url, thumbnail_url, caption, type } = req.body || {}
    if (!url) return res.status(400).json({ error: 'URL kerak' })
    const r = await db.query(`
      INSERT INTO reels (restaurant_id, url, thumbnail_url, caption, type, is_published)
      VALUES ($1,$2,$3,$4,$5,true) RETURNING *
    `, [req.owner.restaurant_id, url, thumbnail_url || null, caption || null, type || 'video'])
    res.status(201).json(r.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.deleteReel = async (req, res) => {
  try {
    await db.query('DELETE FROM reels WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.owner.restaurant_id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Analytics ────────────────────────────────────────────────
exports.analytics = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json({ today: 0, weekly: 0, monthly: 0, revenue: 0 })
    const rid = req.owner.restaurant_id
    const [today, week, month, revenue] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled')`, [rid]),
      db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date >= CURRENT_DATE - INTERVAL '7 days' AND status NOT IN ('cancelled')`, [rid]),
      db.query(`SELECT COUNT(*)::int AS c FROM reservations WHERE restaurant_id=$1 AND date >= CURRENT_DATE - INTERVAL '30 days' AND status NOT IN ('cancelled')`, [rid]),
      db.query(`SELECT COALESCE(SUM(pre_order_total),0)::numeric AS s FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled')`, [rid])
    ])
    res.json({
      today: today.rows[0].c,
      weekly: week.rows[0].c,
      monthly: month.rows[0].c,
      todayRevenue: Number(revenue.rows[0].s || 0),
      revenue: Number(revenue.rows[0].s || 0)
    })
  } catch (e) {
    logger.error('analytics:', e.message)
    res.status(500).json({ error: 'Server xatolik' })
  }
}

// ── Premium ──────────────────────────────────────────────────
exports.premiumStatus = async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json({ is_premium: false, subscription: null })
    const r = await db.query('SELECT is_premium, premium_until FROM restaurants WHERE id = $1', [req.owner.restaurant_id])
    const row = r.rows[0] || {}
    res.json({
      is_premium: row.is_premium || false,
      subscription: row.premium_until ? { until: row.premium_until } : null
    })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}

exports.premiumRequest = async (req, res) => {
  try {
    const { plan } = req.body || {}
    const amount = plan === 'yearly' ? 1200000 : 150000
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Restoran yoʻq' })
    await db.query(
      'INSERT INTO premium_requests (restaurant_id, plan, amount, status) VALUES ($1,$2,$3,$4)',
      [req.owner.restaurant_id, plan || 'monthly', amount, 'pending']
    )
    res.json({
      ok: true,
      payment_instructions: {
        card_number: '9860 0101 2345 6789',
        card_holder: 'ONETABLE UZ',
        amount
      }
    })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}
