require('dotenv').config();
const pool = require('./db');

async function seed() {
  await pool.query(`
    INSERT INTO restaurants (name, description, address, cuisine, price_category, rating, image_url, status)
    VALUES
    ('Plov Center', 'Toshkentning eng mashhur plov restorani', 'Yunusobod, Toshkent', ARRAY['Uzbek'], '$$', 4.8, 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=400', 'approved'),
    ('Caravan', 'O''zbek va evropa taomlari', 'Chilonzor, Toshkent', ARRAY['Uzbek','European'], '$$', 4.6, 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400', 'approved'),
    ('Furusato', 'Yapon taomlari restorani', 'Mirzo Ulugbek, Toshkent', ARRAY['Asian'], '$$$', 4.7, 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400', 'approved'),
    ('Tandir', 'An''anaviy o''zbek taomlari', 'Shayxontohur, Toshkent', ARRAY['Uzbek'], '$', 4.5, 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400', 'approved'),
    ('Milano', 'Italyan pizza va pasta', 'Yakkasaroy, Toshkent', ARRAY['Italian'], '$$', 4.4, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400', 'approved')
    ON CONFLICT DO NOTHING;
  `);
  console.log('Seed tugadi! 5 ta restoran qoshildi.');
  process.exit(0);
}

seed().catch(console.error);
