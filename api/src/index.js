const express = require("express")
const cors = require("cors")
const path = require("path")
const http = require("http")
const { Server } = require("socket.io")
require("dotenv").config()

const app = express()
const server = http.createServer(app)

// Socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
})

app.use(cors())
app.use(express.json())

// Socket.io ni routes ga uzatish
app.set("io", io)

// Socket connection
io.on("connection", (socket) => {
  console.log("Dashboard ulandi:", socket.id)
  socket.on("join_restaurant", (restaurantId) => {
    socket.join(`restaurant_${restaurantId}`)
    console.log(`Owner restaurant_${restaurantId} xonasiga qo'shildi`)
  })
  socket.on("disconnect", () => {
    console.log("Dashboard uzildi:", socket.id)
  })
})

// ── DB Patch ─────────────────────────────────────────────────
const pool = require('./db')
pool.query(`
  CREATE TABLE IF NOT EXISTS zones (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    capacity INTEGER DEFAULT 10,
    icon VARCHAR(10) DEFAULT '🪑',
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS premium_subscriptions (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurants(id),
    plan VARCHAR(20) DEFAULT 'monthly',
    amount INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    started_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ALTER TABLE reservations ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id);
  ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS working_hours VARCHAR(50) DEFAULT '10:00 — 22:00';
  ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,6);
  ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,6);
  ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
  ALTER TABLE restaurant_owners ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
  ALTER TABLE restaurant_owners ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner';
`).then(() => console.log("✅ DB patch qo'llanildi"))
  .catch(e => console.error("DB patch xato:", e.message))

// ── Setup endpoints ───────────────────────────────────────────
app.get('/setup-admin', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs')
    await pool.query(`ALTER TABLE restaurant_owners ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner'`)
    await pool.query(`DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz'`)
    const hash = await bcrypt.hash('admin123', 10)
    await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, role) VALUES ('admin@onetable.uz', $1, 'admin')`,
      [hash]
    )
    res.send(`<h2>✅ Admin yaratildi!</h2><p><b>Email:</b> admin@onetable.uz</p><p><b>Parol:</b> admin123</p>`)
  } catch(e) {
    res.send('Xato: ' + e.message)
  }
})

app.get('/setup-reviews', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        restaurant_id INTEGER REFERENCES restaurants(id),
        reservation_id INTEGER REFERENCES reservations(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS rating NUMERIC(3,1) DEFAULT 0`)
    await pool.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0`)
    res.send('✅ Reviews jadvali tayyor!')
  } catch(e) {
    res.send('Xato: ' + e.message)
  }
})

app.get('/fix-owner', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs')
    const hash = await bcrypt.hash('secret123', 10)
    await pool.query(`DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz'`)
    await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, restaurant_id, full_name, role)
       VALUES ('admin@onetable.uz', $1, 1, 'Admin', 'admin')`,
      [hash]
    )
    res.send('✅ Tayyor! Login: admin@onetable.uz | Parol: secret123')
  } catch(e) {
    res.send('Xato: ' + e.message)
  }
})

// ── Dashboard ─────────────────────────────────────────────────
app.use('/dashboard', express.static(path.join(__dirname, '../webapp')))
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../webapp/dashboard.html'))
})

// ── Routes ────────────────────────────────────────────────────
const restaurantRoutes = require("./routes/restaurants")
const reservationRoutes = require("./routes/reservations")
const authRoutes = require("./routes/auth")
const ownerRoutes = require("./routes/owner")
const adminRoutes = require("./routes/admin")
const reviewRoutes = require("./routes/reviews")
const aiRoutes = require("./routes/ai")

app.use("/api/restaurants", restaurantRoutes)
app.use("/api/reservations", reservationRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/owner", ownerRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/reviews", reviewRoutes)
app.use("/api/ai", aiRoutes)

app.get("/", (req, res) => {
  res.send("OneTable API ishlayapti ✅")
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`)
})
