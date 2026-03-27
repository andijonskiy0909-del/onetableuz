const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error:', err);
});

pool.on('connect', () => {
  logger.debug('New DB connection established');
});

// Test connection
pool.query('SELECT NOW()').then(() => {
  logger.info('✅ Database connected successfully');
}).catch(err => {
  logger.error('❌ Database connection failed:', err.message);
  process.exit(1);
});

// Transaction helper
pool.transaction = async (callback) => {
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
};

module.exports = pool;
