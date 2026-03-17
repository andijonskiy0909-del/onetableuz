const express = require("express")
const cors = require("cors")
require("dotenv").config()

const app = express()

app.use(cors())
app.use(express.json())

// Routes
const restaurantRoutes = require("./routes/restaurants")
const reservationRoutes = require("./routes/reservations")
const authRoutes = require("./routes/auth")

app.use("/api/restaurants", restaurantRoutes)
app.use("/api/reservations", reservationRoutes)
app.use("/api/auth", authRoutes)

app.get("/", (req, res) => {
  res.send("OneTable API ishlayapti ✅")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`)
})
