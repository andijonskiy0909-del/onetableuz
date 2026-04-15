-- ============================================================
-- OneTable — Full PostgreSQL Schema v3.0
-- Production-ready with proper indexes, constraints, triggers
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS (Mini App / Customer) ──
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT UNIQUE,
  first_name      VARCHAR(120),
  last_name       VARCHAR(120),
  username        VARCHAR(120),
  email           VARCHAR(180),
  phone           VARCHAR(30),
  avatar_url      TEXT,
  language        VARCHAR(8) DEFAULT 'uz',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── OWNERS (Dashboard) ──
CREATE TABLE IF NOT EXISTS owners (
  id              BIGSERIAL PRIMARY KEY,
  full_name       VARCHAR(180) NOT NULL,
  email           VARCHAR(180) UNIQUE NOT NULL,
  phone           VARCHAR(30),
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) DEFAULT 'owner',
  avatar_url      TEXT,
  restaurant_id   BIGINT,
  telegram_id     BIGINT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_owners_email ON owners(email);

-- ── ADMINS ──
CREATE TABLE IF NOT EXISTS admins (
  id              BIGSERIAL PRIMARY KEY,
  full_name       VARCHAR(180) NOT NULL,
  email           VARCHAR(180) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) DEFAULT 'admin',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── RESTAURANTS ──
