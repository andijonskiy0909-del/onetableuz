CREATE TABLE users (
 id SERIAL PRIMARY KEY,
 telegram_id BIGINT UNIQUE,
 name TEXT,
 phone TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE restaurants (
 id SERIAL PRIMARY KEY,
 name TEXT,
 description TEXT,
 capacity INTEGER,
 address TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reservations (
 id SERIAL PRIMARY KEY,
 user_id INTEGER REFERENCES users(id),
 restaurant_id INTEGER REFERENCES restaurants(id),
 date DATE NOT NULL,
 time TIME NOT NULL,
 guests INTEGER NOT NULL,
 status VARCHAR(20) DEFAULT 'pending',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
