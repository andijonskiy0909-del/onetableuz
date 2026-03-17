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
      capacity INTEGER DEFAULT 50,
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
    CREATE TABLE IF NOT EXISTS restaurant_owners (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      restaurant_id INTEGER REFERENCES restaurants(id),
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
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      restaurant_id INTEGER REFERENCES restaurants(id),
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      price INTEGER,
      description TEXT,
      is_available BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS availability (
      id SERIAL PRIMARY KEY,
      restaurant_id INTEGER REFERENCES restaurants(id),
      date DATE NOT NULL,
      time TIME NOT NULL,
      is_blocked BOOLEAN DEFAULT false,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(restaurant_id, date, time)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      reservation_id INTEGER REFERENCES reservations(id),
      restaurant_id INTEGER REFERENCES restaurants(id),
      user_id INTEGER REFERENCES users(id),
      amount INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      provider VARCHAR(50),
      transaction_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      restaurant_id INTEGER REFERENCES restaurants(id),
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const resto = await pool.query(`
    INSERT INTO restaurants (name, address, cuisine, price_category)
    VALUES ('Plov Center', 'Yunusobod, Toshkent', ARRAY['Uzbek'], '$$')
    ON CONFLICT DO NOTHING
    RETURNING id;
  `);

  const restoId = resto.rows[0]?.id ||
    (await pool.query('SELECT id FROM restaurants LIMIT 1')).rows[0]?.id || 1;

  await pool.query(`
    DELETE FROM restaurant_owners WHERE email = 'admin@onetable.uz';
  `);

  // Yangi hash yaratib qo'shamiz
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('secret123', 10);

  await pool.query(`
    INSERT INTO restaurant_owners (email, password_hash, restaurant_id)
    VALUES ($1, $2, $3);
  `, ['admin@onetable.uz', hash, restoId]);

  console.log('✅ Barcha jadvallar tayyor!');
  console.log('✅ Owner: admin@onetable.uz | parol: secret123');
}

migrate().catch(console.error);
```

GitHub da `api/src/migrate.js` ni shu kod bilan almashtiring → Commit!

Keyin Railway → Start Command:
```
node src/migrate.js; node src/index.js
