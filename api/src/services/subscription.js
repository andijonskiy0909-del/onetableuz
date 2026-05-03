// ════════════════════════════════════════════════════════════════
//  src/services/subscription.js
//  Tariflar uchun biznes logika
// ════════════════════════════════════════════════════════════════

const db = require('../config/db')

// ─── Konstantalar ───────────────────────────────────────
const TRIAL_DURATION_MONTHS = 1
const GRACE_PERIOD_DAYS = 3

// ─── Plan ma'lumotlarini olish ──────────────────────────
async function getPlanInfo(plan) {
  const r = await db.query('SELECT * FROM plan_features WHERE plan=$1', [plan])
  return r.rows[0] || null
}

async function getAllPlans() {
  const r = await db.query('SELECT * FROM plan_features WHERE is_visible=TRUE ORDER BY sort_order ASC')
  return r.rows
}

// ─── Restoranning hozirgi tarifini olish ────────────────
async function getCurrentSubscription(restaurantId) {
  const r = await db.query(`
    SELECT s.*, pf.display_name, pf.features, pf.monthly_price
    FROM subscriptions s
    LEFT JOIN plan_features pf ON pf.plan = s.plan
    WHERE s.restaurant_id = $1
      AND s.status IN ('active','trial','grace_period','pending')
    ORDER BY s.created_at DESC
    LIMIT 1
  `, [restaurantId])
  return r.rows[0] || null
}

// ─── Restoranning tarif holatini tekshirish ─────────────
async function getRestaurantPlanStatus(restaurantId) {
  const r = await db.query(`
    SELECT id, current_plan, plan_status, plan_started_at, plan_expires_at,
           trial_used, grace_period_until, name
    FROM restaurants WHERE id=$1
  `, [restaurantId])
  if (!r.rows.length) return null

  const rest = r.rows[0]
  const now = new Date()
  const expiresAt = rest.plan_expires_at ? new Date(rest.plan_expires_at) : null
  const graceUntil = rest.grace_period_until ? new Date(rest.grace_period_until) : null

  // Hisob holatlar
  let isActive = false
  let inGracePeriod = false
  let isExpired = false
  let daysLeft = null

  if (expiresAt) {
    daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
  }

  if (rest.plan_status === 'active' || rest.plan_status === 'trial') {
    if (expiresAt && expiresAt > now) {
      isActive = true
    } else if (graceUntil && graceUntil > now) {
      inGracePeriod = true
    } else {
      isExpired = true
    }
  } else if (rest.plan_status === 'grace_period') {
    if (graceUntil && graceUntil > now) inGracePeriod = true
    else isExpired = true
  } else {
    isExpired = true
  }

  return {
    restaurant_id: rest.id,
    restaurant_name: rest.name,
    plan: rest.current_plan || 'trial',
    status: rest.plan_status,
    started_at: rest.plan_started_at,
    expires_at: rest.plan_expires_at,
    grace_period_until: rest.grace_period_until,
    trial_used: rest.trial_used,
    is_active: isActive,
    in_grace_period: inGracePeriod,
    is_expired: isExpired,
    days_left: daysLeft,
    days_in_grace: graceUntil ? Math.max(0, Math.ceil((graceUntil - now) / (1000 * 60 * 60 * 24))) : 0
  }
}

// ─── Yangi restoran uchun trial yaratish ────────────────
// Bu funksiya restoran ro'yxatdan o'tganda chaqiriladi
async function createTrialForRestaurant(restaurantId) {
  const startedAt = new Date()
  const expiresAt = new Date()
  expiresAt.setMonth(expiresAt.getMonth() + TRIAL_DURATION_MONTHS)

  // Avval restoranning trial_used flagini tekshiramiz
  const r = await db.query('SELECT trial_used FROM restaurants WHERE id=$1', [restaurantId])
  if (!r.rows.length) throw new Error('Restoran topilmadi')

  if (r.rows[0].trial_used) {
    return { success: false, reason: 'Trial allaqachon ishlatilgan' }
  }

  // Restoran jadvalini yangilaymiz
  await db.query(`
    UPDATE restaurants SET
      current_plan = 'trial',
      plan_status = 'trial',
      plan_started_at = $2,
      plan_expires_at = $3,
      trial_used = TRUE,
      grace_period_until = NULL
    WHERE id = $1
  `, [restaurantId, startedAt, expiresAt])

  // Subscription record qo'shamiz
  const subResult = await db.query(`
    INSERT INTO subscriptions (restaurant_id, plan, status, is_trial, started_at, expires_at, duration_months, amount)
    VALUES ($1, 'trial', 'trial', TRUE, $2, $3, $4, 0)
    RETURNING *
  `, [restaurantId, startedAt, expiresAt, TRIAL_DURATION_MONTHS])

  return { success: true, subscription: subResult.rows[0] }
}

