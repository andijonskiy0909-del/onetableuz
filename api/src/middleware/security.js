const requestCounts = new Map()
const WINDOW_MS = 15 * 60 * 1000
setInterval(() => requestCounts.clear(), WINDOW_MS)

function rateLimiter(max) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const count = (requestCounts.get(key) || 0) + 1
    requestCounts.set(key, count)
    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count))
    if (count > max) return res.status(429).json({ error: 'Juda ko\'p so\'rov. Keyinroq urinib ko\'ring.' })
    next()
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = escapeHtml(v.trim())
    else if (Array.isArray(v)) out[k] = v
    else if (v && typeof v === 'object') out[k] = sanitize(v)
    else out[k] = v
  }
  return out
}

function xssProtection(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = sanitize(req.body)
  next()
}

function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
}

function checkEnvVars() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'BOT_TOKEN']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    console.warn('⚠️ Env variablelar topilmadi:', missing.join(', '))
  } else {
    console.log('✅ Env variablelar OK')
  }
}

// Validators
function validateReservation(req, res, next) {
  const { restaurant_id, date, time, guests } = req.body
  const errors = []
  if (!restaurant_id || isNaN(+restaurant_id)) errors.push('restaurant_id noto\'g\'ri')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date noto\'g\'ri (YYYY-MM-DD)')
  if (!time || !/^\d{2}:\d{2}$/.test(time)) errors.push('time noto\'g\'ri (HH:MM)')
  if (!guests || guests < 1 || guests > 50) errors.push('guests 1-50 orasida bo\'lishi kerak')
  if (date) {
    const d = new Date(date); const t = new Date(); t.setHours(0,0,0,0)
    if (d < t) errors.push('O\'tgan sanaga bron qilib bo\'lmaydi')
  }
  if (errors.length) return res.status(400).json({ error: errors.join('. ') })
  next()
}

function validateOwnerRegister(req, res, next) {
  const { email, password, full_name } = req.body
  const errors = []
  if (!full_name || full_name.length < 2) errors.push('Ism kamida 2 ta belgi')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email noto\'g\'ri')
  if (!password || password.length < 6) errors.push('Parol kamida 6 ta belgi')
  if (errors.length) return res.status(400).json({ error: errors.join('. ') })
  next()
}

function validateMenuItem(req, res, next) {
  const { name, price } = req.body
  const errors = []
  if (!name || name.length < 2) errors.push('Nom kamida 2 ta belgi')
  if (!price || isNaN(price) || price < 0) errors.push('Narx musbat son bo\'lishi kerak')
  if (errors.length) return res.status(400).json({ error: errors.join('. ') })
  next()
}

function validateRestaurant(req, res, next) {
  const { name, address } = req.body
  const errors = []
  if (!name || name.length < 2) errors.push('Nom kamida 2 ta belgi')
  if (!address || address.length < 5) errors.push('Manzil kamida 5 ta belgi')
  if (errors.length) return res.status(400).json({ error: errors.join('. ') })
  next()
}

module.exports = {
  rateLimiter,
  apiRateLimiter: rateLimiter(100),
  authRateLimiter: rateLimiter(10),
  xssProtection,
  securityHeaders,
  checkEnvVars,
  validateReservation,
  validateOwnerRegister,
  validateMenuItem,
  validateRestaurant,
  escapeHtml,
  sanitize
}
