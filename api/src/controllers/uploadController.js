const path = require('path')
const fs = require('fs')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`

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
