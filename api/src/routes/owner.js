const router = require('express').Router()
const c = require('../controllers/ownerController')
const auth = require('../controllers/authController')
const { authOwner } = require('../middleware/ownerAuth')

// Public auth
router.post('/register', auth.ownerRegister)
router.post('/login', auth.ownerLogin)

// Protected
router.use(authOwner)

router.get('/me', c.getMe)
router.get('/restaurant', c.getRestaurant)
router.post('/restaurants', c.createRestaurant)
router.put('/restaurant', c.updateRestaurant)
router.put('/restaurant/location', c.updateLocation)

router.get('/reservations', c.listReservations)
router.put('/reservations/:id', c.updateReservation)

router.get('/menu', c.listMenu)
router.post('/menu', c.createMenu)
router.put('/menu/:id', c.updateMenu)
router.delete('/menu/:id', c.deleteMenu)

router.get('/zones', c.listZones)
router.post('/zones', c.createZone)
router.put('/zones/:id', c.updateZone)
router.delete('/zones/:id', c.deleteZone)

router.get('/tables', c.listTables)
router.post('/tables', c.createTable)
router.delete('/tables/:id', c.deleteTable)

router.get('/reels', c.listReels)
router.post('/reels', c.createReel)
router.delete('/reels/:id', c.deleteReel)

router.get('/analytics', c.analytics)
router.get('/premium', c.premiumStatus)
router.post('/premium/request', c.premiumRequest)

module.exports = router
