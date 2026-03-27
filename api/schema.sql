-- ═══════════════════════════════════════════════════════════════════
-- OneTable — Production Database Schema v2.0
-- ═══════════════════════════════════════════════════════════════════

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(50),
  language VARCHAR(10) DEFAULT 'uz',
  is_blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Restaurants
CREATE TABLE IF NOT EXISTS restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  address VARCHAR(500),
  phone VARCHAR(50),
  email VARCHAR(255),
  cuisine TEXT[] DEFAULT '{}',
  price_category VARCHAR(10) DEFAULT '$$',
  rating NUMERIC(3,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  image_url TEXT,
  gallery TEXT[] DEFAULT '{}',
  working_hours VARCHAR(200) DEFAULT '10:00-22:00',
  latitude DECIMAL(10,6),
  longitude DECIMAL(10,6),
  capacity INTEGER DEFAULT 50,
  is_premium BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'approved',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Restaurant Owners
CREATE TABLE IF NOT EXISTS restaurant_owners (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(20) DEFAULT 'owner',
  restaurant_id INTEGER REFERENCES restaurants(id),
  telegram_id BIGINT,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Zones (Zal, Veranda, VIP, Terrace)
CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(20) DEFAULT '🪑',
  capacity INTEGER DEFAULT 10,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tables
CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  table_number VARCHAR(20) NOT NULL,
  capacity INTEGER DEFAULT 4,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(restaurant_id, table_number)
);

-- Menu Categories
CREATE TABLE IF NOT EXISTS menu_categories (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Menu Items
CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  prep_time INTEGER DEFAULT 30,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reservations
CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  zone_id INTEGER REFERENCES zones(id),
  table_id INTEGER REFERENCES tables(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 50),
  comment TEXT,
  special_request TEXT,
  food_ready_time TIME,
  pre_order JSONB DEFAULT '[]',
  pre_order_total INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  review_asked BOOLEAN DEFAULT false,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT no_double_booking UNIQUE(table_id, date, time)
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id),
  user_id INTEGER REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  amount INTEGER NOT NULL,
  type VARCHAR(20) DEFAULT 'deposit',
  provider VARCHAR(20),
  transaction_id VARCHAR(255) UNIQUE,
  status VARCHAR(20) DEFAULT 'pending',
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  restaurant_id INTEGER REFERENCES restaurants(id),
  user_id INTEGER REFERENCES users(id),
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user','owner')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  reservation_id INTEGER REFERENCES reservations(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  photo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, reservation_id)
);

-- Availability (Bloklangan vaqtlar)
CREATE TABLE IF NOT EXISTS availability (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME NOT NULL,
  is_blocked BOOLEAN DEFAULT false,
  reason TEXT,
  UNIQUE(restaurant_id, date, time)
);

-- Premium Subscriptions
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

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_date ON reservations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_table_date ON reservations(table_id, date, time);
CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id, is_available);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reservation ON chat_messages(reservation_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_active ON restaurants(is_active, rating DESC);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant ON reviews(restaurant_id);
