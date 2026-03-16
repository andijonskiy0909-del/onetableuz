const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

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

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email va parol kerak' });
    const result = await pool.query('SELECT * FROM restaurant_owners WHERE email = $1', [email]);
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

// Bronlar royxati
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

// Bronni tasdiqlash yoki rad etish
router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'cancelled'].includes(status))
      return res.status(400).json({ error: 'Status: confirmed yoki cancelled' });
    const check = await pool.query(
      'SELECT * FROM reservations WHERE id = $1 AND restaurant_id = $2',
      [req.params.id, req.owner.restaurant_id]
    );
    if (!check.rows.length)
      return res.status(404).json({ error: 'Bron topilmadi' });
    await pool.query('UPDATE reservations SET status = $1 WHERE id = $2', [status, req.params.id]);
    const booking = check.rows[0];
    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [booking.user_id]);
    const restoResult = await pool.query('SELECT name FROM restaurants WHERE id = $1', [req.owner.restaurant_id]);
    const telegramId = userResult.rows[0]?.telegram_id;
    const restoName = restoResult.rows[0]?.name || 'Restoran';
    if (telegramId && process.env.BOT_TOKEN) {
      const text = status === 'confirmed'
        ? `✅ <b>Broningiz tasdiqlandi!</b>\n\n🍽 ${restoName}\n📅 ${booking.date} — ⏰ ${booking.time}\n👥 ${booking.guests} kishi\n\nVaqtida keling!`
        : `❌ <b>Broningiz bekor qilindi.</b>\n\n🍽 ${restoName}\n📅 ${booking.date} — ⏰ ${booking.time}\n\nBoshqa vaqt tanlashingiz mumkin.`;
      fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
      }).catch(e => console.error('Telegram xato:', e.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Statistika
router.get('/stats', ownerAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rid = req.owner.restaurant_id;
    const [total, todayRes, pending, confirmed] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1', [rid]),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND date = $2', [rid, today]),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND status = $2', [rid, 'pending']),
      pool.query('SELECT COUNT(*) FROM reservations WHERE restaurant_id = $1 AND status = $2', [rid, 'confirmed']),
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

// Menyu royxati
router.get('/menu', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category, name',
      [req.owner.restaurant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// Taom qoshish
router.post('/menu', ownerAuth, async (req, res) => {
  try {
    const { name, category, price, description, is_available } = req.body;
    if (!name || !price)
      return res.status(400).json({ error: 'Nom va narx kerak' });
    const result = await pool.query(
      `INSERT INTO menu_items (restaurant_id, name, category, price, description, is_available)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.owner.restaurant_id, name, category, price, description, is_available ?? true]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Taomni yangilash
router.put('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const { is_available, name, price, description } = req.body;
    await pool.query(
      `UPDATE menu_items SET
         is_available = COALESCE($1, is_available),
         name = COALESCE($2, name),
         price = COALESCE($3, price),
         description = COALESCE($4, description)
       WHERE id = $5 AND restaurant_id = $6`,
      [is_available, name, price, description, req.params.id, req.owner.restaurant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Restoran profilini yangilash
router.put('/profile', ownerAuth, async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    await pool.query(
      `UPDATE restaurants SET
         name = COALESCE($1, name),
         address = COALESCE($2, address),
         phone = COALESCE($3, phone)
       WHERE id = $4`,
      [name, address, phone, req.owner.restaurant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
