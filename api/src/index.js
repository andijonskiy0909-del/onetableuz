const express = require("express")
const cors = require("cors")
const path = require("path")
require("dotenv").config()

const app = express()
app.use(cors())
app.use(express.json())

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

app.use("/api/restaurants", restaurantRoutes)
app.use("/api/reservations", reservationRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/owner", ownerRoutes)

app.get("/", (req, res) => {
  res.send("OneTable API ishlayapti ✅")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`)
})