// ─── Yangi tarif uchun to'lov so'rovi ───────────────────
// Bu foydalanuvchi tarif tanlaganda chaqiriladi
async function requestSubscription({
  restaurantId,
  plan,
  durationMonths = 1,
  provider = 'manual_card',
  paymentReference = null,
  screenshotUrl = null,
  cardLast4 = null,
  providerData = {}
}) {
  // Plan ma'lumotlarini olamiz
  const planInfo = await getPlanInfo(plan)
  if (!planInfo) throw new Error('Bunday tarif yo\'q')
  if (plan === 'trial') throw new Error('Trial tarifni qo\'lda olib bo\'lmaydi')
  if (plan === 'chain') throw new Error('Chain tarif uchun bizga murojaat qiling')

  // Narxni hisoblash (yillik bo'lsa chegirma bilan)
  let totalAmount
  if (durationMonths >= 12) {
    totalAmount = Number(planInfo.yearly_price) || (Number(planInfo.monthly_price) * 12 * 0.83)
  } else {
    totalAmount = Number(planInfo.monthly_price) * durationMonths
  }

  const client = await db.getClient ? await db.getClient() : null
  try {
    if (client) await client.query('BEGIN')
    const q = client ? client.query.bind(client) : db.query.bind(db)

    // Subscription record yaratamiz (pending holatda)
    const subRes = await q(`
      INSERT INTO subscriptions (restaurant_id, plan, status, is_trial, amount, duration_months)
      VALUES ($1, $2, 'pending', FALSE, $3, $4)
      RETURNING *
    `, [restaurantId, plan, totalAmount, durationMonths])

    const subscription = subRes.rows[0]

    // Payment record yaratamiz
    const paymentRes = await q(`
      INSERT INTO subscription_payments
        (subscription_id, restaurant_id, amount, provider, provider_data,
         payment_reference, screenshot_url, card_last4, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted')
      RETURNING *
    `, [
      subscription.id, restaurantId, totalAmount, provider,
      JSON.stringify(providerData), paymentReference, screenshotUrl, cardLast4
    ])

    if (client) await client.query('COMMIT')
    return { subscription, payment: paymentRes.rows[0] }
  } catch (e) {
    if (client) await client.query('ROLLBACK')
    throw e
  } finally {
    if (client && client.release) client.release()
  }
}

// ─── To'lovni admin tasdiqlashi ─────────────────────────
async function approvePayment(paymentId, adminId, note = null) {
  const client = await db.getClient ? await db.getClient() : null
  try {
    if (client) await client.query('BEGIN')
    const q = client ? client.query.bind(client) : db.query.bind(db)

    // Payment'ni topamiz
    const payRes = await q('SELECT * FROM subscription_payments WHERE id=$1', [paymentId])
    if (!payRes.rows.length) throw new Error('To\'lov topilmadi')
    const payment = payRes.rows[0]
    if (payment.status === 'approved') throw new Error('Bu to\'lov allaqachon tasdiqlangan')

    // Subscription'ni topamiz
    const subRes = await q('SELECT * FROM subscriptions WHERE id=$1', [payment.subscription_id])
    if (!subRes.rows.length) throw new Error('Subscription topilmadi')
    const sub = subRes.rows[0]

    // Yangi muddatlarni hisoblaymiz
    const startedAt = new Date()
    const expiresAt = new Date(startedAt)
    expiresAt.setMonth(expiresAt.getMonth() + sub.duration_months)

    // Subscription'ni active qilamiz
    await q(`
      UPDATE subscriptions SET
        status = 'active',
        started_at = $2,
        expires_at = $3,
        updated_at = NOW()
      WHERE id = $1
    `, [sub.id, startedAt, expiresAt])

    // Eski subscription'larni cancelled qilamiz
    await q(`
      UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
      WHERE restaurant_id = $1 AND id != $2 AND status IN ('active','trial','grace_period')
    `, [sub.restaurant_id, sub.id])

    // Restoran jadvalini yangilaymiz
    await q(`
      UPDATE restaurants SET
        current_plan = $2,
        plan_status = 'active',
        plan_started_at = $3,
        plan_expires_at = $4,
        grace_period_until = NULL
      WHERE id = $1
    `, [sub.restaurant_id, sub.plan, startedAt, expiresAt])

    // Payment'ni approved qilamiz
    await q(`
      UPDATE subscription_payments SET
        status = 'approved',
        approved_by = $2,
        approved_at = NOW(),
        admin_note = $3
      WHERE id = $1
    `, [paymentId, adminId, note])

    if (client) await client.query('COMMIT')
    return { success: true, subscription: sub, expires_at: expiresAt }
  } catch (e) {
    if (client) await client.query('ROLLBACK')
    throw e
  } finally {
    if (client && client.release) client.release()
  }
}

