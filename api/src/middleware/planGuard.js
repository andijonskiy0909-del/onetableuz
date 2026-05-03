// ════════════════════════════════════════════════════════════════
//  src/middleware/planGuard.js
//  Tarif chegaralarini tekshiruvchi middleware
// ════════════════════════════════════════════════════════════════

const subscription = require('../services/subscription')

// ─── Feature talab qilish ───────────────────────────────
// Misol: app.post('/api/owner/reels', requireFeature('reels'), handler)
function requireFeature(featureName) {
  return async (req, res, next) => {
    try {
      const restaurantId = req.owner?.restaurant_id || req.user?.restaurant_id
      if (!restaurantId) {
        return res.status(403).json({ error: 'Restoran topilmadi' })
      }

      const has = await subscription.hasFeature(restaurantId, featureName)
      if (!has) {
        return res.status(402).json({
          error: 'PLAN_UPGRADE_REQUIRED',
          message: `Bu funksiya sizning tarifda mavjud emas: ${featureName}`,
          feature: featureName,
          upgrade_required: true
        })
      }
      next()
    } catch (e) {
      console.error('requireFeature error:', e)
      res.status(500).json({ error: e.message })
    }
  }
}

// ─── Limit tekshirish ───────────────────────────────────
// Misol: app.post('/api/owner/tables', checkLimit('tables', getCount), handler)
// getCurrentCount — async function(req) { return number }
function checkLimit(limitType, getCurrentCount) {
  return async (req, res, next) => {
    try {
      const restaurantId = req.owner?.restaurant_id || req.user?.restaurant_id
      if (!restaurantId) {
        return res.status(403).json({ error: 'Restoran topilmadi' })
      }

      const currentCount = typeof getCurrentCount === 'function'
        ? await getCurrentCount(req)
        : getCurrentCount

      const result = await subscription.checkLimit(restaurantId, limitType, currentCount)
      if (!result.allowed) {
        return res.status(402).json({
          error: 'PLAN_LIMIT_REACHED',
          message: result.reason,
          limit_type: limitType,
          limit: result.limit,
          current: result.current,
          upgrade_required: true
        })
      }
      next()
    } catch (e) {
      console.error('checkLimit error:', e)
      res.status(500).json({ error: e.message })
    }
  }
}

// ─── Faol tarifni talab qilish ──────────────────────────
// Bu eng asosiy himoya — agar tarif tugagan bo'lsa, faqat read-only bo'ladi
function requireActivePlan(options = {}) {
  const { allowGracePeriod = true, allowTrial = true } = options

  return async (req, res, next) => {
    try {
      const restaurantId = req.owner?.restaurant_id || req.user?.restaurant_id
      if (!restaurantId) {
        return res.status(403).json({ error: 'Restoran topilmadi' })
      }

      const status = await subscription.getRestaurantPlanStatus(restaurantId)
      if (!status) {
        return res.status(403).json({ error: 'Tarif topilmadi' })
      }

      // Trial holati
      if (status.status === 'trial' && status.is_active) {
        if (!allowTrial) {
          return res.status(402).json({
            error: 'TRIAL_NOT_ALLOWED',
            message: 'Trial davrida bu funksiya mavjud emas',
            upgrade_required: true
          })
        }
        return next()
      }

      // Faol holat
      if (status.is_active) return next()

      // Grace period
      if (status.in_grace_period && allowGracePeriod) {
        // Frontend uchun ogohlantirish header qo'shamiz
        res.set('X-Plan-Grace-Period', String(status.days_in_grace))
        return next()
      }

      // Muddati tugagan
      return res.status(402).json({
        error: 'PLAN_EXPIRED',
        message: 'Tarif muddati tugagan, iltimos yangilang',
        plan: status.plan,
        expired_at: status.expires_at,
        upgrade_required: true
      })
    } catch (e) {
      console.error('requireActivePlan error:', e)
      res.status(500).json({ error: e.message })
    }
  }
}

// ─── Faqat read-only — har qanday tarifda ishlatish mumkin ──
// Tarif tugagan bo'lsa ham ko'rish mumkin
function allowReadOnly() {
  return (req, res, next) => next()
}

// ─── Helper: response'ga tarif ma'lumotini qo'shish ─────
async function attachPlanStatus(req, res, next) {
  try {
    const restaurantId = req.owner?.restaurant_id || req.user?.restaurant_id
    if (restaurantId) {
      req.planStatus = await subscription.getRestaurantPlanStatus(restaurantId)
    }
  } catch (e) {
    console.error('attachPlanStatus:', e.message)
  }
  next()
}

module.exports = {
  requireFeature,
  checkLimit,
  requireActivePlan,
  allowReadOnly,
  attachPlanStatus
}
