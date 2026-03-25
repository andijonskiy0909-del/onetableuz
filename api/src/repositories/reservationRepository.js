const db = require('../config/database');

class ReservationRepository {
  async create(data) {
    const { user_id, restaurant_id, zone_id, table_id, date, time, guests, comment, pre_order, status, payment_status } = data;
    const query = `
      INSERT INTO reservations (user_id, restaurant_id, zone_id, table_id, date, time, guests, comment, pre_order, status, payment_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
    `;
    const values = [user_id, restaurant_id, zone_id, table_id, date, time, guests, comment, pre_order, status, payment_status];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  async findByUser(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const query = `
      SELECT r.*, res.name AS restaurant_name, res.address, res.image_url, z.name AS zone_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      LEFT JOIN zones z ON r.zone_id = z.id
      WHERE r.user_id = $1
      ORDER BY r.date DESC, r.time DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await db.query(query, [userId, limit, offset]);
    return result.rows;
  }

  async findByRestaurant(restaurantId, filters = {}) {
    let query = `
      SELECT r.*, u.first_name, u.last_name, u.phone, z.name AS zone_name
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN zones z ON r.zone_id = z.id
      WHERE r.restaurant_id = $1
    `;
    const values = [restaurantId];
    let idx = 2;
    if (filters.date) { query += ` AND r.date = $${idx}`; values.push(filters.date); idx++; }
    if (filters.status) { query += ` AND r.status = $${idx}`; values.push(filters.status); idx++; }
    query += ` ORDER BY r.date ASC, r.time ASC LIMIT 100`;
    const result = await db.query(query, values);
    return result.rows;
  }

  async updateStatus(id, status) {
    const result = await db.query('UPDATE reservations SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    return result.rows[0];
  }

  async findById(id) {
    const result = await db.query('SELECT * FROM reservations WHERE id = $1', [id]);
    return result.rows[0];
  }
}

module.exports = new ReservationRepository();
