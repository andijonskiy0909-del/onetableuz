const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '../src/migrations/001_initial.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Database migrated');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

migrate();
