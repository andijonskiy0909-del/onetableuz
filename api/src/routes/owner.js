const router = require('express').Router()
const c = require('../controllers/ownerController')
const auth = require('../controllers/authController')
const { authOwner } = require('../middleware/auth')

// Public auth
router.post('/register', auth.ownerRegister)
router.post('/login', auth.ownerLogin)

// Everything below requires owner auth
router.use(authOwner)

// Profile
router.get('/me', (req, res) => {
  const owner = { ...req.owner }
  delete owner.password_hash
  res.json(owner)
})
router.put('/me', c.updateProfile)
router.put('/me/password', c.changePassword)

// Restaurant
router.get('/restaurant', c.getRestaurant)
router.post('/restaurants', c.createRestaurant)
router.put('/restaurant', c.updateRestaurant)
router.put('/restaurant/location', c.updateLocation)

// Reservations
router.get('/reservations', c.listReservations)
router.put('/reservations/:id', c.updateReservation)

// Menu
router.get('/menu', c.listMenu)
router.post('/menu', c.createMenu)
router.put('/menu/:id', c.updateMenu)
router.delete('/menu/:id', c.deleteMenu)

// Zones
router.get('/zones', c.listZones)
router.post('/zones', c.createZone)
router.put('/zones/:id', c.updateZone)
router.delete('/zones/:id', c.deleteZone)

// Tables
router.get('/tables', c.listTables)
router.post('/tables', c.createTable)
router.put('/tables/:id', c.updateTable)
router.delete('/tables/:id', c.deleteTable)

// Reels
router.get('/reels', c.listReels)
router.post('/reels', c.createReel)
router.put('/reels/:id', c.updateReel)      // ✅ YANGI — publish/unpublish toggle
router.delete('/reels/:id', c.deleteReel)

// Reviews
router.get('/reviews', c.listReviews)
router.put('/reviews/:id/reply', c.replyReview)

// Analytics
router.get('/analytics', c.analytics)

// Premium
router.get('/premium', c.premiumStatus)
router.post('/premium/request', c.premiumRequest)

// Notifications
router.get('/notifications', c.getNotifications)
router.put('/notifications/read', c.markNotificationsRead)

module.exports = router
