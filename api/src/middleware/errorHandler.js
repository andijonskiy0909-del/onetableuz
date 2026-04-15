const logger = require('../config/logger')

function errorHandler(err, req, res, next) {
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Fayl hajmi juda katta' })
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Kutilmagan fayl maydoni' })
  }

  // Operational errors (our AppError)
  if (err.isOperational) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.data ? { data: err.data } : {})
    })
  }

  // Postgres unique constraint
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Bu ma\'lumot allaqachon mavjud' })
  }

  // Postgres foreign key
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Bog\'liq ma\'lumot topilmadi' })
  }

  // Unexpected
  logger.error('Unhandled error:', err.message, err.stack?.split('\n').slice(0, 3).join(' | '))
  res.status(500).json({ error: 'Server xatoligi' })
}

module.exports = errorHandler
