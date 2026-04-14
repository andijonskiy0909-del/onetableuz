const router = require('express').Router()

router.use('/auth', require('./auth'))
router.use('/restaurants', require('./restaurants'))
router.use('/reservations', require('./reservations'))
router.use('/reviews', require('./reviews'))
router.use('/uploads', require('./uploads'))
router.use('/owner', require('./owner'))

module.exports = router
