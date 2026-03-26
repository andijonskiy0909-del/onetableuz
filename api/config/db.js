// src/config/db.js — PostgreSQL connection pool
'use strict';

const { Pool } = require('pg');
const { env } = require('./env');
const logger = require('./logger');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.isProduction ? { rejectUnauthorized: false } : false,
  max: 20,               // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('connect', () => {
  logger.debug('New DB connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

// Health check
async function checkDB() {
  try {
    await pool.query('SELECT 1');
    logger.info('✅ Database connected');
  } catch (err) {
    logger.error('❌ Database connection failed', { error: err.message });
    process.exit(1);
  }
}

// Transaction helper
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, checkDB, withTransaction };
