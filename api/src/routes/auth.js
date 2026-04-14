const router = require('express').Router()
const c = require('../controllers/authController')

router.post('/telegram', c.telegramLogin)

module.exports = router
