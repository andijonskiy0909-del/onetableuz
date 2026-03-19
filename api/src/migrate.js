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
      full_name VARCHAR(255),
      phone VARCHAR(50),
      role VARCHAR(20) DEFAULT 'owner',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS zones (
      id SERIAL PRIMARY KEY,
      restaurant_id INTEGER REFERENCES restaurants(id),
      name VARCHAR(100) NOT NULL,
      description TEXT,
      capacity INTEGER DEFAULT 10,
      icon VARCHAR(10) DEFAULT '🪑',
      is_available BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tables (
      id SERIAL PRIMARY KEY,
      restaurant_id INTEGER REFERENCES restaurants(id),
      zone_id INTEGER REFERENCES zones(id),
      table_number INTEGER NOT NULL,
      capacity INTEGER DEFAULT 4,
      is_available BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      restaurant_id INTEGER REFERENCES restaurants(id),
      zone_id INTEGER REFERENCES zones(id),
      table_id INTEGER REFERENCES tables(id),
      date DATE NOT NULL,
      time TIME NOT NULL,
      guests INTEGER NOT NULL,
      comment TEXT,
      pre_order JSONB DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS premium_subscriptions (
      id SERIAL PRIMARY KEY,
      restaurant_id INTEGER REFERENCES restaurants(id),
      plan VARCHAR(20) DEFAULT 'monthly',
      amount INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      started_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Test restoran
  const resto = await pool.query(`
    INSERT INTO restaurants (name, address, cuisine, price_category, capacity)
    VALUES ('Plov Center', 'Yunusobod, Toshkent', ARRAY['Uzbek'], '$$', 50)
    ON CONFLICT DO NOTHING RETURNING id;
  `);
  const restoId = resto.rows[0]?.id ||
    (await pool.query('SELECT id FROM restaurants LIMIT 1')).rows[0]?.id || 1;

  // Zonalar
  await pool.query(`
    INSERT INTO zones (restaurant_id, name, description, capacity, icon) VALUES
    ($1, 'Asosiy zal', 'Qulay va keng zal', 40, '🪑'),
    ($1, 'VIP xona', 'Maxfiy va hashamatli', 10, '👑'),
    ($1, 'Terrassa', 'Ochiq havo', 20, '🌿'),
    ($1, 'Bolalar maydoni', 'Bolalar uchun', 15, '🎠')
    ON CONFLICT DO NOTHING;
  `, [restoId]);

  // Stollar
  const zones = await pool.query('SELECT id, name FROM zones WHERE restaurant_id = $1', [restoId]);
  for (const zone of zones.rows) {
    const count = zone.name === 'VIP xona' ? 3 : zone.name === 'Bolalar maydoni' ? 4 : 8;
    for (let i = 1; i <= count; i++) {
      await pool.query(`
        INSERT INTO tables (restaurant_id, zone_id, table_number, capacity)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
      `, [restoId, zone.id, i, zone.name === 'VIP xona' ? 6 : 4]);
    }
  }

  // Test menyu
  await pool.query(`
    INSERT INTO menu_items (restaurant_id, name, category, price, description) VALUES
    ($1, 'Osh', 'Asosiy taomlar', 45000, 'Klassik o''zbek oshi'),
    ($1, 'Shashlik', 'Asosiy taomlar', 60000, 'Qo''zichoq shashlik'),
    ($1, 'Lag''mon', 'Asosiy taomlar', 35000, 'Qo''lda tayyorlangan'),
    ($1, 'Manti', 'Asosiy taomlar', 40000, 'Bug''da pishirilgan'),
    ($1, 'Choy', 'Ichimliklar', 8000, 'Ko''k choy'),
    ($1, 'Limonad', 'Ichimliklar', 15000, 'Tabiiy limonad'),
    ($1, 'Salat', 'Salatlar', 25000, 'Taze sabzavot salati')
    ON CONFLICT DO NOTHING;
  `, [restoId]);

  // Admin va owner
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('secret123', 10);
  await pool.query(`
    INSERT INTO restaurant_owners (email, password_hash, restaurant_id, full_name, role)
    VALUES ($1, $2, $3, 'Admin', 'admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = $2;
  `, ['admin@onetable.uz', hash, restoId]);

  const hash2 = await bcrypt.hash('owner123', 10);
  await pool.query(`
    INSERT INTO restaurant_owners (email, password_hash, restaurant_id, full_name, role)
    VALUES ($1, $2, $3, 'Plov Center Egasi', 'owner')
    ON CONFLICT (email) DO UPDATE SET password_hash = $2;
  `, ['owner@plovcenter.uz', hash2, restoId]);

  console.log('✅ Barcha jadvallar tayyor!');
  console.log('✅ Admin: admin@onetable.uz | parol: secret123');
  console.log('✅ Owner: owner@plovcenter.uz | parol: owner123');
}

migrate().catch(console.error);
