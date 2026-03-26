// src/middleware/errorHandler.js — Global error handler
'use strict';

const logger = require('../config/logger');
const { env } = require('../config/env');

// 404 handler
function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Global error handler
function errorHandler(err, req, res, next) {
  // PostgreSQL errors
  if (err.code) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Bu ma\'lumot allaqachon mavjud.' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Bog\'liq ma\'lumot topilmadi.' });
    }
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Ma\'lumot chegaradan tashqari.' });
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  const statusCode = err.statusCode || err.status || 500;
  
  // Log server errors
  if (statusCode >= 500) {
    logger.error('Server error', {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip
    });
  }

  res.status(statusCode).json({
    error: statusCode === 500 && env.isProduction
      ? 'Server xatoligi. Iltimos qaytadan urinib ko\'ring.'
      : err.message || 'Server xatoligi'
  });
}

// AppError helper class
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

module.exports = { notFound, errorHandler, AppError };
