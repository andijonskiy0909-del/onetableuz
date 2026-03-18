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

    // role ustunini qo'shish (agar yo'q bo'lsa)
    await pool.query(`
      ALTER TABLE restaurant_owners 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner'
    `)

    // Eski admin'ni o'chirish
    await pool.query(`DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz'`)

    // Yangi admin yaratish
    const hash = await bcrypt.hash('admin123', 10)
    await pool.query(`
      INSERT INTO restaurant_owners (email, password_hash, role) 
      VALUES ('admin@onetable.uz', $1, 'admin')
    `, [hash])

    res.send(`
      <h2>✅ Admin muvaffaqiyatli yaratildi!</h2>
      <p><b>Email:</b> admin@onetable.uz</p>
      <p><b>Parol:</b> admin123</p>
      <p><a href="https://andijonskiy0909-del.github.io/onetable-dashboard/admin.html">Admin panelga o'tish →</a></p>
    `)
  } catch(e) {
    res.send('Xato: ' + e.message)
  }
})

// ── Bir martalik owner fix ───────────────────────────────────
app.get('/fix-owner', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs')
    const pool = require('./db')
    const hash = await bcrypt.hash('secret123', 10)
    await pool.query(`DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz'`)
    await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, restaurant_id) VALUES ($1, $2, 1)`,
      ['admin@onetable.uz', hash]
    )
    res.send('✅ Tayyor! Login: admin@onetable.uz | Parol: secret123')
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

app.use("/api/restaurants", restaurantRoutes)
app.use("/api/reservations", reservationRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/owner", ownerRoutes)
app.use("/api/admin", adminRoutes)

app.get("/", (req, res) => {
  res.send("OneTable API ishlayapti ✅")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`)
})
