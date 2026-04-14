const router = require('express').Router()

// Auth / public routes
router.use('/auth', require('./auth'))

// Owner dashboard routes
router.use('/owner', require('./owner'))

// Agar boshqa route'lar bo'lsa, shu yerda ulaysiz.
// Misol:
// router.use('/admin', require('./admin'))
// router.use('/restaurants', require('./restaurants'))
// router.use('/reservations', require('./reservations'))

module.exports = router