CREATE TABLE IF NOT EXISTS restaurants (
  id                BIGSERIAL PRIMARY KEY,
  owner_id          BIGINT REFERENCES owners(id) ON DELETE SET NULL,
  name              VARCHAR(200) NOT NULL,
  slug              VARCHAR(200),
  description       TEXT,
  cuisine           TEXT[] DEFAULT '{}',
  price_category    VARCHAR(8) DEFAULT '$$',
  phone             VARCHAR(30),
  email             VARCHAR(180),
  address           TEXT,
  city              VARCHAR(100) DEFAULT 'Toshkent',
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  working_hours     VARCHAR(60) DEFAULT '10:00-23:00',
  capacity          INTEGER DEFAULT 50,
  image_url         TEXT,
  cover_url         TEXT,
  logo_url          TEXT,
  gallery           TEXT[] DEFAULT '{}',
  rating            NUMERIC(3,2) DEFAULT 0,
  review_count      INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT TRUE,
  is_premium        BOOLEAN DEFAULT FALSE,
  is_demo           BOOLEAN DEFAULT FALSE,
  premium_until     TIMESTAMP,
  has_parking       BOOLEAN DEFAULT FALSE,
  has_wifi          BOOLEAN DEFAULT FALSE,
  has_kids_area     BOOLEAN DEFAULT FALSE,
  has_outdoor       BOOLEAN DEFAULT FALSE,
  has_live_music    BOOLEAN DEFAULT FALSE,
  deposit_amount    NUMERIC(12,2) DEFAULT 0,
  deposit_required  BOOLEAN DEFAULT FALSE,
  min_guests        INTEGER DEFAULT 1,
  max_guests        INTEGER DEFAULT 20,
  status            VARCHAR(20) DEFAULT 'pending',
  rejection_reason  TEXT,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rest_owner ON restaurants(owner_id);
CREATE INDEX IF NOT EXISTS idx_rest_active ON restaurants(is_active, status);
CREATE INDEX IF NOT EXISTS idx_rest_slug ON restaurants(slug);
CREATE INDEX IF NOT EXISTS idx_rest_city ON restaurants(city);

ALTER TABLE owners
  ADD CONSTRAINT fk_owners_restaurant
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- ── ZONES ──
CREATE TABLE IF NOT EXISTS zones (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  description     TEXT,
  capacity        INTEGER DEFAULT 20,
  is_available    BOOLEAN DEFAULT TRUE,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zones_rest ON zones(restaurant_id);

-- ── TABLES ──
CREATE TABLE IF NOT EXISTS tables (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id         BIGINT REFERENCES zones(id) ON DELETE SET NULL,
  table_number    VARCHAR(20) NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 4,
  min_guests      INTEGER DEFAULT 1,
  is_available    BOOLEAN DEFAULT TRUE,
  shape           VARCHAR(20) DEFAULT 'round',
  position_x      INTEGER,
  position_y      INTEGER,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (restaurant_id, table_number)
);
CREATE INDEX IF NOT EXISTS idx_tables_rest ON tables(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tables_zone ON tables(zone_id);

-- ── MENU ──
CREATE TABLE IF NOT EXISTS menu_items (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category        VARCHAR(120),
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url       TEXT,
  is_available    BOOLEAN DEFAULT TRUE,
  is_popular      BOOLEAN DEFAULT FALSE,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_rest ON menu_items(restaurant_id);

-- ── RESERVATIONS ──
CREATE TABLE IF NOT EXISTS reservations (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id     BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  zone_id           BIGINT REFERENCES zones(id) ON DELETE SET NULL,
  table_id          BIGINT REFERENCES tables(id) ON DELETE SET NULL,
  date              DATE NOT NULL,
  time              TIME NOT NULL,
  end_time          TIME,
  guests            INTEGER NOT NULL DEFAULT 2,
  comment           TEXT,
  special_request   TEXT,
  pre_order         JSONB DEFAULT '[]'::jsonb,
  pre_order_total   NUMERIC(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','cancelled','completed','noshow','waiting_payment')),
  payment_status    VARCHAR(20) DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','paid','refunded','not_required')),
  deposit_amount    NUMERIC(12,2) DEFAULT 0,
  review_asked      BOOLEAN DEFAULT FALSE,
  cancelled_by      VARCHAR(20),
  cancel_reason     TEXT,
  confirmed_at      TIMESTAMP,
  completed_at      TIMESTAMP,
  expires_at        TIMESTAMP DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_res_rest_date ON reservations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_res_expires ON reservations(expires_at) WHERE status = 'pending';

-- ── AVAILABILITY (blocked times) ──
CREATE TABLE IF NOT EXISTS availability (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  time            TIME NOT NULL,
  is_blocked      BOOLEAN DEFAULT TRUE,
  reason          TEXT,
  UNIQUE (restaurant_id, date, time)
);
CREATE INDEX IF NOT EXISTS idx_avail_rest ON availability(restaurant_id, date);

-- ── REVIEWS ──
CREATE TABLE IF NOT EXISTS reviews (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  reservation_id  BIGINT REFERENCES reservations(id) ON DELETE SET NULL,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  photo_url       TEXT,
  owner_reply     TEXT,
  is_visible      BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_rest ON reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);

-- ── REELS ──
CREATE TABLE IF NOT EXISTS reels (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type            VARCHAR(10) DEFAULT 'video' CHECK (type IN ('video','image')),
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  caption         TEXT,
  views           INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  is_published    BOOLEAN DEFAULT TRUE,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reels_rest ON reels(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reels_published ON reels(is_published, created_at DESC);

-- ── FAVORITES ──
CREATE TABLE IF NOT EXISTS favorites (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);

-- ── PREMIUM REQUESTS ──
CREATE TABLE IF NOT EXISTS premium_requests (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  owner_id        BIGINT REFERENCES owners(id),
  plan            VARCHAR(20) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  payment_proof   TEXT,
  notes           TEXT,
  processed_by    BIGINT REFERENCES admins(id),
  processed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── NOTIFICATIONS ──
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  owner_id        BIGINT REFERENCES owners(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,
  title           VARCHAR(200),
  message         TEXT,
  data            JSONB,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_owner ON notifications(owner_id, is_read);

-- ── ACTIVITY LOG ──
CREATE TABLE IF NOT EXISTS activity_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_type      VARCHAR(20) NOT NULL,
  actor_id        BIGINT NOT NULL,
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       BIGINT,
  metadata        JSONB,
  ip_address      VARCHAR(45),
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

-- ── TRIGGERS ──
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_owners_updated ON owners;
CREATE TRIGGER trg_owners_updated BEFORE UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_rest_updated ON restaurants;
CREATE TRIGGER trg_rest_updated BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_res_updated ON reservations;
CREATE TRIGGER trg_res_updated BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_reviews_updated ON reviews;
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── SEED: Default admin ──
INSERT INTO admins (full_name, email, password_hash, role)
VALUES ('Admin', 'admin@onetable.uz', '$2a$10$placeholder_change_on_first_login', 'superadmin')
ON CONFLICT (email) DO NOTHING;
