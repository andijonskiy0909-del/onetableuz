const router = require('express').Router()
const c = require('../controllers/reviewController')

router.post('/', c.create)
router.get('/restaurant/:id', c.listByRestaurant)

module.exports = router
