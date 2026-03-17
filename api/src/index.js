const express = require("express")
const cors = require("cors")
const path = require("path")
require("dotenv").config()

const app = express()
app.use(cors())
app.use(express.json())

// Dashboard
app.use('/dashboard', express.static(path.join(__dirname, '../webapp')))
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../webapp/dashboard.html'))
})
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
