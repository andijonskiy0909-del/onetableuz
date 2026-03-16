const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Owner auth middleware
const ownerAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
    req.owner = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email va parol kerak' });

    const result = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email = $1',
      [email]
    );
    if (!result.rows.length)
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });

    const owner = result.rows[0];
    const valid = await bcrypt.compare(password, owner.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });

    const token = jwt.sign(
      { id: owner.id, role: 'owner', restaurant_id: owner.restaurant_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, owner: { id: owner.id, email: owner.email, restaurant_id: owner.restaurant_id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bronlar ro'yxati ─────────────────────────────────────────
router.get('/reservations', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, u.telegram_id,
              res.name AS restaurant_name
       FROM reservations r
       JOIN users u ON r.user_id = u.id
       JOIN restaurants res ON r.restaurant_id = res.id
       WHERE r.restaurant_id = $1
       ORDER BY r.date DESC, r.time DESC`,
      [req.owner.restaurant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bronni tasdiqlash yoki rad etish ─────────────────────────
router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'cancelled'].includes(status))
      return res.status(400).json({ error: 'Status: confirmed yoki cancelled' });

    // Faqat o'z restoran bronini o'zgartira oladi
    const check = await pool.query(
      'SELECT * FROM reservations WHERE id = $1 AND restaurant_id = $2',
      [req.params.id, req.owner.restaurant_id]
    );
    if (!check.rows.length)
      return res.status(404).json({ error: 'Bron topilmadi' });

    await pool.query(
      'UPDATE reservations SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );

    // Foydalanuvchiga Telegram xabar
    const booking = check.rows[0];
    const userResult = await pool.query(
      'SELECT telegram_id FROM users WHERE id = $1',
      [booking.user_id]
    );
    const restoResult = await pool.query(
      'SELECT name FROM restaurants WHERE id = $1',
      [req.owner.restaurant_id]
    );

    const telegramId = userResult.rows[0]?.telegram_id;
    const restoName = restoResult.rows[0]?.name || 'Restoran';

    if (telegramId) {
      let text = '';
      if (status === 'confirmed') {
        text = `✅ <b>Broningiz tasdiqlandi!</b>\n\n🍽 ${restoName}\n📅 ${booking.date} — ⏰ ${booking.time}\n👥 ${booking.guests} kishi\n\nVaqtida keling!`;
      } else {
        text = `❌ <b>Broningiz bekor qilindi.</b>\n\n🍽 ${restoName}\n📅 ${booking.date} — ⏰ ${booking.time}\n\nBoshqa vaqt tanlashingiz mumkin.`;
      }
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Statistika ───────────────────────────────────────────────
router.get('/stats', ownerAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [total, todayRes, pending, confirmed] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1', [req.owner.restaurant_id]),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND date = $2', [req.owner.restaurant_id, today]),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND status = $2', [req.owner.restaurant_id, 'pending']),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND status = $2', [req.owner.restaurant_id, 'confirmed']),
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      today: parseInt(todayRes.rows[0].count),
      pending: parseInt(pending.rows[0].count),
      confirmed: parseInt(confirmed.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
