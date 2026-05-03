// ════════════════════════════════════════════════════════════════
//  src/routes/subscriptions.js
//  Restoran egasi uchun tarif API'si
// ════════════════════════════════════════════════════════════════

const express = require('express')
const router = express.Router()
const subscription = require('../services/subscription')
const db = require('../config/db')

// ⚠️ MUHIM: bu route'lar authMiddleware bilan himoyalangan
// (routes/index.js'da authOwner qo'shiladi)

// ─── GET /api/owner/subscription ──────────────────────────
// Hozirgi tarifni va holatni qaytaradi
router.get('/owner/subscription', async (req, res) => {
  try {
    const restaurantId = req.owner?.restaurant_id
    if (!restaurantId) return res.status(403).json({ error: 'Restoran topilmadi' })

    const [status, current, plans] = await Promise.all([
      subscription.getRestaurantPlanStatus(restaurantId),
      subscription.getCurrentSubscription(restaurantId),
      subscription.getAllPlans()
    ])

    // Pending payment'lar (admin tasdiqlashini kutmoqda)
    const pendingPayments = await db.query(`
      SELECT sp.*, s.plan, s.duration_months
      FROM subscription_payments sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      WHERE sp.restaurant_id = $1 AND sp.status IN ('submitted','pending')
      ORDER BY sp.created_at DESC
    `, [restaurantId])

    // Tarix
    const history = await db.query(`
      SELECT s.*, pf.display_name
      FROM subscriptions s
      LEFT JOIN plan_features pf ON pf.plan = s.plan
      WHERE s.restaurant_id = $1
      ORDER BY s.created_at DESC
      LIMIT 20
    `, [restaurantId])

    res.json({
      status,
      current,
      plans,
      pending_payments: pendingPayments.rows,
      history: history.rows
    })
  } catch (e) {
    console.error('GET /owner/subscription:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/owner/subscription/request ─────────────────
// Yangi tarif so'rash (to'lov yuborish)
router.post('/owner/subscription/request', async (req, res) => {
  try {
    const restaurantId = req.owner?.restaurant_id
    if (!restaurantId) return res.status(403).json({ error: 'Restoran topilmadi' })

    const {
      plan,
      duration_months = 1,
      provider = 'manual_card',
      payment_reference = null,
      screenshot_url = null,
      card_last4 = null,
      provider_data = {}
    } = req.body

    if (!plan) return res.status(400).json({ error: 'Tarif tanlanmagan' })
    if (!['basic', 'business', 'elite'].includes(plan)) {
      return res.status(400).json({ error: 'Noto\'g\'ri tarif. Chain uchun bizga murojaat qiling.' })
    }

    // Manual to'lov uchun screenshot kerak
    if (provider === 'manual_card' && !screenshot_url) {
      return res.status(400).json({ error: 'To\'lov screenshoti yuklanmagan' })
    }

    const result = await subscription.requestSubscription({
      restaurantId,
      plan,
      durationMonths: Number(duration_months) || 1,
      provider,
      paymentReference: payment_reference,
      screenshotUrl: screenshot_url,
      cardLast4: card_last4,
      providerData: provider_data
    })

    // Real-time admin uchun xabar
    const io = req.app.get('io')
    if (io) {
      io.to('admins').emit('new_subscription_payment', {
        payment: result.payment,
        subscription: result.subscription,
        restaurant_id: restaurantId
      })
    }

    res.json({
      success: true,
      message: 'To\'lov yuborildi. Admin tasdiqlashini kuting (1-24 soat).',
      ...result
    })
  } catch (e) {
    console.error('POST /owner/subscription/request:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/owner/subscription/plans ────────────────────
// Barcha tariflar ro'yxati (public)
router.get('/owner/subscription/plans', async (req, res) => {
  try {
    const plans = await subscription.getAllPlans()
    res.json(plans)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /api/owner/subscription/payment-info ─────────────
// Karta raqami va to'lov ma'lumotlarini qaytaradi
router.get('/owner/subscription/payment-info', async (req, res) => {
  try {
    res.json({
      providers: [
        {
          id: 'manual_card',
          name: 'Karta o\'tkazma',
          enabled: true,
          card_number: process.env.SUBSCRIPTION_CARD_NUMBER || '8600 1234 5678 9012',
          card_holder: process.env.SUBSCRIPTION_CARD_HOLDER || 'OneTable LLC',
          bank_name: process.env.SUBSCRIPTION_BANK_NAME || 'Asakabank',
          instructions: 'To\'lov izohida restoraningiz nomini va tariffni ko\'rsating. Screenshot yuklang.'
        },
        {
          id: 'click',
          name: 'Click',
          enabled: false,  // kelajakda ishga tushadi
          coming_soon: true
        },
        {
          id: 'payme',
          name: 'Payme',
          enabled: false,
          coming_soon: true
        },
        {
          id: 'uzum',
          name: 'Uzum Bank',
          enabled: false,
          coming_soon: true
        }
      ]
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── POST /api/owner/subscription/cancel ──────────────────
// Pending to'lovni bekor qilish (foydalanuvchi)
router.post('/owner/subscription/cancel-payment/:paymentId', async (req, res) => {
  try {
    const restaurantId = req.owner?.restaurant_id
    const paymentId = Number(req.params.paymentId)

    const r = await db.query(`
      SELECT * FROM subscription_payments
      WHERE id=$1 AND restaurant_id=$2 AND status IN ('submitted','pending')
    `, [paymentId, restaurantId])
    if (!r.rows.length) return res.status(404).json({ error: 'To\'lov topilmadi' })

    await db.query(`
      UPDATE subscription_payments SET status='cancelled' WHERE id=$1
    `, [paymentId])

    // Bog'liq subscription'ni cancelled qilamiz
    const payment = r.rows[0]
    await db.query(`
      UPDATE subscriptions SET status='cancelled', cancelled_at=NOW()
      WHERE id=$1 AND status='pending'
    `, [payment.subscription_id])

    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