// ─── To'lovni rad etish ─────────────────────────────────
async function rejectPayment(paymentId, adminId, reason) {
  const payRes = await db.query('SELECT * FROM subscription_payments WHERE id=$1', [paymentId])
  if (!payRes.rows.length) throw new Error('To\'lov topilmadi')
  const payment = payRes.rows[0]

  await db.query(`
    UPDATE subscription_payments SET
      status = 'rejected',
      approved_by = $2,
      approved_at = NOW(),
      rejected_reason = $3
    WHERE id = $1
  `, [paymentId, adminId, reason])

  // Subscription pending holatda qoladi (qaytadan to'lab oladi)
  return { success: true }
}

// ─── Cron: muddati tugaganlarni tekshirish ──────────────
async function checkExpiringSubscriptions() {
  const now = new Date()

  // 1. Active'dan grace_period'ga o'tkazish
  const expired = await db.query(`
    SELECT id FROM restaurants
    WHERE plan_status IN ('active','trial')
      AND plan_expires_at < NOW()
      AND (grace_period_until IS NULL OR grace_period_until < NOW())
  `)

  for (const row of expired.rows) {
    const graceUntil = new Date()
    graceUntil.setDate(graceUntil.getDate() + GRACE_PERIOD_DAYS)

    await db.query(`
      UPDATE restaurants SET
        plan_status = 'grace_period',
        grace_period_until = $2
      WHERE id = $1
    `, [row.id, graceUntil])

    await db.query(`
      UPDATE subscriptions SET status = 'grace_period'
      WHERE restaurant_id = $1 AND status IN ('active','trial')
    `, [row.id])
  }

  // 2. Grace period'dan keyin expired qilish
  const fullyExpired = await db.query(`
    SELECT id FROM restaurants
    WHERE plan_status = 'grace_period'
      AND grace_period_until < NOW()
  `)

  for (const row of fullyExpired.rows) {
    await db.query(`
      UPDATE restaurants SET
        plan_status = 'expired'
      WHERE id = $1
    `, [row.id])

    await db.query(`
      UPDATE subscriptions SET status = 'expired'
      WHERE restaurant_id = $1 AND status = 'grace_period'
    `, [row.id])
  }

  return {
    moved_to_grace: expired.rows.length,
    fully_expired: fullyExpired.rows.length
  }
}

// ─── Feature mavjudligini tekshirish ────────────────────
// Bu plan_guard middleware ishlatadi
async function hasFeature(restaurantId, featureName) {
  const status = await getRestaurantPlanStatus(restaurantId)
  if (!status) return false
  if (status.is_expired) return false  // muddati o'tgan
  if (!status.is_active && !status.in_grace_period) return false

  const planInfo = await getPlanInfo(status.plan)
  if (!planInfo) return false

  const features = typeof planInfo.features === 'string'
    ? JSON.parse(planInfo.features)
    : planInfo.features

  return features?.[featureName] === true || features?.[featureName] === 'top' || features?.[featureName] === 'premium'
}

// ─── Limit tekshirish ───────────────────────────────────
async function checkLimit(restaurantId, limitType, currentCount) {
  const status = await getRestaurantPlanStatus(restaurantId)
  if (!status) return { allowed: false, reason: 'Tarif topilmadi' }
  if (status.is_expired) return { allowed: false, reason: 'Tarif muddati tugagan' }

  const planInfo = await getPlanInfo(status.plan)
  if (!planInfo) return { allowed: false, reason: 'Tarif noto\'g\'ri' }

  const features = typeof planInfo.features === 'string'
    ? JSON.parse(planInfo.features)
    : planInfo.features

  const limit = features?.[`max_${limitType}`]
  if (limit === undefined || limit === null) return { allowed: true }
  if (limit === -1) return { allowed: true }  // cheksiz

  const allowed = currentCount < limit
  return {
    allowed,
    limit,
    current: currentCount,
    reason: allowed ? null : `${limitType} chegarasi: ${limit} ta (joriy: ${currentCount})`
  }
}

module.exports = {
  TRIAL_DURATION_MONTHS,
  GRACE_PERIOD_DAYS,
  getPlanInfo,
  getAllPlans,
  getCurrentSubscription,
  getRestaurantPlanStatus,
  createTrialForRestaurant,
  requestSubscription,
  approvePayment,
  rejectPayment,
  checkExpiringSubscriptions,
  hasFeature,
  checkLimit
}
