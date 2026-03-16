const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// Auth middleware
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

// ── Telegram bildirishnoma yuborish ─────────────────────────
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
    const { restaurant_id, date, time, guests, comment } = req.body;

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    // Conflict tekshiruvi — shu vaqtda joy bormi?
    const conflict = await pool.query(
      `SELECT id FROM reservations
       WHERE restaurant_id = $1 AND date = $2 AND time = $3
         AND status != 'cancelled'`,
      [restaurant_id, date, time]
    );

    // Restoran sig'imini olish
    const resto = await pool.query(
      'SELECT name, capacity FROM restaurants WHERE id = $1',
      [restaurant_id]
    );
    const capacity = resto.rows[0]?.capacity || 50;
    const restaurantName = resto.rows[0]?.name || 'Restoran';

    if (conflict.rows.length >= capacity) {
      return res.status(400).json({ error: 'Bu vaqtda joy mavjud emas' });
    }

    // Bron yaratish
    const result = await pool.query(
      `INSERT INTO reservations
       (user_id, restaurant_id, date, time, guests, comment, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [req.user.id, restaurant_id, date, time, guests, comment]
    );

    const booking = result.rows[0];

    // Foydalanuvchiga Telegram xabar yuborish
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (user?.telegram_id) {
      const text =
        `🎉 <b>Bron qabul qilindi!</b>\n\n` +
        `🍽 <b>${restaurantName}</b>\n` +
        `📅 Sana: ${date}\n` +
        `⏰ Vaqt: ${time}\n` +
        `👥 Mehmonlar: ${guests} kishi\n` +
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
      `SELECT r.*, res.name AS restaurant_name, res.address, res.image_url
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
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
    // Faqat o'z bronini bekor qila oladi
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

    // O'tgan bronni bekor qilib bo'lmaydi
    const bookingDate = new Date(`${booking.date}T${booking.time}`);
    if (bookingDate < new Date()) {
      return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' });
    }

    await pool.query(
      'UPDATE reservations SET status = $1 WHERE id = $2',
      ['cancelled', req.params.id]
    );

    // Foydalanuvchiga xabar
    const userResult = await pool.query(
      'SELECT telegram_id FROM users WHERE id = $1',
      [req.user.id]
    );
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
