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

// ── Bron yaratish ────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, comment } = req.body;

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    // Bronni bazaga yozish
    const result = await pool.query(
      `INSERT INTO reservations 
       (user_id, restaurant_id, date, time, guests, comment, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') 
       RETURNING *`,
      [req.user.id, restaurant_id, date, time, guests, comment]
    );

    const reservation = result.rows[0];

    // Telegram bildirishnoma yuborish
    try {
      const userResult = await pool.query(
        'SELECT telegram_id FROM users WHERE id = $1',
        [req.user.id]
      );
      const restResult = await pool.query(
        'SELECT name FROM restaurants WHERE id = $1',
        [restaurant_id]
      );

      const telegramId = userResult.rows[0]?.telegram_id;
      const restaurantName = restResult.rows[0]?.name || 'Restoran';

      if (telegramId) {
        // Bot ni import qilamiz (bot alohida repoda bo'lgani uchun HTTP orqali)
        await sendTelegramNotification(telegramId, 'new', {
          restaurant_name: restaurantName,
          date,
          time,
          guests
        });
      }
    } catch (notifyErr) {
      // Bildirishnoma xatosi bronni to'xtatmasin
      console.error('Bildirishnoma xatoligi:', notifyErr.message);
    }

    res.json(reservation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Foydalanuvchi bronlari ───────────────────────────────────
router.get('/my', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, res.name as restaurant_name, res.address, res.image_url 
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
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
    const result = await pool.query(
      `UPDATE reservations 
       SET status = 'cancelled' 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bron topilmadi' });
    }

    // Bekor qilish bildirishnomasi
    try {
      const b = result.rows[0];
      const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.id]);
      const restResult = await pool.query('SELECT name FROM restaurants WHERE id = $1', [b.restaurant_id]);
      const telegramId = userResult.rows[0]?.telegram_id;
      if (telegramId) {
        await sendTelegramNotification(telegramId, 'cancelled', {
          restaurant_name: restResult.rows[0]?.name || 'Restoran',
          date: b.date,
          time: b.time,
          guests: b.guests
        });
      }
    } catch (e) {
      console.error('Bekor qilish bildirishnomasi xatoligi:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Telegram xabar yuborish (Bot API orqali) ─────────────────
async function sendTelegramNotification(telegramId, type, data) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return;

  const msgs = {
    uz: {
      new: `🎉 Bron qabul qilindi!\n\n🍽 ${data.restaurant_name}\n📅 ${data.date}\n⏰ ${data.time}\n👥 ${data.guests} kishi\n\n⏳ Restoran tasdiqlashini kuting.`,
      confirmed: `✅ Broningiz tasdiqlandi!\n\n🍽 ${data.restaurant_name}\n📅 ${data.date} — ⏰ ${data.time}\n\nRestoranga vaqtida keling! 🙌`,
      cancelled: `❌ Broningiz bekor qilindi.\n\n🍽 ${data.restaurant_name}\n📅 ${data.date} — ⏰ ${data.time}`
    }
  };

  const text = msgs.uz[type];
  if (!text) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Telegram API xatosi:', err);
  }
}

module.exports = router;
```

**Shu faylni GitHub da `api/src/routes/reservations.js` ga paste qiling.**

Keyin `.env` faylida (Railway environment variables) `BOT_TOKEN` borligini tekshiring — u allaqachon bor bo'lishi kerak. Railway da:
```
Settings → Variables → BOT_TOKEN = sizning_bot_tokeningiz
