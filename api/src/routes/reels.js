const router = require('express').Router()
const c = require('../controllers/restaurantController')

// Public: list all published reels (alias for /api/restaurants/reels)
router.get('/', c.getReels)

// Optional: like / view counters (stubs — don't crash if columns don't exist)
router.post('/:id/like', async (req, res) => {
  const db = require('../config/db')
  try {
    await db.query('UPDATE reels SET likes = COALESCE(likes,0) + 1 WHERE id = $1', [req.params.id])
  } catch (e) { /* column may not exist — ignore */ }
  res.json({ ok: true })
})

router.post('/:id/view', async (req, res) => {
  const db = require('../config/db')
  try {
    await db.query('UPDATE reels SET views = COALESCE(views,0) + 1 WHERE id = $1', [req.params.id])
  } catch (e) { /* column may not exist — ignore */ }
  res.json({ ok: true })
})

module.exports = router
