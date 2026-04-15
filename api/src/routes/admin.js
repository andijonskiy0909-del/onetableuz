const router = require('express').Router()
const c = require('../controllers/authController')

router.post('/telegram', c.telegramLogin)
router.post('/admin/login', c.adminLogin)

module.exports = router
