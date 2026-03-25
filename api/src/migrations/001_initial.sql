-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(50),
  language VARCHAR(10) DEFAULT 'uz',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Restaurant owners
CREATE TABLE IF NOT EXISTS restaurant_owners (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(20) DEFAULT 'owner',
  restaurant_id INTEGER,
  telegram_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Restaurants
CREATE TABLE IF NOT EXISTS restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  address VARCHAR(500),
  phone VARCHAR(50),
  cuisine TEXT[],
  price_category VARCHAR(10) DEFAULT '$$',
  rating NUMERIC(3,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  image_url TEXT,
  gallery TEXT[],
  working_hours VARCHAR(100) DEFAULT '10:00 — 22:00',
  latitude DECIMAL(10,6),
  longitude DECIMAL(10,6),
  capacity INTEGER DEFAULT 50,
  is_premium BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'approved',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Zones
CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(20) DEFAULT '🪑',
  capacity INTEGER DEFAULT 10,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tables
CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
  table_number VARCHAR(20) NOT NULL,
  capacity INTEGER DEFAULT 4,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, table_number)
);

-- Menu categories
CREATE TABLE IF NOT EXISTS menu_categories (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Menu items
CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES menu_categories(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  prep_time INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reservation slots (for atomic availability)
CREATE TABLE IF NOT EXISTS reservation_slots (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME NOT NULL,
  capacity INTEGER NOT NULL,
  reserved INTEGER DEFAULT 0,
  UNIQUE(restaurant_id, date, time)
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
  guests INTEGER NOT NULL CHECK (guests > 0 AND guests <= 50),
  comment TEXT,
  special_request TEXT,
  food_ready_time TIME,
  pre_order JSONB DEFAULT '[]',
  pre_order_total INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  review_asked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  user_id INTEGER REFERENCES users(id),
  sender_type VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  reservation_id INTEGER REFERENCES reservations(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Availability blocks
CREATE TABLE IF NOT EXISTS availability (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  is_blocked BOOLEAN DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, date, time)
);

-- Premium subscriptions
CREATE TABLE IF NOT EXISTS premium_subscriptions (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  plan VARCHAR(20) DEFAULT 'monthly',
  amount INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_date ON reservations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_table_date_time ON reservations(table_id, date, time);
CREATE INDEX IF NOT EXISTS idx_reservation_slots_restaurant_date_time ON reservation_slots(restaurant_id, date, time);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reservation ON chat_messages(reservation_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_premium ON restaurants(is_premium, rating DESC);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);
