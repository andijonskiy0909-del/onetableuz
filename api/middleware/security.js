// src/middleware/security.js — Security middleware
'use strict';

const rateLimit = require('express-rate-limit');
const Joi = require('joi');

// ── Rate Limiters ─────────────────────────────────────────────

function createRateLimiter(max, windowMs = 15 * 60 * 1000, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: message || `Juda ko'p so'rov. ${Math.round(windowMs / 60000)} daqiqadan keyin urinib ko'ring.`,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown'
  });
}

const apiLimiter = createRateLimiter(100);           // General API
const authLimiter = createRateLimiter(10, 15 * 60 * 1000, "Ko'p marta noto'g'ri urinish. 15 daqiqa kuting."); // Login/register
const reservationLimiter = createRateLimiter(20);    // Reservation creation

// ── Input Sanitization ────────────────────────────────────────

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

function sanitizeBody(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') result[key] = sanitizeString(val);
    else if (typeof val === 'object' && val !== null) result[key] = sanitizeBody(val, depth + 1);
    else result[key] = val;
  }
  return result;
}

function xssProtection(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeBody(req.body);
  }
  next();
}

// ── Joi Validators ────────────────────────────────────────────

const schemas = {
  telegramAuth: Joi.object({
    telegram_id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    username: Joi.string().max(100).optional().allow('', null),
    first_name: Joi.string().max(100).optional().allow('', null),
    last_name: Joi.string().max(100).optional().allow('', null)
  }),

  ownerRegister: Joi.object({
    email: Joi.string().email().max(255).lowercase().required(),
    password: Joi.string().min(6).max(128).required(),
    full_name: Joi.string().min(2).max(255).required(),
    phone: Joi.string().max(20).optional().allow('', null)
  }),

  ownerLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  reservation: Joi.object({
    restaurant_id: Joi.number().integer().positive().required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
      .custom((value, helpers) => {
        const d = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (d < today) return helpers.error('any.invalid');
        return value;
      }, "date must be today or future"),
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
    guests: Joi.number().integer().min(1).max(50).required(),
    comment: Joi.string().max(500).optional().allow('', null),
    special_request: Joi.string().max(500).optional().allow('', null),
    zone_id: Joi.number().integer().positive().optional().allow(null),
    pre_order: Joi.array().items(
      Joi.object({ id: Joi.number().required(), name: Joi.string().optional(), qty: Joi.number().min(1).required(), price: Joi.number().optional() })
    ).optional()
  }),

  restaurant: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    address: Joi.string().min(5).max(255).required(),
    description: Joi.string().max(1000).optional().allow('', null),
    phone: Joi.string().max(50).optional().allow('', null),
    cuisine: Joi.alternatives().try(Joi.array(), Joi.string()).optional(),
    price_category: Joi.string().valid('$', '$$', '$$$').optional(),
    capacity: Joi.number().integer().min(1).max(1000).optional(),
    image_url: Joi.string().uri().max(500).optional().allow('', null),
    working_hours: Joi.string().max(100).optional().allow('', null)
  }),

  menuItem: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    price: Joi.number().min(0).required(),
    category: Joi.string().max(100).optional().allow('', null),
    description: Joi.string().max(500).optional().allow('', null),
    image_url: Joi.string().uri().max(500).optional().allow('', null)
  }),

  zone: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().max(255).optional().allow('', null),
    capacity: Joi.number().integer().min(1).max(500).optional(),
    icon: Joi.string().max(10).optional().allow('', null)
  }),

  review: Joi.object({
    telegram_id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    restaurant_id: Joi.number().integer().positive().required(),
    rating: Joi.number().integer().min(1).max(5).required(),
    reservation_id: Joi.number().integer().positive().optional().allow(null),
    comment: Joi.string().max(1000).optional().allow('', null),
    photo_url: Joi.string().uri().max(500).optional().allow('', null)
  })
};

function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message.replace(/"/g, '')).join('. ');
      return res.status(400).json({ error: messages });
    }
    req.body = value;
    next();
  };
}

module.exports = {
  apiLimiter,
  authLimiter,
  reservationLimiter,
  xssProtection,
  validate
};
