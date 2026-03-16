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

    CREATE TABLE IF NOT EXISTS restaurant_owners (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      restaurant_id INTEGER REFERENCES restaurants(id),
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
  `);

  // Test owner qoshish
  await pool.query(`
    INSERT INTO restaurant_owners (email, password_hash, restaurant_id)
    VALUES (
      'admin@onetable.uz',
      '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uRpkJ8VNC',
      1
    )
    ON CONFLICT (email) DO NOTHING;
  `);

  console.log('✅ Jadvallar tayyor!');
  console.log('✅ Owner: admin@onetable.uz | parol: password');
  process.exit(0);
}

migrate().catch(console.error);
```

**GitHub da:**
1. `api/src/migrate.js` → Edit → hammasini o'chiring → bu kodni paste → Commit

**Railway da:**
1. API servis → **Settings** → **Deploy** → Start Command ni o'zgartiring:
```
node src/migrate.js
```
2. **Deploy** bosing — 10 soniyada tugadi
3. Keyin Start Command ni qaytaring:
```
node src/index.js
