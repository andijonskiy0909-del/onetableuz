const router = require('express').Router()

const ownerRoutes       = require('./owner')
const reservationRoutes = require('./reservations')
const restaurantRoutes  = require('./restaurants')
const reviewRoutes      = require('./reviews')
const paymentRoutes     = require('./payments')
const userRoutes        = require('./users')

// ── Auth (Telegram) ───────────────────────────────────────────
router.use('/auth', userRoutes)

// ── Users ─────────────────────────────────────────────────────
router.use('/users', userRoutes)

// ── Restaurants (public) ──────────────────────────────────────
router.use('/restaurants', restaurantRoutes)

// ── Reservations ──────────────────────────────────────────────
router.use('/reservations', reservationRoutes)

// ── Reviews ───────────────────────────────────────────────────
router.use('/reviews', reviewRoutes)

// ── Payments ──────────────────────────────────────────────────
router.use('/payments', paymentRoutes)

// ── Owner (dashboard) ─────────────────────────────────────────
router.use('/owner', ownerRoutes)

module.exports = router
