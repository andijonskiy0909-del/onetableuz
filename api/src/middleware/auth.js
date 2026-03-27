const jwt = require('jsonwebtoken')

function userAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Token kerak' })
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch(e) {
    return res.status(401).json({ error: e.name === 'TokenExpiredError' ? 'Token muddati tugagan' : 'Token noto\'g\'ri' })
  }
}

function ownerAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Token kerak' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (!['owner','admin'].includes(decoded.role)) return res.status(403).json({ error: 'Ruxsat yo\'q' })
    req.owner = decoded
    next()
  } catch(e) {
    return res.status(401).json({ error: 'Token noto\'g\'ri' })
  }
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Token kerak' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' })
    req.admin = decoded
    next()
  } catch(e) {
    return res.status(401).json({ error: 'Token noto\'g\'ri' })
  }
}

function createToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn })
}

module.exports = { userAuth, ownerAuth, adminAuth, createToken }
