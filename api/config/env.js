// src/config/env.js — Environment variable validation
'use strict';

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'BOT_TOKEN'
];

const optional = {
  NODE_ENV: 'development',
  PORT: '3000',
  LOG_LEVEL: 'info',
  JWT_EXPIRES_IN: '30d',
  PLATFORM_FEE: '5000',
  DEPOSIT_AMOUNT: '50000'
};

function validateEnv() {
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Set defaults for optional vars
  for (const [key, val] of Object.entries(optional)) {
    if (!process.env[key]) process.env[key] = val;
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  console.log('✅ Environment variables validated');
}

module.exports = {
  validateEnv,
  env: {
    NODE_ENV: process.env.NODE_ENV,
    PORT: parseInt(process.env.PORT) || 3000,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
    BOT_TOKEN: process.env.BOT_TOKEN,
    WEBAPP_URL: process.env.WEBAPP_URL || '',
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    PAYME_MERCHANT_ID: process.env.PAYME_MERCHANT_ID || '',
    PAYME_KEY: process.env.PAYME_KEY || '',
    CLICK_SERVICE_ID: process.env.CLICK_SERVICE_ID || '',
    CLICK_MERCHANT_ID: process.env.CLICK_MERCHANT_ID || '',
    CLICK_SECRET: process.env.CLICK_SECRET || '',
    PLATFORM_FEE: parseInt(process.env.PLATFORM_FEE) || 5000,
    DEPOSIT_AMOUNT: parseInt(process.env.DEPOSIT_AMOUNT) || 50000,
    isProduction: process.env.NODE_ENV === 'production'
  }
};
