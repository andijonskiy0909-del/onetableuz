const dotenv = require('dotenv');
dotenv.config();

const required = ['DATABASE_URL', 'JWT_SECRET', 'BOT_TOKEN', 'PAYME_MERCHANT_ID', 'PAYME_KEY', 'CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL === 'true',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  BOT_TOKEN: process.env.BOT_TOKEN,
  WEBAPP_URL: process.env.WEBAPP_URL,
  API_URL: process.env.API_URL,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  PAYME_MERCHANT_ID: process.env.PAYME_MERCHANT_ID,
  PAYME_KEY: process.env.PAYME_KEY,
  PAYME_URL: process.env.PAYME_URL,
  CLICK_SERVICE_ID: process.env.CLICK_SERVICE_ID,
  CLICK_MERCHANT_ID: process.env.CLICK_MERCHANT_ID,
  CLICK_SECRET: process.env.CLICK_SECRET,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH
};
