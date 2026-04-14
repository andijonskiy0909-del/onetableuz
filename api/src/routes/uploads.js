const router = require('express').Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const c = require('../controllers/uploadController')
const { authOwner } = require('../middleware/ownerAuth')

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_')
    const name = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safe}`
    cb(null, name)
  }
})

const IMAGE_MIME = ['image/jpeg','image/png','image/webp','image/gif']
const VIDEO_MIME = ['video/mp4','video/webm','video/quicktime']

const imageUpload = multer({
  storage,
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_IMAGE_MB) || 8) * 1024 * 1024 },
  fileFilter: (req, file, cb) => IMAGE_MIME.includes(file.mimetype) ? cb(null, true) : cb(new Error('Faqat rasm'))
})

const videoUpload = multer({
  storage,
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_VIDEO_MB) || 80) * 1024 * 1024 },
  fileFilter: (req, file, cb) => VIDEO_MIME.includes(file.mimetype) ? cb(null, true) : cb(new Error('Faqat video'))
})

router.post('/image', authOwner, imageUpload.single('file'), c.single)
router.post('/images', authOwner, imageUpload.array('files', 10), c.multiple)
router.post('/video', authOwner, videoUpload.single('file'), c.single)
router.delete('/:filename', authOwner, c.remove)

// Multer error handler
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message })
  next()
})

module.exports = router
