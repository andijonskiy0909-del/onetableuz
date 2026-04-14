const rateLimit = require('express-rate-limit')
const logger = require('../config/logger')

function checkEnvVars() {
  const required = ['DATABASE_URL', 'JWT_SECRET']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    logger.error('Missing env vars:', missing.join(', '))
    process.exit(1)
  }
  if (process.env.JWT_SECRET.length < 32) {
    logger.warn('JWT_SECRET is too short. Use 48+ chars.')
  }
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
  next()
}

function xssProtection(req, res, next) {
  const clean = (val) => {
    if (typeof val === 'string') return val.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    if (val && typeof val === 'object') {
      for (const k in val) val[k] = clean(val[k])
    }
    return val
  }
  if (req.body) req.body = clean(req.body)
  if (req.query) req.query = clean(req.query)
  next()
}

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Juda koʻp soʻrov. Iltimos biroz kuting.' }
})

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Juda koʻp urinish. 15 daqiqa kuting.' }
})

module.exports = {
  checkEnvVars,
  securityHeaders,
  xssProtection,
  apiRateLimiter,
  authRateLimiter
}
