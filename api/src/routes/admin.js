const router = require('express').Router()
const c = require('../controllers/adminController')
const { authAdmin } = require('../middleware/auth')

router.use(authAdmin)

// Dashboard
router.get('/stats', c.stats)

// Users
router.get('/users', c.listUsers)
router.put('/users/:id/toggle', c.toggleUser)

// Owners
router.get('/owners', c.listOwners)

// Restaurants
router.get('/restaurants', c.listRestaurants)
router.put('/restaurants/:id/approve', c.approveRestaurant)
router.put('/restaurants/:id/reject', c.rejectRestaurant)
router.put('/restaurants/:id/toggle', c.toggleRestaurant)
router.put('/restaurants/:id/premium', c.togglePremium)

// Bookings
router.get('/bookings', c.listBookings)

// Reviews
router.get('/reviews', c.listReviews)
router.put('/reviews/:id/toggle', c.toggleReviewVisibility)

// Premium requests
router.get('/premium-requests', c.listPremiumRequests)
router.put('/premium-requests/:id', c.processPremiumRequest)

// Activity
router.get('/activity', c.activityLog)

module.exports = router
