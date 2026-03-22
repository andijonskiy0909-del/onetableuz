/**
 * OneTable — Security Middleware
 * Rate limiting, XSS protection, input sanitization
 */

// ── Rate Limiter (Redis-free, in-memory) ─────────────────────
const requestCounts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa
const MAX_REQUESTS = 100;
const AUTH_MAX = 10; // login uchun qattiqroq

setInterval(() => requestCounts.clear(), WINDOW_MS);

function rateLimiter(max = MAX_REQUESTS) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const count = (requestCounts.get(key) || 0) + 1;
    requestCounts.set(key, count);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

    if (count > max) {
      return res.status(429).json({
        error: 'Juda ko\'p so\'rov. 15 daqiqadan keyin urinib ko\'ring.',
        retryAfter: Math.ceil(WINDOW_MS / 1000)
      });
    }
    next();
  };
}

// Auth uchun qattiqroq rate limit
const authRateLimiter = rateLimiter(AUTH_MAX);
const apiRateLimiter = rateLimiter(MAX_REQUESTS);

// ── XSS Protection ────────────────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
}

// ── Input Validators ──────────────────────────────────────────
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

function validateRequired(fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => {
      const val = req.body[f];
      return val === undefined || val === null || val === '';
    });
    if (missing.length) {
      return res.status(400).json({
        error: `Majburiy maydonlar: ${missing.join(', ')}`
      });
    }
    next();
  };
}

function validateReservation(req, res, next) {
  const { restaurant_id, date, time, guests } = req.body;
  const errors = [];

  if (!restaurant_id || isNaN(parseInt(restaurant_id))) errors.push('restaurant_id noto\'g\'ri');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date noto\'g\'ri (YYYY-MM-DD)');
  if (!time || !/^\d{2}:\d{2}$/.test(time)) errors.push('time noto\'g\'ri (HH:MM)');
  if (!guests || guests < 1 || guests > 20) errors.push('guests 1-20 orasida bo\'lishi kerak');

  // O'tgan sana tekshirish
  if (date) {
    const reservDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (reservDate < today) errors.push('O\'tgan sanaga bron qilib bo\'lmaydi');
  }

  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  next();
}

function validateOwnerRegister(req, res, next) {
  const { email, password, full_name } = req.body;
  const errors = [];

  if (!full_name || full_name.length < 2) errors.push('Ism kamida 2 ta belgi');
  if (!validateEmail(email)) errors.push('Email noto\'g\'ri format');
  if (!validatePassword(password)) errors.push('Parol kamida 6 ta belgi');

  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  next();
}

function validateMenuItemInput(req, res, next) {
  const { name, price } = req.body;
  const errors = [];

  if (!name || name.length < 2) errors.push('Taom nomi kamida 2 ta belgi');
  if (!price || isNaN(price) || price < 0) errors.push('Narx musbat son bo\'lishi kerak');

  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  next();
}

function validateRestaurantInput(req, res, next) {
  const { name, address } = req.body;
  const errors = [];

  if (!name || name.length < 2) errors.push('Restoran nomi kamida 2 ta belgi');
  if (!address || address.length < 5) errors.push('Manzil kamida 5 ta belgi');

  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  next();
}

// ── Environment Variable Checker ─────────────────────────────
function checkEnvVars() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'BOT_TOKEN'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length) {
    console.error('❌ Muhim env variablelar topilmadi:', missing.join(', '));
    console.error('Iltimos .env faylini tekshiring!');
    process.exit(1);
  }
  console.log('✅ Env variablelar tekshirildi');
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

module.exports = {
  rateLimiter,
  authRateLimiter,
  apiRateLimiter,
  xssProtection,
  validateRequired,
  validateReservation,
  validateOwnerRegister,
  validateMenuItemInput,
  validateRestaurantInput,
  checkEnvVars,
  securityHeaders,
  escapeHtml,
  sanitizeObject
};
