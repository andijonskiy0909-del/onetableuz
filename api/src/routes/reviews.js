const router = require('express').Router()
const c = require('../controllers/reviewController')

router.post('/', c.create)

module.exports = router
