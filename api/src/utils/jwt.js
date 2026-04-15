const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'
const EXPIRES = process.env.JWT_EXPIRES_IN || '30d'

exports.sign = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES })

exports.verify = (token) => {
  try {
    return jwt.verify(token, SECRET)
  } catch {
    return null
  }
}

exports.decode = (token) => {
  try {
    return jwt.decode(token)
  } catch {
    return null
  }
}
