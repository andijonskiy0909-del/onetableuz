const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

async function sendTelegramMsg(telegramId, text) {
  try {
    const token = process.env.BOT_TOKEN;
    if (!token || !telegramId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('Telegram xabar xatoligi:', e.message);
  }
}

// ── Bron yaratish ────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, comment, zone_id, pre_order } = req.body;

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    const conflict = await pool.query(
      `SELECT id FROM reservations
       WHERE restaurant_id = $1 AND date = $2 AND time = $3
         AND status != 'cancelled'`,
      [restaurant_id, date, time]
    );

    const resto = await pool.query(
      'SELECT name, capacity FROM restaurants WHERE id = $1',
      [restaurant_id]
    );
    const capacity = resto.rows[0]?.capacity || 50;
    const restaurantName = resto.rows[0]?.name || 'Restoran';

    if (conflict.rows.length >= capacity) {
      return res.status(400).json({ error: 'Bu vaqtda joy mavjud emas' });
    }

    const result = await pool.query(
      `INSERT INTO reservations
       (user_id, restaurant_id, zone_id, date, time, guests, comment, pre_order, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [req.user.id, restaurant_id, zone_id || null, date, time, guests, comment, JSON.stringify(pre_order || [])]
    );

    const booking = result.rows[0];

    // Foydalanuvchi ma'lumotlari
    const userResult = await pool.query(
      'SELECT telegram_id, first_name, last_name FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    // Zona nomi
    let zoneName = '';
    if (zone_id) {
      const zoneRes = await pool.query('SELECT name FROM zones WHERE id = $1', [zone_id]);
      zoneName = zoneRes.rows[0]?.name || '';
    }

    // ✅ Socket.io — dashboard ga real-time xabar
    const io = req.app.get('io');
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', {
        id: booking.id,
        guest_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || "Noma'lum",
        date,
        time,
        guests,
        comment,
        zone_name: zoneName,
        status: 'pending',
        created_at: booking.created_at
      });
      console.log(`Socket: restaurant_${restaurant_id} ga yangi bron xabari yuborildi`);
    }

    // Telegram xabar
    if (user?.telegram_id) {
      const text =
        `🎉 <b>Bron qabul qilindi!</b>\n\n` +
        `🍽 <b>${restaurantName}</b>\n` +
        `📅 Sana: ${date}\n` +
        `⏰ Vaqt: ${time}\n` +
        `👥 Mehmonlar: ${guests} kishi\n` +
        `${zoneName ? `🏠 Zona: ${zoneName}\n` : ''}` +
        `${comment ? `💬 Izoh: ${comment}\n` : ''}` +
        `\n⏳ Restoran tasdiqlaguncha kuting.`;
      sendTelegramMsg(user.telegram_id, text);
    }

    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Foydalanuvchi bronlari ───────────────────────────────────
router.get('/my', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, res.name AS restaurant_name, res.address, res.image_url,
              z.name AS zone_name
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       LEFT JOIN zones z ON r.zone_id = z.id
       WHERE r.user_id = $1
       ORDER BY r.date DESC, r.time DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bronni bekor qilish ──────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const check = await pool.query(
      `SELECT r.*, res.name AS restaurant_name
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!check.rows.length) {
      return res.status(404).json({ error: 'Bron topilmadi' });
    }

    const booking = check.rows[0];
    const bookingDate = new Date(`${booking.date}T${booking.time}`);
    if (bookingDate < new Date()) {
      return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' });
    }

    await pool.query('UPDATE reservations SET status = $1 WHERE id = $2', ['cancelled', req.params.id]);

    // ✅ Socket.io — bekor qilindi xabari
    const io = req.app.get('io');
    if (io) {
      io.to(`restaurant_${booking.restaurant_id}`).emit('reservation_cancelled', {
        id: booking.id
      });
    }

    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows[0]?.telegram_id) {
      const text =
        `🗑 <b>Bron bekor qilindi</b>\n\n` +
        `🍽 ${booking.restaurant_name}\n` +
        `📅 ${booking.date} — ⏰ ${booking.time}`;
      sendTelegramMsg(userResult.rows[0].telegram_id, text);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
