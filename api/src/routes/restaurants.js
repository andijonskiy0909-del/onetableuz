// ── GET /api/restaurants — Barcha restoranlar ─────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM restaurants
      WHERE status = 'approved'
      ORDER BY is_premium DESC, rating DESC
    `)
    res.json(result.rows)
  } catch(err) {
    res.status(500).json({ error: 'Server xatoligi' })
  }
})

/**
 * OneTable — Reservations
 * No-show bo'lgan foydalanuvchilar keyingi bronda depozit to'laydi
 */
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

const DEPOSIT_AMOUNT = 50000; // so'm

// ── Auth middleware ───────────────────────────────────────────
const userAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Telegram xabar yuborish ───────────────────────────────────
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
    console.error('Telegram xato:', e.message);
  }
}

// ── Eng yaqin bo'sh vaqtlarni topish ─────────────────────────
async function findAlternativeTimes(restaurantId, date, time, guests) {
  const bookedTimes = await pool.query(`
    SELECT DISTINCT time FROM reservations
    WHERE restaurant_id = $1 AND date = $2 AND status NOT IN ('cancelled')
  `, [restaurantId, date]);

  const booked = bookedTimes.rows.map(r => String(r.time).slice(0, 5));

  const allSlots = [];
  for (let h = 10; h <= 21; h++) {
    allSlots.push(`${String(h).padStart(2, '0')}:00`);
    allSlots.push(`${String(h).padStart(2, '0')}:30`);
  }
  allSlots.push('22:00');

  const freeSlots = allSlots.filter(s => !booked.includes(s));
  const [hh, mm] = time.split(':').map(Number);
  const timeMinutes = hh * 60 + mm;

  return freeSlots
    .map(s => {
      const [h, m] = s.split(':').map(Number);
      return { time: s, diff: Math.abs(h * 60 + m - timeMinutes) };
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time);
}

// ── Foydalanuvchi no-show bo'lganmi? ─────────────────────────
async function hasNoShow(userId) {
  const result = await pool.query(`
    SELECT COUNT(*) FROM reservations
    WHERE user_id = $1 AND status = 'noshow'
  `, [userId]);
  return parseInt(result.rows[0].count) > 0;
}

// ── Depozit to'langanmi? ──────────────────────────────────────
async function hasUnpaidDeposit(userId) {
  const result = await pool.query(`
    SELECT COUNT(*) FROM reservations
    WHERE user_id = $1
      AND requires_deposit = true
      AND payment_status = 'unpaid'
      AND status = 'pending'
  `, [userId]);
  return parseInt(result.rows[0].count) > 0;
}

// ── POST /api/reservations — Bron yaratish ────────────────────
router.post('/', userAuth, async (req, res) => {
  try {
    const { restaurant_id, date, time, guests, comment, special_request } = req.body;

    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    // Restoran mavjudligini tekshirish
    const resto = await pool.query(
      `SELECT id, name, capacity FROM restaurants WHERE id = $1 AND status = 'approved'`,
      [restaurant_id]
    );
    if (!resto.rows.length) {
      return res.status(404).json({ error: 'Restoran topilmadi' });
    }
    const { name: restaurantName, capacity } = resto.rows[0];

    // Bloklangan vaqt tekshirish
    const blocked = await pool.query(`
      SELECT id FROM availability
      WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true
    `, [restaurant_id, date, time]);

    if (blocked.rows.length) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests);
      return res.status(400).json({
        error: 'Bu vaqt bloklangan',
        alternatives,
        message: alternatives.length
          ? `Muqobil vaqtlar: ${alternatives.join(', ')}`
          : 'Bu kunda boshqa vaqt tanlang'
      });
    }

    // Sig'im tekshiruvi
    const conflict = await pool.query(`
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = $1 AND date = $2 AND time = $3
        AND status NOT IN ('cancelled')
    `, [restaurant_id, date, time]);

    if (parseInt(conflict.rows[0].count) >= capacity) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests);
      return res.status(400).json({
        error: 'Bu vaqtda joy mavjud emas',
        alternatives,
        message: alternatives.length
          ? `Bo'sh vaqtlar: ${alternatives.join(', ')}`
          : 'Bu kunda joy yo\'q. Boshqa kun tanlang.'
      });
    }

    // ── NO-SHOW tekshiruvi ────────────────────────────────────
    const noShow = await hasNoShow(req.user.id);
    let requiresDeposit = false;
    let paymentStatus = 'not_required';

    if (noShow) {
      requiresDeposit = true;
      paymentStatus = 'unpaid';
    }

    // Bron yaratish
    const result = await pool.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, date, time, guests,
        comment, special_request, status,
        requires_deposit, payment_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $8 THEN 'waiting_payment' ELSE 'pending' END,
        $8, $9)
      RETURNING *
    `, [
      req.user.id, restaurant_id, date, time, guests,
      comment || null, special_request || null,
      requiresDeposit, paymentStatus
    ]);

    const booking = result.rows[0];

    // Foydalanuvchi ma'lumotlari
    const userResult = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    // Foydalanuvchiga Telegram xabar
    if (user?.telegram_id) {
      let text;
      if (requiresDeposit) {
        text =
          `⚠️ <b>Depozit talab qilinadi!</b>\n\n` +
          `🍽 <b>${restaurantName}</b>\n` +
          `📅 ${date} — ⏰ ${time}\n` +
          `👥 ${guests} kishi\n\n` +
          `❗ Avvalgi broningizda kelmadingiz.\n` +
          `💳 Bron tasdiqlashi uchun <b>${DEPOSIT_AMOUNT.toLocaleString()} so'm</b> depozit to'lang.\n\n` +
          `To'lov tugmasi quyida 👇`;
      } else {
        text =
          `🎉 <b>Bron qabul qilindi!</b>\n\n` +
          `🍽 <b>${restaurantName}</b>\n` +
          `📅 ${date} — ⏰ ${time}\n` +
          `👥 ${guests} kishi\n` +
          `${comment ? `💬 Izoh: ${comment}\n` : ''}` +
          `${special_request ? `⭐ Maxsus so'rov: ${special_request}\n` : ''}` +
          `\n⏳ Restoran tasdiqlaguncha kuting.`;
      }
      await sendTelegramMsg(user.telegram_id, text);

      // Depozit to'lov tugmasi
      if (requiresDeposit) {
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: `💳 To'lov usulini tanlang:`,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Click orqali', callback_data: `pay_click_${booking.id}` },
                  { text: '💳 Payme orqali', callback_data: `pay_payme_${booking.id}` }
                ]
              ]
            }
          })
        });
      }
    }

    // Restoran egasiga xabar (faqat depozit shart bo'lmasa)
    if (!requiresDeposit) {
      const ownerResult = await pool.query(
        'SELECT ro.email FROM restaurant_owners ro WHERE ro.restaurant_id = $1',
        [restaurant_id]
      );
    }

    res.status(201).json({
      ...booking,
      restaurant_name: restaurantName,
      requires_deposit: requiresDeposit,
      deposit_amount: requiresDeposit ? DEPOSIT_AMOUNT : 0,
      message: requiresDeposit
        ? `Depozit to'lash kerak: ${DEPOSIT_AMOUNT.toLocaleString()} so'm`
        : 'Bron qabul qilindi'
    });

  } catch (err) {
    console.error('Bron xatoligi:', err.message);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── GET /api/reservations/my ──────────────────────────────────
router.get('/my', userAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*,
             res.name AS restaurant_name,
             res.address, res.image_url
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE r.user_id = $1
      ORDER BY r.date DESC, r.time DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── GET /api/reservations/check — Bo'sh joyni tekshirish ──────
router.get('/check', async (req, res) => {
  try {
    const { restaurant_id, date, time, guests } = req.query;
    if (!restaurant_id || !date || !time || !guests) {
      return res.status(400).json({ error: 'Parametrlar yetishmayapti' });
    }

    const conflict = await pool.query(`
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = $1 AND date = $2 AND time = $3
        AND status NOT IN ('cancelled')
    `, [restaurant_id, date, time]);

    const resto = await pool.query('SELECT capacity FROM restaurants WHERE id=$1', [restaurant_id]);
    const capacity = resto.rows[0]?.capacity || 50;

    if (parseInt(conflict.rows[0].count) >= capacity) {
      const alternatives = await findAlternativeTimes(restaurant_id, date, time, guests);
      return res.json({ available: false, alternatives });
    }

    res.json({ available: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── DELETE /api/reservations/:id — Bekor qilish ──────────────
router.delete('/:id', userAuth, async (req, res) => {
  try {
    const check = await pool.query(`
      SELECT r.*, res.name AS restaurant_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE r.id = $1 AND r.user_id = $2
    `, [req.params.id, req.user.id]);

    if (!check.rows.length) return res.status(404).json({ error: 'Bron topilmadi' });

    const booking = check.rows[0];
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Bron allaqachon bekor qilingan' });
    }

    const bookingDate = new Date(`${String(booking.date).split('T')[0]}T${booking.time}`);
    if (bookingDate < new Date()) {
      return res.status(400).json({ error: 'O\'tgan bronni bekor qilib bo\'lmaydi' });
    }

    await pool.query('UPDATE reservations SET status=$1 WHERE id=$2', ['cancelled', req.params.id]);

    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [req.user.id]);
    if (userResult.rows[0]?.telegram_id) {
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `🗑 <b>Bron bekor qilindi</b>\n\n🍽 ${booking.restaurant_name}\n📅 ${String(booking.date).split('T')[0]} — ⏰ ${booking.time}`
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── PUT /api/reservations/:id/noshow — No-show belgilash ──────
// (Restoran egasi tomonidan chaqiriladi)
router.put('/:id/noshow', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE reservations SET status = 'noshow' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Topilmadi' });

    const booking = result.rows[0];

    // Foydalanuvchiga ogohlantirish
    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [booking.user_id]);
    if (userResult.rows[0]?.telegram_id) {
      sendTelegramMsg(userResult.rows[0].telegram_id,
        `⚠️ <b>Eslatma!</b>\n\nSiz bugungi broningizga kelmagandingiz.\n\n` +
        `Keyingi bronda <b>${DEPOSIT_AMOUNT.toLocaleString()} so'm</b> depozit talab qilinadi.`
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

module.exports = router;
