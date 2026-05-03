// ════════════════════════════════════════════════════════════════
//  src/routes/admin-subscriptions.js
//  Admin (OneTable boshqaruvchi) uchun to'lovlarni tasdiqlash API
// ════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()
const subscription = require('../services/subscription')
const db = require('../config/db')

// ⚠️ MUHIM: bu route'lar authAdmin middleware bilan himoyalangan bo'lishi kerak
// (routes/index.js'da admin auth qo'shiladi)

// ─── GET /api/admin/subscription-payments ─────────────────
// Barcha to'lovlar ro'yxati (admin uchun)
router.get('/admin/subscription-payments', async (req, res) => {
  try {
    const status = req.query.status || 'all'
    let where = ''
    const params = []

    if (status === 'pending') {
      where = `WHERE sp.status IN ('submitted','pending')`
    } else if (status !== 'all') {
      where = `WHERE sp.status=$1`
      params.push(status)
    }

    const r = await db.query(`
      SELECT
        sp.*,
        s.plan,
        s.duration_months,
        s.status as sub_status,
        r.name as restaurant_name,
        r.phone as restaurant_phone,
        o.full_name as owner_name,
        o.email as owner_email,
        pf.display_name as plan_display
      FROM subscription_payments sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      JOIN restaurants r ON r.id = sp.restaurant_id
      LEFT JOIN owners o ON o.id = r.owner_id
      LEFT JOIN plan_features pf ON pf.plan = s.plan
      ${where}
      ORDER BY sp.created_at DESC
      LIMIT 200
    `, params)

    // Statistika
    const stats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('submitted','pending'))::int as pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int as approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected,
        COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) as total_revenue
      FROM subscription_payments
    `)

    res.json({
      payments: r.rows,
      stats: stats.rows[0]
    })
  } catch (e) {
    console.error('GET /admin/subscription-payments:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/admin/subscription-payments/:id/approve ────
// To'lovni tasdiqlash
router.post('/admin/subscription-payments/:id/approve', async (req, res) => {
  try {
    const paymentId = Number(req.params.id)
    const adminId = req.user?.id || req.admin?.id || null
    const note = req.body?.note || null

    const result = await subscription.approvePayment(paymentId, adminId, note)

    // Restoran egasiga real-time xabar
    const io = req.app.get('io')
    if (io) {
      const payRes = await db.query('SELECT restaurant_id FROM subscription_payments WHERE id=$1', [paymentId])
      if (payRes.rows.length) {
        const rid = payRes.rows[0].restaurant_id
        io.to(`restaurant_${rid}`).emit('subscription_approved', {
          payment_id: paymentId,
          expires_at: result.expires_at
        })
      }
    }

    res.json({ success: true, message: 'Tarif faollashtirildi', ...result })
  } catch (e) {
    console.error('approve payment:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/admin/subscription-payments/:id/reject ─────
router.post('/admin/subscription-payments/:id/reject', async (req, res) => {
  try {
    const paymentId = Number(req.params.id)
    const adminId = req.user?.id || req.admin?.id || null
    const reason = req.body?.reason || 'Sabab ko\'rsatilmagan'

    await subscription.rejectPayment(paymentId, adminId, reason)

    // Restoran egasiga xabar
    const io = req.app.get('io')
    if (io) {
      const payRes = await db.query('SELECT restaurant_id FROM subscription_payments WHERE id=$1', [paymentId])
      if (payRes.rows.length) {
        io.to(`restaurant_${payRes.rows[0].restaurant_id}`).emit('subscription_rejected', {
          payment_id: paymentId,
          reason
        })
      }
    }

    res.json({ success: true, message: 'To\'lov rad etildi' })
  } catch (e) {
    console.error('reject payment:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/admin/subscription-payments/:id ─────────────
// Bitta to'lov haqida batafsil
router.get('/admin/subscription-payments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const r = await db.query(`
      SELECT
        sp.*,
        s.plan, s.duration_months, s.status as sub_status,
        r.name as restaurant_name, r.phone as restaurant_phone,
        o.full_name as owner_name, o.email as owner_email
      FROM subscription_payments sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      JOIN restaurants r ON r.id = sp.restaurant_id
      LEFT JOIN owners o ON o.id = r.owner_id
      WHERE sp.id = $1
    `, [id])

    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' })
    res.json(r.rows[0])
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /api/admin/subscriptions/overview ────────────────
// Umumiy statistika
router.get('/admin/subscriptions/overview', async (req, res) => {
  try {
    const planDistribution = await db.query(`
      SELECT current_plan, plan_status, COUNT(*)::int as count
      FROM restaurants
      GROUP BY current_plan, plan_status
    `)

    const expiringSoon = await db.query(`
      SELECT id, name, current_plan, plan_expires_at,
        CEIL(EXTRACT(EPOCH FROM (plan_expires_at - NOW())) / 86400)::int as days_left
      FROM restaurants
      WHERE plan_status IN ('active','trial')
        AND plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ORDER BY plan_expires_at ASC
    `)

    const recentRevenue = await db.query(`
      SELECT
        DATE_TRUNC('day', approved_at)::date as date,
        COALESCE(SUM(amount), 0) as amount,
        COUNT(*)::int as count
      FROM subscription_payments
      WHERE status='approved' AND approved_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', approved_at)
      ORDER BY date DESC
    `)

    res.json({
      plan_distribution: planDistribution.rows,
      expiring_soon: expiringSoon.rows,
      recent_revenue: recentRevenue.rows
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── POST /api/admin/restaurants/:id/extend ───────────────
// Restoran tarifini admin qo'lda uzaytirish (bonus uchun)
router.post('/admin/restaurants/:id/extend', async (req, res) => {
  try {
    const restaurantId = Number(req.params.id)
    const { plan, days = 30, reason = 'Admin tomonidan' } = req.body

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + Number(days))

    await db.query(`
      UPDATE restaurants SET
        current_plan = $2,
        plan_status = 'active',
        plan_expires_at = $3,
        grace_period_until = NULL
      WHERE id = $1
    `, [restaurantId, plan || 'business', expiresAt])

    await db.query(`
      INSERT INTO subscriptions (restaurant_id, plan, status, started_at, expires_at, duration_months, amount, notes)
      VALUES ($1, $2, 'active', NOW(), $3, $4, 0, $5)
    `, [restaurantId, plan || 'business', expiresAt, Math.ceil(days / 30), `Admin extend: ${reason}`])

    res.json({ success: true, expires_at: expiresAt })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
