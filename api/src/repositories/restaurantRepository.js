const db = require('../config/database');

class RestaurantRepository {
  async findById(id) {
    const result = await db.query('SELECT * FROM restaurants WHERE id = $1', [id]);
    return result.rows[0];
  }

  async findAll(filters = {}) {
    let query = 'SELECT * FROM restaurants WHERE status = $1';
    const values = ['approved'];
    if (filters.cuisine) { query += ' AND $2 = ANY(cuisine)'; values.push(filters.cuisine); }
    if (filters.price_category) { query += ` AND price_category = $${values.length + 1}`; values.push(filters.price_category); }
    if (filters.is_premium) { query += ' AND is_premium = true'; }
    query += ' ORDER BY rating DESC, is_premium DESC LIMIT 100';
    const result = await db.query(query, values);
    return result.rows;
  }

  async updateLocation(id, lat, lng) {
    const result = await db.query('UPDATE restaurants SET latitude = $1, longitude = $2 WHERE id = $3 RETURNING *', [lat, lng, id]);
    return result.rows[0];
  }
}

module.exports = new RestaurantRepository();
