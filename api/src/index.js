const express = require("express")
const cors = require("cors")
const path = require("path")
require("dotenv").config()
const app = express()
app.use(cors())
app.use(express.json())

// ── Admin sozlash (1 MARTA ishlatish) ───────────────────────
app.get('/setup-admin', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs')
    const pool = require('./db')
    await pool.query(`ALTER TABLE restaurant_owners ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner'`)
    await pool.query(`DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz'`)
    const hash = await bcrypt.hash('admin123', 10)
    await pool.query(`INSERT INTO restaurant_owners (email, password_hash, role) VALUES ('admin@onetable.uz', $1, 'admin')`, [hash])
    res.send(`<h2>✅ Admin yaratildi!</h2><p><b>Email:</b> admin@onetable.uz</p><p><b>Parol:</b> admin123</p>`)
  } catch(e) {
    res.send('Xato: ' + e.message)
  }
})

// ── Reviews jadvali yaratish (1 MARTA) ───────────────────────
app.get('/setup-reviews', async (req, res) => {
  try {
    const pool = require('./db')
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

// ── Dashboard ────────────────────────────────────────────────
app.use('/dashboard', express.static(path.join(__dirname, '../webapp')))
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../webapp/dashboard.html'))
})

// ── Routes ───────────────────────────────────────────────────
const restaurantRoutes = require("./routes/restaurants")
const reservationRoutes = require("./routes/reservations")
const authRoutes = require("./routes/auth")
const ownerRoutes = require("./routes/owner")
const adminRoutes = require("./routes/admin")
const reviewRoutes = require("./routes/reviews")
const aiRoutes = require("./routes/ai") // ✅ AI

app.use("/api/restaurants", restaurantRoutes)
app.use("/api/reservations", reservationRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/owner", ownerRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/reviews", reviewRoutes)
app.use("/api/ai", aiRoutes) // ✅ AI

app.get("/", (req, res) => {
  res.send("OneTable API ishlayapti ✅")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`)
})
```

**GitHub da 2 ta fayl:**

1. `src/index.js` → Edit → paste → Commit
2. `src/routes/ai.js` → yangi fayl → yuqorida bergan `ai.js` kodni paste → Commit

Deploy bo'lgach brauzerda test qiling:
```
https://onetableuz-production.up.railway.app/api/ai/chat
