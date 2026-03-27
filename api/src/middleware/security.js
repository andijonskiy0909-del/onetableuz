const rateLimit = require('express-rate-limit');
const Joi = require('joi');

// ── Rate Limiters ──────────────────────────────────────────────
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Juda ko'p so'rov. 15 daqiqadan keyin urinib ko'ring." }
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Juda ko'p urinish. 15 daqiqadan keyin urinib ko'ring." }
});

const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Juda ko'p so'rov. Biroz kuting." }
});

// ── XSS Protection ────────────────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') clean[key] = escapeHtml(val.trim());
    else if (typeof val === 'object' && val !== null) clean[key] = sanitizeObject(val);
    else clean[key] = val;
  }
  return clean;
}

function xssProtection(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ── Security Headers ──────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
}

// ── Joi Validation Middleware ─────────────────────────────────
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message.replace(/"/g, '')).join('. ');
      return res.status(400).json({ error: messages });
    }
    req[source] = value;
    next();
  };
}

// ── Schemas ───────────────────────────────────────────────────
const schemas = {
  ownerRegister: Joi.object({
    email: Joi.string().email().required().messages({ 'string.email': "Email noto'g'ri format", 'any.required': 'Email kerak' }),
    password: Joi.string().min(6).required().messages({ 'string.min': 'Parol kamida 6 ta belgi', 'any.required': 'Parol kerak' }),
    full_name: Joi.string().min(2).max(100).required().messages({ 'string.min': 'Ism kamida 2 ta belgi', 'any.required': 'Ism kerak' }),
    phone: Joi.string().allow('', null).optional()
  }),

  ownerLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  restaurant: Joi.object({
    name: Joi.string().min(2).max(200).required().messages({ 'any.required': 'Restoran nomi kerak' }),
    address: Joi.string().min(5).max(500).required().messages({ 'any.required': 'Manzil kerak' }),
    description: Joi.string().max(2000).allow('', null).optional(),
    phone: Joi.string().max(20).allow('', null).optional(),
    cuisine: Joi.array().items(Joi.string()).allow(null).optional(),
    price_category: Joi.string().valid('$', '$$', '$$$').default('$$'),
    capacity: Joi.number().integer().min(1).max(1000).default(50),
    image_url: Joi.string().uri().allow('', null).optional(),
    working_hours: Joi.string().max(100).allow('', null).optional()
  }),

  reservation: Joi.object({
    restaurant_id: Joi.number().integer().positive().required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({ 'string.pattern.base': "Sana formati: YYYY-MM-DD" }),
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({ 'string.pattern.base': "Vaqt formati: HH:MM" }),
    guests: Joi.number().integer().min(1).max(50).required(),
    zone_id: Joi.number().integer().positive().allow(null).optional(),
    comment: Joi.string().max(500).allow('', null).optional(),
    special_request: Joi.string().max(500).allow('', null).optional(),
    pre_order: Joi.array().items(Joi.object()).default([])
  }),

  menuItem: Joi.object({
    name: Joi.string().min(2).max(200).required(),
    category: Joi.string().max(100).allow('', null).optional(),
    price: Joi.number().positive().required().messages({ 'number.positive': 'Narx musbat son bo\'lishi kerak' }),
    description: Joi.string().max(500).allow('', null).optional(),
    image_url: Joi.string().uri().allow('', null).optional(),
    is_available: Joi.boolean().default(true)
  }),

  zone: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(300).allow('', null).optional(),
    capacity: Joi.number().integer().min(1).default(10),
    icon: Joi.string().max(10).default('🪑')
  }),

  review: Joi.object({
    telegram_id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    restaurant_id: Joi.number().integer().positive().required(),
    reservation_id: Joi.number().integer().positive().allow(null).optional(),
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().max(1000).allow('', null).optional(),
    photo_url: Joi.string().uri().allow('', null).optional()
  })
};

module.exports = {
  apiRateLimiter,
  authRateLimiter,
  strictRateLimiter,
  xssProtection,
  securityHeaders,
  validate,
  schemas,
  escapeHtml
};
