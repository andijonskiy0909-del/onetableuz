const dotenv = require('dotenv');
dotenv.config();

const requiredEnv = [
  'DATABASE_URL', 'JWT_SECRET', 'BOT_TOKEN',
  'PAYME_MERCHANT_ID', 'PAYME_KEY',
  'CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET'
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing env: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
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
  PAYME_URL: process.env.PAYME_URL || (process.env.NODE_ENV === 'production' ? 'https://checkout.paycom.uz' : 'https://test.paycom.uz'),
  CLICK_SERVICE_ID: process.env.CLICK_SERVICE_ID,
  CLICK_MERCHANT_ID: process.env.CLICK_MERCHANT_ID,
  CLICK_SECRET: process.env.CLICK_SECRET
};
