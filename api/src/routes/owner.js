/**
 * OneTable — Owner Routes (MVP Complete)
 */
const router = require('express').Router()
const pool = require('../db')
const bcrypt = require('bcryptjs')
const { ownerAuth, createToken } = require('../middleware/auth')

// ── Inline validators ─────────────────────────────────────────
const validateOwnerRegister = (req, res, next) => {
  const { email, password, full_name } = req.body
  if (!email || !password || !full_name)
    return res.status(400).json({ error: "email, password, full_name majburiy" })
  if (password.length < 6)
    return res.status(400).json({ error: "Parol kamida 6 ta belgi" })
  next()
}

const validateRestaurantInput = (req, res, next) => {
  const { name, address } = req.body
  if (!name || !address)
    return res.status(400).json({ error: "name va address majburiy" })
  next()
}

const validateMenuItemInput = (req, res, next) => {
  const { name, price } = req.body
  if (!name || !price)
    return res.status(400).json({ error: "name va price majburiy" })
  next()
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

router.post('/register', validateOwnerRegister, async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body
    const existing = await pool.query(
      'SELECT id FROM restaurant_owners WHERE email = $1', [email]
    )
    if (existing.rows.length)
      return res.status(400).json({ error: "Bu email allaqachon ro'yxatdan o'tgan" })
    const hash = await bcrypt.hash(password, 12)
    const result = await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, phone, role)
       VALUES ($1,$2,$3,$4,'owner')
       RETURNING id, email, full_name, phone, role, restaurant_id`,
      [email.toLowerCase(), hash, full_name, phone]
    )
    const owner = result.rows[0]
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id })
    res.status(201).json({ token, owner })
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' })
    const result = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email = $1', [email.toLowerCase()]
    )
    const owner = result.rows[0]
    if (!owner) return res.status(401).json({ error: "Email yoki parol noto'g'ri" })
    const valid = await bcrypt.compare(password, owner.password_hash)
    if (!valid) return res.status(401).json({ error: "Email yoki parol noto'g'ri" })
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id })
    const { password_hash, ...safeOwner } = owner
    res.json({ token, owner: safeOwner })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// RESTAURANT
// ══════════════════════════════════════════════════════════════

router.get('/restaurant', ownerAuth, async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null)
    const result = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1', [req.owner.restaurant_id]
    )
    res.json(result.rows[0] || null)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.post('/restaurants', ownerAuth, validateRestaurantInput, async (req, res) => {
  try {
    const {
      name, description, address, phone, cuisine,
      price_category, capacity, image_url, working_hours,
      deposit_enabled, deposit_amount, deposit_notes
    } = req.body
    const result = await pool.query(
      `INSERT INTO restaurants
        (name, description, address, phone, cuisine, price_category, capacity,
         image_url, working_hours, status, is_active, is_demo, onboarding_completed,
         deposit_enabled, deposit_amount, deposit_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',true,false,false,$10,$11,$12)
       RETURNING *`,
      [name, description, address, phone, cuisine, price_category,
       capacity || 50, image_url, working_hours || '10:00 — 22:00',
       deposit_enabled || false, deposit_amount || 0, deposit_notes || null]
    )
    const restaurant = result.rows[0]
    await pool.query(
      'UPDATE restaurant_owners SET restaurant_id = $1 WHERE id = $2',
      [restaurant.id, req.owner.id]
    )
    res.status(201).json(restaurant)
  } catch(err) {
    console.error(err)
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/restaurant', ownerAuth, validateRestaurantInput, async (req, res) => {
  try {
    const {
      name, description, address, phone, cuisine,
      price_category, capacity, image_url, working_hours,
      deposit_enabled, deposit_amount, deposit_notes
    } = req.body
    const result = await pool.query(
      `UPDATE restaurants
       SET name=$1, description=$2, address=$3, phone=$4, cuisine=$5,
           price_category=$6, capacity=$7, image_url=$8, working_hours=$9,
           deposit_enabled=$10, deposit_amount=$11, deposit_notes=$12,
           onboarding_completed=true
       WHERE id=$13 RETURNING *`,
      [name, description, address, phone, cuisine, price_category,
       capacity, image_url, working_hours,
       deposit_enabled || false, deposit_amount || 0, deposit_notes || null,
       req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Restoran topilmadi' })
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/restaurant/location', ownerAuth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude))
      return res.status(400).json({ error: "Koordinatalar noto'g'ri" })
    await pool.query(
      'UPDATE restaurants SET latitude=$1, longitude=$2 WHERE id=$3',
      [latitude, longitude, req.owner.restaurant_id]
    )
    res.json({ success: true })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// RESERVATIONS
// ══════════════════════════════════════════════════════════════

router.get('/reservations', ownerAuth, async (req, res) => {
  try {
    const { date, status, page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit
    let query = `
      SELECT r.*, u.first_name, u.last_name, u.phone,
             z.name AS zone_name, t.table_number
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN zones z ON r.zone_id = z.id
      LEFT JOIN tables t ON r.table_id = t.id
      WHERE r.restaurant_id = $1
    `
    const params = [req.owner.restaurant_id]
    if (date) { params.push(date); query += ` AND r.date = $${params.length}` }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}` }
    query += ` ORDER BY r.date DESC, r.time DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`
    params.push(limit, offset)
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['confirmed', 'cancelled', 'completed']
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: "Noto'g'ri status" })
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: "ID noto'g'ri" })
    const result = await pool.query(
      `UPDATE reservations SET status=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [status, id, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Bron topilmadi' })
    const r = result.rows[0]
    const userRes = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [r.user_id])
    const telegramId = userRes.rows[0]?.telegram_id
    if (telegramId) {
      const dateStr = String(r.date).split('T')[0]
      const timeStr = String(r.time).slice(0, 5)
      const text = status === 'confirmed'
        ? `✅ <b>Broningiz tasdiqlandi!</b>\n📅 ${dateStr} — ⏰ ${timeStr}\n👥 ${r.guests} kishi`
        : status === 'completed'
        ? `🎉 <b>Tashrifingiz uchun rahmat!</b>`
        : `❌ <b>Broningiz rad etildi.</b>\n📅 ${dateStr} — ⏰ ${timeStr}`
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
      }).catch(() => {})
    }
    const io = req.app.get('io')
    if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', { id, status })
    res.json(result.rows[0])
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════

router.get('/analytics', ownerAuth, async (req, res) => {
  try {
    const rid = req.owner.restaurant_id
    if (!rid) return res.json({ today: 0, weekly: 0, monthly: 0, revenue: 0, peakHours: [], dailyStats: [] })
    const [today, weekly, monthly, revenue, peakHours, dailyStats] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COUNT(*) FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'30 days' AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE restaurant_id=$1 AND status='paid'`, [rid]),
      pool.query(`SELECT time, COUNT(*) as count FROM reservations WHERE restaurant_id=$1 AND status!='cancelled' GROUP BY time ORDER BY count DESC LIMIT 6`, [rid]),
      pool.query(`SELECT date::text, COUNT(*) as count FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' GROUP BY date ORDER BY date ASC`, [rid])
    ])
    res.json({
      today: parseInt(today.rows[0].count),
      weekly: parseInt(weekly.rows[0].count),
      monthly: parseInt(monthly.rows[0].count),
      revenue: parseInt(revenue.rows[0].total),
      peakHours: peakHours.rows,
      dailyStats: dailyStats.rows
    })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// ══════════════════════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════════════════════

