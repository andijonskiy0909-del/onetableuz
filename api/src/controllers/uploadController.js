const path = require('path')
const fs = require('fs')

exports.single = (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl yuborilmadi' })
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
  res.json({
    url,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size
  })
}

exports.multiple = (req, res) => {
  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'Fayllar yuborilmadi' })
  const items = files.map(f => ({
    url: `${req.protocol}://${req.get('host')}/uploads/${f.filename}`,
    filename: f.filename,
    mimetype: f.mimetype,
    size: f.size
  }))
  res.json({ files: items })
}

exports.remove = (req, res) => {
  try {
    const name = req.params.filename
    if (!/^[\w.\-]+$/.test(name)) return res.status(400).json({ error: 'Yaroqsiz nom' })
    const fp = path.join(__dirname, '..', '..', 'uploads', name)
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Server xatolik' })
  }
}
