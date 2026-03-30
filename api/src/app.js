require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')
const http = require('http')
const { Server } = require('socket.io')

const { checkEnvVars, securityHeaders, xssProtection, apiRateLimiter, authRateLimiter } = require('./middleware/security')
const logger = require('./logger')
const { expireReservations } = require('./services/bookingService')

checkEnvVars()

const app = express()
const server = http.createServer(app)

// ── Socket.io ─────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
})
app.set('io', io)

io.on('connection', (socket) => {
  socket.on('join_restaurant', (id) => { if (!isNaN(id)) socket.join(`restaurant_${id}`) })
  socket.on('join_user', (id) => { if (!isNaN(id)) socket.join(`user_${id}`) })
})

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(securityHeaders)
app.use(xssProtection)
app.use(apiRateLimiter)
app.set('trust proxy', 1)

// ── Bot webhook ───────────────────────────────────────────────
app.post('/webhook/:token', (req, res) => {
  try {
    const { processUpdate } = require('../../bot/index.js')
    processUpdate(req.body)
  } catch(e) {
    logger.error('Webhook error: ' + e.message)
  }
  res.sendStatus(200)
})

// ── Dashboard static ──────────────────────────────────────────
app.use('/dashboard', express.static(path.join(__dirname, '../webapp')))
app.get('/dashboard*', (req, res) => {
  res.sendFile(path.join(__dirname, '../webapp/dashboard.html'))
})

// ── Routes ────────────────────────────────────────────────────
const routes = require('./routes/index')
app.use('/api/auth', authRateLimiter)
app.use('/api/owner/login', authRateLimiter)
app.use('/api/owner/register', authRateLimiter)
app.use('/api', routes)

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() })
})

app.get('/', (req, res) => res.send('OneTable API v2.0 ✅'))

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Endpoint topilmadi' }))

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error: ' + err.message)
  res.status(500).json({ error: 'Server xatoligi' })
})

// ── DB migrate + server start ─────────────────────────────────
const db = require('./db')
const PORT = process.env.PORT || 3000

server.listen(PORT, async () => {
  logger.info(`🚀 Server ${PORT} portda ishlayapti`)

  try {
    const fs = require('fs')
    const schemaPath = path.join(__dirname, '../schema.sql')
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8')
      await db.query(schema)
      logger.info('✅ DB schema qo\'llanildi')
    }

    await db.query(`
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 minutes');
      ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS gallery TEXT[] DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `).catch(() => {})

    logger.info('✅ DB patch qo\'llanildi')
  } catch (e) {
    logger.error('DB setup error: ' + e.message)
  }

  setInterval(expireReservations, 5 * 60 * 1000)
  logger.info('✅ Cron jobs ishga tushdi')

  // ── Bot ──────────────────────────────────────────────────────
  try {
    require('../../bot/index.js')
    logger.info('✅ Bot ishga tushdi')
  } catch (e) {
    logger.error('Bot xatosi: ' + e.message)
  }
})

module.exports = { app, io }
