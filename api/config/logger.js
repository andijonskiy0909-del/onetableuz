// src/config/logger.js — Winston structured logger
'use strict';

const winston = require('winston');

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, ...meta }) => {
    const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${extras}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
         new winston.transports.File({ filename: 'logs/combined.log' })]
      : [])
  ]
});

// HTTP request logger middleware
logger.httpMiddleware = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  next();
};

module.exports = logger;
