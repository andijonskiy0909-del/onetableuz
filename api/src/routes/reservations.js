const router = require('express').Router()
const c = require('../controllers/reservationController')
const { authUser } = require('../middleware/auth')

// Public (for bot cron)
router.get('/past-unreviewed', c.pastUnreviewed)
router.put('/:id/review-asked', c.markReviewAsked)

// Protected
router.post('/', authUser, c.create)
router.get('/my', authUser, c.myList)
router.delete('/:id', authUser, c.cancel)

module.exports = router
