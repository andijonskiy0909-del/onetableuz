require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { Server } = require('socket.io')

const { checkEnvVars, securityHeaders, xssProtection, apiRateLimiter, authRateLimiter } = require('./middleware/security')
const logger = require('./config/logger')
const db = require('./config/db')
const { expireReservations } = require('./services/bookingService')

checkEnvVars()

const app = express()
const server = http.createServer(app)

// ── Socket.io ────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
})
app.set('io', io)
io.on('connection', (socket) => {
  socket.on('join_restaurant', (id) => { if (!isNaN(id)) socket.join(`restaurant_${id}`) })
  socket.on('join_user', (id) => { if (!isNaN(id)) socket.join(`user_${id}`) })
})

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(securityHeaders)
app.use(xssProtection)
app.set('trust proxy', 1)

// ── Static: uploads ──────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

// ── Static: webapp + dashboard ───────────────────────────────
const WEBAPP_DIR = path.join(__dirname, '..', '..', 'webapp')

// ✅ no-cache for HTML so Telegram doesn't keep stale mini-app
app.use('/webapp', express.static(WEBAPP_DIR, {
  index: false,
  etag: false,
  setHeaders: (res, p) => {
    if (p.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  }
}))

const sendNoCacheHtml = (res, fp) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.sendFile(fp)
}

app.get('/app', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'index.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('WebApp not found')
})
app.get('/app/*', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'index.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('WebApp not found')
})
app.get('/dashboard', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'dashboard.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('Dashboard not found')
})
app.get('/dashboard/*', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'dashboard.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('Dashboard not found')
})
app.get('/admin', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'admin.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('Admin not found')
})
app.get('/admin/*', (req, res) => {
  const fp = path.join(WEBAPP_DIR, 'admin.html')
  if (fs.existsSync(fp)) sendNoCacheHtml(res, fp)
  else res.status(404).send('Admin not found')
})

// ── Bot webhook ──────────────────────────────────────────────
app.post('/webhook/:token', express.json(), (req, res) => {
  try {
    const bot = app.get('telegramBot')
    if (bot && bot.processUpdate) bot.processUpdate(req.body)
  } catch (e) {
    logger.error('webhook:', e.message)
  }
  res.sendStatus(200)
})

// ── Rate limits ──────────────────────────────────────────────
app.use('/api', apiRateLimiter)
app.use('/api/auth', authRateLimiter)
app.use('/api/owner/login', authRateLimiter)
app.use('/api/owner/register', authRateLimiter)

// ── API routes ───────────────────────────────────────────────
app.use('/api', require('./routes'))

// ── Health ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', time: new Date().toISOString() })
})
app.get('/', (req, res) => res.send('OneTable API v2.0 ✅'))

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Endpoint topilmadi' }))

// ── Global error ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled:', err.message)
  res.status(err.status || 500).json({ error: err.message || 'Server xatolik' })
})

// ── ✅ AUTO MIGRATION (kengaytirilgan) ───────────────────────
async function runMigrations() {
  const migrations = [
    // zones
    `ALTER TABLE zones ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE zones ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE zones ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true`,
    // tables
    `ALTER TABLE tables ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE tables ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true`,
    `ALTER TABLE tables ADD COLUMN IF NOT EXISTS min_guests INTEGER DEFAULT 1`,
    `ALTER TABLE tables ADD COLUMN IF NOT EXISTS shape VARCHAR(20) DEFAULT 'round'`,
    // reels
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true`,
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`,
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'video'`,
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS caption TEXT`,
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0`,
    `ALTER TABLE reels ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0`,
    // ✅ reservations — deposit + boshqa optional ustunlar
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT false`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_status VARCHAR(30) DEFAULT 'not_required'`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_reference TEXT`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_screenshot TEXT`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pre_order JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pre_order_total NUMERIC DEFAULT 0`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20)`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancel_reason TEXT`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_asked BOOLEAN DEFAULT false`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid'`,
    // ✅ restaurants — qo'shimcha
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT false`,
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0`,
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false`,
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false`,
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP`
  ]
  let ok = 0, fail = 0
  for (const sql of migrations) {
    try {
      await db.query(sql)
      ok++
    } catch (e) {
      fail++
      logger.warn(`Migration skip: ${e.message}`)
    }
  }
  logger.info(`✅ Auto-migrations: ${ok} ok, ${fail} skipped`)
}

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000

server.listen(PORT, async () => {
  logger.info(`🚀 Server running on :${PORT}`)

  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql')
    if (fs.existsSync(schemaPath)) {
      await db.query(fs.readFileSync(schemaPath, 'utf8'))
      logger.info('✅ Schema applied')
    }
  } catch (e) {
    logger.error('schema:', e.message)
  }

  try {
    await runMigrations()
  } catch (e) {
    logger.error('migration:', e.message)
  }

  setInterval(expireReservations, 5 * 60 * 1000)
  logger.info('✅ Cron started')

  try {
    if (process.env.BOT_TOKEN) {
      const bot = require('../../bot/index.js')
      if (bot && bot.bot) app.set('telegramBot', bot.bot)
      logger.info('✅ Telegram bot attached')
    }
  } catch (e) {
    logger.warn('Bot not attached:', e.message)
  }
})

module.exports = { app, io }
