const router = require('express').Router()
const c = require('../controllers/restaurantController')

router.get('/', c.list)
router.get('/reels', c.getReels)
router.get('/:id', c.getById)
router.get('/:id/menu', c.getMenu)
router.get('/:id/zones', c.getZones)
router.get('/:id/tables', c.getTables)   // ✅ YANGI — stollar endpointi
router.get('/:id/reviews', c.getReviews)
router.get('/:id/availability', c.getAvailability)

module.exports = router
