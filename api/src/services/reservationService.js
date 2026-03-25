const reservationRepo = require('../repositories/reservationRepository');
const restaurantRepo = require('../repositories/restaurantRepository');
const db = require('../config/database');
const telegramService = require('./telegramService');
const logger = require('../config/logger');

class ReservationService {
  async createReservation(userId, data) {
    const { restaurant_id, date, time, guests, comment, zone_id, pre_order } = data;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get restaurant
      const restaurant = await restaurantRepo.findById(restaurant_id);
      if (!restaurant || restaurant.status !== 'approved') throw new Error('Restaurant not found');

      // Check slot availability (atomic update)
      const slotResult = await client.query(
        `UPDATE reservation_slots
         SET reserved = reserved + $1
         WHERE restaurant_id = $2 AND date = $3 AND time = $4
           AND reserved + $1 <= capacity
         RETURNING *`,
        [guests, restaurant_id, date, time]
      );
      if (slotResult.rows.length === 0) {
        throw new Error('No available slots at this time');
      }

      // Check blocked times
      const blocked = await client.query(
        'SELECT 1 FROM availability WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true',
        [restaurant_id, date, time]
      );
      if (blocked.rows.length) throw new Error('This time is blocked');

      // Find a table (simplified: just pick first available with capacity)
      const tableResult = await client.query(
        `SELECT t.id FROM tables t
         LEFT JOIN reservations r ON r.table_id = t.id AND r.date = $1 AND r.time = $2 AND r.status NOT IN ('cancelled')
         WHERE t.restaurant_id = $3 AND t.capacity >= $4 AND r.id IS NULL
         LIMIT 1`,
        [date, time, restaurant_id, guests]
      );
      const tableId = tableResult.rows[0]?.id;
      if (!tableId) throw new Error('No suitable table');

      // Create reservation
      const reservation = await reservationRepo.create({
        user_id: userId,
        restaurant_id,
        zone_id,
        table_id: tableId,
        date,
        time,
        guests,
        comment,
        pre_order: JSON.stringify(pre_order || []),
        status: 'pending',
        payment_status: 'unpaid'
      });

      await client.query('COMMIT');

      // Notify user via Telegram
      telegramService.notifyUser(userId, 'new_reservation', {
        restaurant_name: restaurant.name,
        date, time, guests, comment
      }).catch(e => logger.error('Telegram notify failed', e));

      // Emit via socket.io (if available)
      const io = require('../app').io;
      if (io) io.to(`restaurant_${restaurant_id}`).emit('new_reservation', reservation);

      return reservation;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new ReservationService();
