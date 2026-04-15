require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { Server } = require('socket.io')

const { checkEnvVars, securityHeaders, xssProtection, requestLogger, apiRateLimiter, authRateLimiter } = require('./middleware/security')
const errorHandler = require('./middleware/errorHandler')
const logger = require('./config/logger')
const db = require('./config/db')
const { expireReservations, completeReservations } = require('./services/bookingService')

checkEnvVars()

const app = express()
const server = http.createServer(app)

// ── Socket.io ────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
})
app.set('io', io)

io.on('connection', (socket) => {
  socket.on('join_restaurant', (id) => {
    if (id && !isNaN(id)) socket.join(`restaurant_${id}`)
  })
  socket.on('join_user', (id) => {
    if (id && !isNaN(id)) socket.join(`user_${id}`)
  })
})

// ── Core middleware ──────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(securityHeaders)
app.use(xssProtection)
app.use(requestLogger)
app.set('trust proxy', 1)

// ── Static: uploads ──────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
}))

// ── Static: webapp ───────────────────────────────────────────
const WEBAPP_DIR = path.join(__dirname, '..', '..', 'webapp')
if (fs.existsSync(WEBAPP_DIR)) {
  app.use('/app', express.static(WEBAPP_DIR))
  app.get('/app*', (req, res) => {
    const fp = path.join(WEBAPP_DIR, 'index.html')
    if (fs.existsSync(fp)) res.sendFile(fp)
    else res.status(404).send('WebApp not found')
  })

  app.use('/dashboard', express.static(WEBAPP_DIR))
  app.get('/dashboard*', (req, res) => {
    const fp = path.join(WEBAPP_DIR, 'dashboard.html')
    if (fs.existsSync(fp)) res.sendFile(fp)
    else res.status(404).send('Dashboard not found')
  })

  // Admin panel
  app.get('/admin', (req, res) => {
    const fp = path.join(WEBAPP_DIR, 'admin.html')
    if (fs.existsSync(fp)) res.sendFile(fp)
    else res.status(404).send('Admin panel not found')
  })
}

// ── Bot webhook ──────────────────────────────────────────────
app.post('/webhook/:token', express.json(), (req, res) => {
  try {
    const telegramBot = app.get('telegramBot')
    if (telegramBot && telegramBot.processUpdate) {
      telegramBot.processUpdate(req.body)
    }
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
  res.json({
    status: 'ok',
    version: '3.0.0',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  })
})

app.get('/', (req, res) => {
  res.json({
    name: 'OneTable API',
    version: '3.0.0',
    docs: '/health',
    dashboard: '/dashboard',
    app: '/app',
    admin: '/admin'
  })
})

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `${req.method} ${req.path} topilmadi` })
})

// ── Error handler ────────────────────────────────────────────
app.use(errorHandler)

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000

server.listen(PORT, async () => {
  logger.info(`🚀 OneTable API v3.0 running on :${PORT}`)

  // Apply schema
  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql')
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8')
      await db.query(schema)
      logger.info('✅ Database schema applied')
    }
  } catch (e) {
    logger.error('Schema error:', e.message)
  }

  // Cron jobs
  setInterval(() => {
    expireReservations()
    completeReservations()
  }, 5 * 60 * 1000)
  logger.info('✅ Cron jobs started')

  // Bot
  try {
    if (process.env.BOT_TOKEN) {
      const botModule = require('../../bot/index.js')
      if (botModule && botModule.bot) {
        app.set('telegramBot', botModule.bot)
        logger.info('✅ Telegram bot attached')
      }
    }
  } catch (e) {
    logger.warn('Bot not loaded:', e.message)
  }
})

module.exports = { app, io, server }
