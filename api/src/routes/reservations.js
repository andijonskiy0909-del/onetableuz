const router = require('express').Router()
const c = require('../controllers/reservationController')
const { authUser } = require('../middleware/auth')

router.get('/past-unreviewed', c.pastUnreviewed)
router.put('/:id/review-asked', c.markReviewAsked)

router.post('/', authUser, c.create)
router.get('/my', authUser, c.myList)
router.delete('/:id', authUser, c.cancel)

module.exports = router
