-- ============================================================
-- OneTable — Full PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- USERS (Mini App foydalanuvchilari) ----------
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT UNIQUE NOT NULL,
  first_name      VARCHAR(120),
  last_name       VARCHAR(120),
  username        VARCHAR(120),
  phone           VARCHAR(30),
  language        VARCHAR(8) DEFAULT 'uz',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- ---------- OWNERS (Dashboard foydalanuvchilari) ----------
CREATE TABLE IF NOT EXISTS owners (
  id              BIGSERIAL PRIMARY KEY,
  full_name       VARCHAR(180) NOT NULL,
  email           VARCHAR(180) UNIQUE NOT NULL,
  phone           VARCHAR(30),
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) DEFAULT 'owner',
  restaurant_id   BIGINT,
  telegram_id     BIGINT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_owners_email ON owners(email);

-- ---------- RESTAURANTS ----------
CREATE TABLE IF NOT EXISTS restaurants (
  id                BIGSERIAL PRIMARY KEY,
  owner_id          BIGINT REFERENCES owners(id) ON DELETE SET NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  cuisine           TEXT[] DEFAULT '{}',
  price_category    VARCHAR(8) DEFAULT '$$',
  phone             VARCHAR(30),
  email             VARCHAR(180),
  address           TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  working_hours     VARCHAR(60) DEFAULT '10:00-23:00',
  capacity          INTEGER DEFAULT 50,
  image_url         TEXT,
  cover_url         TEXT,
  gallery           TEXT[] DEFAULT '{}',
  rating            NUMERIC(3,2) DEFAULT 0,
  review_count      INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT TRUE,
  is_premium        BOOLEAN DEFAULT FALSE,
  premium_until     TIMESTAMP,
  has_parking       BOOLEAN DEFAULT FALSE,
  has_wifi          BOOLEAN DEFAULT FALSE,
  has_kids_area     BOOLEAN DEFAULT FALSE,
  status            VARCHAR(20) DEFAULT 'approved',
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rest_owner ON restaurants(owner_id);
CREATE INDEX IF NOT EXISTS idx_rest_active ON restaurants(is_active, status);

ALTER TABLE owners
  ADD CONSTRAINT owners_restaurant_fk
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- ---------- ZONES ----------
CREATE TABLE IF NOT EXISTS zones (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  description     TEXT,
  capacity        INTEGER DEFAULT 20,
  is_available    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zones_rest ON zones(restaurant_id);

-- ---------- TABLES ----------
CREATE TABLE IF NOT EXISTS tables (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id         BIGINT REFERENCES zones(id) ON DELETE SET NULL,
  table_number    VARCHAR(20) NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 4,
  is_available    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (restaurant_id, table_number)
);
CREATE INDEX IF NOT EXISTS idx_tables_rest ON tables(restaurant_id);

-- ---------- MENU ----------
CREATE TABLE IF NOT EXISTS menu_items (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category        VARCHAR(120),
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url       TEXT,
  is_available    BOOLEAN DEFAULT TRUE,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_rest ON menu_items(restaurant_id);

-- ---------- RESERVATIONS ----------
CREATE TABLE IF NOT EXISTS reservations (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id     BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id           BIGINT REFERENCES zones(id) ON DELETE SET NULL,
  table_id          BIGINT REFERENCES tables(id) ON DELETE SET NULL,
  date              DATE NOT NULL,
  time              TIME NOT NULL,
  guests            INTEGER NOT NULL DEFAULT 2,
  comment           TEXT,
  special_request   TEXT,
  pre_order         JSONB DEFAULT '[]'::jsonb,
  pre_order_total   NUMERIC(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'pending',
  payment_status    VARCHAR(20) DEFAULT 'unpaid',
  review_asked      BOOLEAN DEFAULT FALSE,
  expires_at        TIMESTAMP DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_res_rest_date ON reservations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);

-- ---------- AVAILABILITY (blocked times) ----------
CREATE TABLE IF NOT EXISTS availability (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  time            TIME NOT NULL,
  is_blocked      BOOLEAN DEFAULT TRUE,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_avail_rest ON availability(restaurant_id, date);

-- ---------- REVIEWS ----------
CREATE TABLE IF NOT EXISTS reviews (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  reservation_id  BIGINT REFERENCES reservations(id) ON DELETE SET NULL,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  photo_url       TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_rest ON reviews(restaurant_id);

-- ---------- REELS ----------
CREATE TABLE IF NOT EXISTS reels (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type            VARCHAR(10) DEFAULT 'video',
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  caption         TEXT,
  views           INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  is_published    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reels_rest ON reels(restaurant_id);

-- ---------- FAVORITES ----------
CREATE TABLE IF NOT EXISTS favorites (
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at      TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, restaurant_id)
);

-- ---------- PREMIUM REQUESTS ----------
CREATE TABLE IF NOT EXISTS premium_requests (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  plan            VARCHAR(20) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ---------- TRIGGERS ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rest_updated ON restaurants;
CREATE TRIGGER trg_rest_updated BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_res_updated ON reservations;
CREATE TRIGGER trg_res_updated BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
