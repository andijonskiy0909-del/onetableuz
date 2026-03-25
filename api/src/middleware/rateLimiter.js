const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('../config/redis');

const apiLimiter = rateLimit({
  store: new RedisStore({ client: redis, prefix: 'rate-limit:' }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

const authLimiter = rateLimit({
  store: new RedisStore({ client: redis, prefix: 'rate-limit-auth:' }),
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' }
});

module.exports = { apiLimiter, authLimiter };
