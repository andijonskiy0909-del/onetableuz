const path = require('path')
const fs = require('fs')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

// ✅ Proxy ortida ishlagan holat uchun to'g'ri protokolni aniqlash
function getBaseUrl(req) {
  // 1-prioritet: .env dan aniq URL
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  }
  // 2-prioritet: X-Forwarded-Proto (Nginx, Cloudflare, Railway, Render)
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host = req.get('x-forwarded-host') || req.get('host')
  // Agar Telegram ichida ishlayotgan bo'lsa, har doim HTTPS
  const finalProto = host && host.includes('localhost') ? proto : 'https'
  return `${finalProto}://${host}`
}

exports.single = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Fayl yuborilmadi')
  const url = `${getBaseUrl(req)}/uploads/${req.file.filename}`
  res.json({
    url,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size
  })
})

exports.multiple = asyncHandler(async (req, res) => {
  const files = req.files || []
  if (!files.length) throw AppError.badRequest('Fayllar yuborilmadi')
  const items = files.map(f => ({
    url: `${getBaseUrl(req)}/uploads/${f.filename}`,
    filename: f.filename,
    mimetype: f.mimetype,
    size: f.size
  }))
  res.json({ files: items })
})

exports.remove = asyncHandler(async (req, res) => {
  const name = req.params.filename
  if (!/^[\w.\-]+$/.test(name)) throw AppError.badRequest('Yaroqsiz fayl nomi')
  const fp = path.join(__dirname, '..', '..', 'uploads', name)
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp)
    res.json({ ok: true })
  } else {
    throw AppError.notFound('Fayl topilmadi')
  }
})