router.get('/menu', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE restaurant_id=$1 ORDER BY category, name',
      [req.owner.restaurant_id]
    )
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/menu', ownerAuth, validateMenuItemInput, async (req, res) => {
  try {
    const { name, category, price, description, image_url } = req.body
    const result = await pool.query(
      `INSERT INTO menu_items (restaurant_id, name, category, price, description, image_url, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
      [req.owner.restaurant_id, name, category, price, description, image_url]
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const { name, description, price, is_available, image_url } = req.body
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: "ID noto'g'ri" })
    const result = await pool.query(
      `UPDATE menu_items SET name=$1, description=$2, price=$3, is_available=$4, image_url=$5
       WHERE id=$6 AND restaurant_id=$7 RETURNING *`,
      [name, description, price, is_available, image_url, id, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Taom topilmadi' })
    res.json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: "ID noto'g'ri" })
    await pool.query('DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2', [id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// ZONES
// ══════════════════════════════════════════════════════════════

router.get('/zones', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM zones WHERE restaurant_id=$1 ORDER BY created_at',
      [req.owner.restaurant_id]
    )
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/zones', ownerAuth, async (req, res) => {
  try {
    const { name, description, capacity, icon } = req.body
    if (!name) return res.status(400).json({ error: 'Zona nomi kerak' })
    const result = await pool.query(
      `INSERT INTO zones (restaurant_id, name, description, capacity, icon, is_available)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [req.owner.restaurant_id, name, description, capacity || 10, icon || '🪑']
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/zones/:id', ownerAuth, async (req, res) => {
  try {
    const { is_available, name, description, capacity, icon } = req.body
    const result = await pool.query(
      `UPDATE zones SET is_available=$1, name=COALESCE($2,name),
       description=COALESCE($3,description), capacity=COALESCE($4,capacity), icon=COALESCE($5,icon)
       WHERE id=$6 AND restaurant_id=$7 RETURNING *`,
      [is_available, name, description, capacity, icon, req.params.id, req.owner.restaurant_id]
    )
    res.json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/zones/:id', ownerAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM zones WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// TABLES
// ══════════════════════════════════════════════════════════════

router.get('/tables', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, z.name as zone_name FROM tables t
       LEFT JOIN zones z ON t.zone_id = z.id
       WHERE t.restaurant_id=$1 ORDER BY t.table_number`,
      [req.owner.restaurant_id]
    )
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/tables', ownerAuth, async (req, res) => {
  try {
    const { table_number, zone_id, capacity } = req.body
    if (!table_number) return res.status(400).json({ error: 'Stol raqami kerak' })
    const result = await pool.query(
      `INSERT INTO tables (restaurant_id, table_number, zone_id, capacity, is_available)
       VALUES ($1,$2,$3,$4,true) RETURNING *`,
      [req.owner.restaurant_id, table_number, zone_id || null, capacity || 4]
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/tables/:id', ownerAuth, async (req, res) => {
  try {
    const { is_available } = req.body
    const result = await pool.query(
      `UPDATE tables SET is_available=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [is_available, req.params.id, req.owner.restaurant_id]
    )
    res.json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/tables/:id', ownerAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM tables WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// MEDIA (Reels/Videos/Images)
// ══════════════════════════════════════════════════════════════

router.get('/media', ownerAuth, async (req, res) => {
  try {
    const { type } = req.query
    let query = 'SELECT * FROM restaurant_media WHERE restaurant_id=$1'
    const params = [req.owner.restaurant_id]
    if (type) { params.push(type); query += ` AND type=$${params.length}` }
    query += ' ORDER BY sort_order ASC, created_at DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.post('/media', ownerAuth, async (req, res) => {
  try {
    const { type, url, thumbnail_url, caption, sort_order, duration_seconds } = req.body
    if (!type || !url) return res.status(400).json({ error: 'type va url kerak' })
    if (!['video', 'image', 'reel'].includes(type))
      return res.status(400).json({ error: 'type: video, image, reel' })
    const result = await pool.query(
      `INSERT INTO restaurant_media
        (restaurant_id, type, url, thumbnail_url, caption, sort_order, duration_seconds, uploaded_by, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
      [req.owner.restaurant_id, type, url, thumbnail_url, caption,
       sort_order || 0, duration_seconds, req.owner.id]
    )
    res.status(201).json(result.rows[0])
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.delete('/media/:id', ownerAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM restaurant_media WHERE id=$1 AND restaurant_id=$2',
      [req.params.id, req.owner.restaurant_id]
    )
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// PREMIUM / SUBSCRIPTION
// ══════════════════════════════════════════════════════════════

router.get('/premium', ownerAuth, async (req, res) => {
  try {
    const [sub, resto] = await Promise.all([
      pool.query(
        `SELECT * FROM premium_subscriptions WHERE restaurant_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [req.owner.restaurant_id]
      ),
      pool.query('SELECT is_premium FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
    ])
    res.json({
      subscription: sub.rows[0] || null,
      is_premium: resto.rows[0]?.is_premium || false
    })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// Subscription so'rash (to'lov uchun)
router.post('/premium/request', ownerAuth, async (req, res) => {
  try {
    const { plan, payment_method } = req.body
    if (!['monthly', 'yearly'].includes(plan))
      return res.status(400).json({ error: 'Plan: monthly yoki yearly' })

    const amount = plan === 'yearly' ? 1200000 : 150000
    const expires_at = new Date()
    expires_at.setMonth(expires_at.getMonth() + (plan === 'yearly' ? 12 : 1))

    // Oldingi kutilayotgan so'rovni bekor qil
    await pool.query(
      `UPDATE premium_subscriptions SET status='cancelled'
       WHERE restaurant_id=$1 AND status IN ('pending_payment','waiting_verification')`,
      [req.owner.restaurant_id]
    )

    const result = await pool.query(
      `INSERT INTO premium_subscriptions
        (restaurant_id, plan, amount, status, expires_at, payment_method)
       VALUES ($1,$2,$3,'pending_payment',$4,$5) RETURNING *`,
      [req.owner.restaurant_id, plan, amount, expires_at, payment_method || 'manual']
    )

    // Admin ga xabar
    await pool.query(
      `INSERT INTO admin_notifications (type, restaurant_id, subscription_id, message)
       VALUES ('subscription_payment', $1, $2, $3)`,
      [req.owner.restaurant_id, result.rows[0].id,
       `Yangi subscription so'rov: ${plan}, ${amount.toLocaleString()} so'm`]
    )

    res.status(201).json({
      subscription: result.rows[0],
      payment_instructions: {
        card_number: process.env.ADMIN_CARD_NUMBER || '8600 **** **** ****',
        card_holder: process.env.ADMIN_CARD_HOLDER || 'OneTable Admin',
        amount,
        plan,
        note: `To'lov izohida subscription ID: ${result.rows[0].id} ni yozing`
      }
    })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// To'lov isboti yuklash
router.put('/premium/:id/proof', ownerAuth, async (req, res) => {
  try {
    const { proof_url } = req.body
    if (!proof_url) return res.status(400).json({ error: 'proof_url kerak' })
    const result = await pool.query(
      `UPDATE premium_subscriptions
       SET payment_proof_url=$1, status='waiting_verification', payment_date=NOW()
       WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [proof_url, req.params.id, req.owner.restaurant_id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Topilmadi' })

    // Admin ga xabar
    await pool.query(
      `UPDATE admin_notifications SET is_read=false WHERE subscription_id=$1`,
      [req.params.id]
    )

    res.json({ success: true, subscription: result.rows[0] })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

// Admin: Subscription tasdiqlash
router.post('/premium/:id/verify', ownerAuth, async (req, res) => {
  try {
    // Faqat admin
    if (req.owner.role !== 'admin')
      return res.status(403).json({ error: 'Faqat admin' })

    const { action, rejection_reason } = req.body
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: 'action: approve yoki reject' })

    const sub = await pool.query('SELECT * FROM premium_subscriptions WHERE id=$1', [req.params.id])
    if (!sub.rows.length) return res.status(404).json({ error: 'Topilmadi' })

    if (action === 'approve') {
      await pool.query(
        `UPDATE premium_subscriptions
         SET status='active', verified_by=$1, verified_at=NOW()
         WHERE id=$2`,
        [req.owner.id, req.params.id]
      )
      await pool.query(
        'UPDATE restaurants SET is_premium=true WHERE id=$1',
        [sub.rows[0].restaurant_id]
      )
      // Owner ga Telegram xabar
      const ownerRes = await pool.query(
        `SELECT ro.telegram_id FROM restaurant_owners ro
         WHERE ro.restaurant_id=$1`, [sub.rows[0].restaurant_id]
      )
      if (ownerRes.rows[0]?.telegram_id) {
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: ownerRes.rows[0].telegram_id,
            text: `💎 <b>Premium faollashtirildi!</b>\n\nRestoran premium ro'yxatga kiritildi. Muddati: ${sub.rows[0].expires_at?.toISOString().split('T')[0]}`,
            parse_mode: 'HTML'
          })
        }).catch(() => {})
      }
    } else {
      await pool.query(
        `UPDATE premium_subscriptions
         SET status='rejected', verified_by=$1, verified_at=NOW(), rejection_reason=$2
         WHERE id=$3`,
        [req.owner.id, rejection_reason, req.params.id]
      )
    }

    res.json({ success: true, action })
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

router.delete('/premium', ownerAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE premium_subscriptions SET status='cancelled' WHERE restaurant_id=$1 AND status='active'`,
      [req.owner.restaurant_id]
    )
    await pool.query('UPDATE restaurants SET is_premium=false WHERE id=$1', [req.owner.restaurant_id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// PAYMENTS (Owner ko'rishi uchun)
// ══════════════════════════════════════════════════════════════

router.get('/payments', ownerAuth, async (req, res) => {
  try {
    const { status, type, from, to, page = 1, limit = 30 } = req.query
    const offset = (page - 1) * limit
    let query = `
      SELECT p.*, r.date as res_date, r.time as res_time, r.guests,
             u.first_name, u.last_name
      FROM payments p
      LEFT JOIN reservations r ON p.reservation_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE p.restaurant_id = $1
    `
    const params = [req.owner.restaurant_id]
    if (status) { params.push(status); query += ` AND p.status=$${params.length}` }
    if (type) { params.push(type); query += ` AND p.type=$${params.length}` }
    if (from) { params.push(from); query += ` AND p.created_at>=$${params.length}` }
    if (to) { params.push(to); query += ` AND p.created_at<=$${params.length}` }
    query += ` ORDER BY p.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`
    params.push(limit, offset)
    const result = await pool.query(query, params)
    const total = await pool.query(
      'SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE restaurant_id=$1 AND status=$2',
      [req.owner.restaurant_id, 'paid']
    )
    res.json({ payments: result.rows, total_paid: parseInt(total.rows[0].total) })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════

router.get('/chat/owner/messages', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, u.first_name, r.date, r.time
      FROM chat_messages m
      JOIN reservations r ON m.reservation_id = r.id
      JOIN users u ON r.user_id = u.id
      WHERE r.restaurant_id = $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `, [req.owner.restaurant_id])
    const unread_count = result.rows.filter(m => m.sender_type === 'user' && !m.is_read).length
    res.json({ messages: result.rows, unread_count })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

// ══════════════════════════════════════════════════════════════
// ADMIN NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

router.get('/admin/notifications', ownerAuth, async (req, res) => {
  try {
    if (req.owner.role !== 'admin')
      return res.status(403).json({ error: 'Faqat admin' })
    const result = await pool.query(`
      SELECT n.*, res.name as restaurant_name,
             ps.plan, ps.amount, ps.status as sub_status,
             ps.payment_proof_url
      FROM admin_notifications n
      LEFT JOIN restaurants res ON n.restaurant_id = res.id
      LEFT JOIN premium_subscriptions ps ON n.subscription_id = ps.id
      ORDER BY n.created_at DESC LIMIT 50
    `)
    res.json(result.rows)
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

router.put('/admin/notifications/:id/read', ownerAuth, async (req, res) => {
  try {
    if (req.owner.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' })
    await pool.query('UPDATE admin_notifications SET is_read=true WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch(err) { res.status(500).json({ error: 'Server xatoligi' }) }
})

module.exports = router
