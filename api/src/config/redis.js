const Redis = require('ioredis');
const config = require('./env');
const logger = require('./logger');

const redis = new Redis(config.REDIS_URL, {
  retryStrategy: times => Math.min(times * 50, 2000)
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', err => logger.error('Redis error', err));

module.exports = redis;
