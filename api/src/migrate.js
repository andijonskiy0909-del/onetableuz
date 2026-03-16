require('dotenv').config();
const pool = require('./db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      address VARCHAR(255),
      phone VARCHAR(50),
      cuisine TEXT[],
      price_category VARCHAR(10),
      rating DECIMAL(3,2) DEFAULT 4.5,
      image_url TEXT,
      status VARCHAR(50) DEFAULT 'approved',
      is_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      phone VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      restaurant_id INTEGER REFERENCES restaurants(id),
      date DATE NOT NULL,
      time TIME NOT NULL,
      guests INTEGER NOT NULL,
      comment TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Migration tugadi!');
  process.exit(0);
}

migrate().catch(console.error);
