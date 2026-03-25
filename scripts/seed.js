const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

async function seed() {
  try {
    // Demo restaurants
    const demoRestaurants = [
      { name: 'Plov Center', address: 'Yunusobod, Toshkent', cuisine: ['Uzbek'], price_category: '$$', capacity: 50, image_url: 'https://images.unsplash.com/photo-1600891964092-4316c288032e' },
      { name: 'Caravan', address: 'Chilonzor, Toshkent', cuisine: ['Uzbek','European'], price_category: '$$', capacity: 60, image_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5' },
      { name: 'Furusato', address: 'Mirzo Ulugbek, Toshkent', cuisine: ['Asian'], price_category: '$$$', capacity: 40, image_url: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c' },
      { name: 'Tandir', address: 'Shayxontohur, Toshkent', cuisine: ['Uzbek'], price_category: '$', capacity: 80, image_url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445' },
      { name: 'Milano', address: 'Yakkasaroy, Toshkent', cuisine: ['Italian'], price_category: '$$', capacity: 45, image_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38' }
    ];
    for (const r of demoRestaurants) {
      await pool.query(
        `INSERT INTO restaurants (name, address, cuisine, price_category, capacity, image_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved') ON CONFLICT DO NOTHING`,
        [r.name, r.address, r.cuisine, r.price_category, r.capacity, r.image_url]
      );
    }

    // Admin
    const adminHash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [process.env.ADMIN_EMAIL || 'admin@onetable.uz', adminHash, 'Admin']
    );

    console.log('✅ Seed completed');
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await pool.end();
  }
}

seed();
