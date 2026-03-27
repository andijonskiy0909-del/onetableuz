const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} - ${err.message}`, { stack: err.stack });

  // Postgres errors
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Bu ma\'lumot allaqachon mavjud' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Bog\'liq ma\'lumot topilmadi' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Ma\'lumot chegaradan chiqib ketdi' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: "Token noto'g'ri" });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token muddati tugagan' });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Server xatoligi'
    : err.message;

  res.status(status).json({ error: message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `${req.method} ${req.path} - Topilmadi` });
}

module.exports = { errorHandler, notFoundHandler };
