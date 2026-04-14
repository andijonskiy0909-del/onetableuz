const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET
const EXPIRES = process.env.JWT_EXPIRES_IN || '30d'

exports.sign = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES })

exports.verify = (token) => {
  try { return jwt.verify(token, SECRET) }
  catch { return null }
}
