/**
 * OneTable — To'lov tizimi
 * Click va Payme integratsiyasi
 * Faqat no-show foydalanuvchilar uchun depozit
 */
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const DEPOSIT_AMOUNT = 50000; // so'm

// ── Config ────────────────────────────────────────────────────
const PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID;
const PAYME_KEY = process.env.PAYME_KEY;
const PAYME_URL = process.env.NODE_ENV === 'production'
  ? 'https://checkout.paycom.uz'
  : 'https://test.paycom.uz';

const CLICK_SERVICE_ID = process.env.CLICK_SERVICE_ID;
const CLICK_MERCHANT_ID = process.env.CLICK_MERCHANT_ID;
const CLICK_SECRET = process.env.CLICK_SECRET;

// ── Auth ──────────────────────────────────────────────────────
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

// ── Foydalanuvchiga Telegram xabar ───────────────────────────
async function notifyUser(reservationId) {
  try {
    const result = await pool.query(`
      SELECT r.*, res.name AS restaurant_name, u.telegram_id
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [reservationId]);

    const booking = result.rows[0];
    if (!booking?.telegram_id) return;

    const dateStr = String(booking.date).split('T')[0];
    const timeStr = String(booking.time).slice(0, 5);

    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: booking.telegram_id,
        text: `✅ <b>To'lov qabul qilindi!</b>\n\n🍽 <b>${booking.restaurant_name}</b>\n📅 ${dateStr} — ⏰ ${timeStr}\n👥 ${booking.guests} kishi\n\n🎉 Broningiz tasdiqlandi! Restoranga vaqtida keling.`,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('notifyUser error:', e.message);
  }
}

// ── Depozit tasdiqlash (to'lov muvaffaqiyatli bo'lgandan keyin)
async function confirmDepositPayment(reservationId, transactionId, provider) {
  try {
    // To'lovni yangilash
    await pool.query(`
      UPDATE payments SET status='paid', transaction_id=$1, paid_at=NOW()
      WHERE reservation_id=$2 AND provider=$3
    `, [transactionId, reservationId, provider]);

    // Bronni tasdiqlash
    await pool.query(`
      UPDATE reservations
      SET status='pending', payment_status='deposit_paid'
      WHERE id=$1
    `, [reservationId]);

    // Foydalanuvchiga xabar
    await notifyUser(reservationId);
  } catch (e) {
    console.error('confirmDepositPayment error:', e.message);
  }
}

// ── POST /api/payments/create/click ──────────────────────────
router.post('/create/click', userAuth, async (req, res) => {
  try {
    const { reservation_id } = req.body;

    const reservation = await pool.query(`
      SELECT r.*, res.name AS restaurant_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE r.id = $1 AND r.user_id = $2
    `, [reservation_id, req.user.id]);

    if (!reservation.rows.length) {
      return res.status(404).json({ error: 'Bron topilmadi' });
    }

    const booking = reservation.rows[0];

    if (!booking.requires_deposit) {
      return res.status(400).json({ error: 'Bu bron uchun to\'lov talab qilinmaydi' });
    }

    if (booking.payment_status === 'deposit_paid') {
      return res.status(400).json({ error: 'Depozit allaqachon to\'langan' });
    }

    // To'lovni DB ga yozish
    const payment = await pool.query(`
      INSERT INTO payments (reservation_id, user_id, restaurant_id, amount, type, provider, status)
      VALUES ($1, $2, $3, $4, 'deposit', 'click', 'pending')
      ON CONFLICT (reservation_id, provider) DO UPDATE SET status='pending'
      RETURNING *
    `, [reservation_id, req.user.id, booking.restaurant_id, DEPOSIT_AMOUNT]);

    const paymentId = payment.rows[0].id;

    // Click URL
    const clickUrl = `https://my.click.uz/services/pay?service_id=${CLICK_SERVICE_ID}&merchant_id=${CLICK_MERCHANT_ID}&amount=${DEPOSIT_AMOUNT}&transaction_param=${paymentId}&return_url=${process.env.WEBAPP_URL}`;

    res.json({
      payment_id: paymentId,
      url: clickUrl,
      amount: DEPOSIT_AMOUNT,
      provider: 'click'
    });
  } catch (err) {
    console.error('Click create error:', err.message);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── POST /api/payments/create/payme ──────────────────────────
router.post('/create/payme', userAuth, async (req, res) => {
  try {
    const { reservation_id } = req.body;

    const reservation = await pool.query(`
      SELECT r.*, res.name AS restaurant_name
      FROM reservations r
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE r.id = $1 AND r.user_id = $2
    `, [reservation_id, req.user.id]);

    if (!reservation.rows.length) {
      return res.status(404).json({ error: 'Bron topilmadi' });
    }

    const booking = reservation.rows[0];

    if (!booking.requires_deposit) {
      return res.status(400).json({ error: 'Bu bron uchun to\'lov talab qilinmaydi' });
    }

    if (booking.payment_status === 'deposit_paid') {
      return res.status(400).json({ error: 'Depozit allaqachon to\'langan' });
    }

    const amountTiyin = DEPOSIT_AMOUNT * 100;

    const payment = await pool.query(`
      INSERT INTO payments (reservation_id, user_id, restaurant_id, amount, type, provider, status)
      VALUES ($1, $2, $3, $4, 'deposit', 'payme', 'pending')
      ON CONFLICT (reservation_id, provider) DO UPDATE SET status='pending'
      RETURNING *
    `, [reservation_id, req.user.id, booking.restaurant_id, DEPOSIT_AMOUNT]);

    const paymentId = payment.rows[0].id;

    const params = Buffer.from(JSON.stringify({
      m: PAYME_MERCHANT_ID,
      ac: { order_id: paymentId },
      a: amountTiyin,
      l: 'uz'
    })).toString('base64');

    const paymeUrl = `${PAYME_URL}/${params}`;

    res.json({
      payment_id: paymentId,
      url: paymeUrl,
      amount: DEPOSIT_AMOUNT,
      provider: 'payme'
    });
  } catch (err) {
    console.error('Payme create error:', err.message);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── POST /api/payments/webhook/payme ─────────────────────────
router.post('/webhook/payme', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.json({ error: { code: -32504, message: 'Unauthorized' } });

    const encoded = auth.split(' ')[1];
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [, password] = decoded.split(':');

    if (password !== PAYME_KEY) {
      return res.json({ error: { code: -32504, message: 'Noto\'g\'ri kalit' } });
    }

    const { method, params, id } = req.body;

    if (method === 'CheckPerformTransaction') {
      const payment = await pool.query('SELECT * FROM payments WHERE id=$1', [params.account.order_id]);
      if (!payment.rows.length) {
        return res.json({ id, result: null, error: { code: -31050, message: 'Topilmadi' } });
      }
      return res.json({ id, result: { allow: true } });
    }

    if (method === 'CreateTransaction') {
      const payment = await pool.query('SELECT * FROM payments WHERE id=$1', [params.account.order_id]);
      if (!payment.rows.length) {
        return res.json({ id, result: null, error: { code: -31050, message: 'Topilmadi' } });
      }
      await pool.query('UPDATE payments SET transaction_id=$1 WHERE id=$2', [params.id, params.account.order_id]);
      return res.json({ id, result: { create_time: Date.now(), transaction: params.id, state: 1 } });
    }

    if (method === 'PerformTransaction') {
      const payment = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [params.id]);
      if (payment.rows[0]) {
        await confirmDepositPayment(payment.rows[0].reservation_id, params.id, 'payme');
      }
      return res.json({ id, result: { transaction: params.id, perform_time: Date.now(), state: 2 } });
    }

    if (method === 'CancelTransaction') {
      await pool.query('UPDATE payments SET status=$1 WHERE transaction_id=$2',
        [params.reason < 5 ? 'cancelled_before' : 'cancelled_after', params.id]);
      return res.json({ id, result: { transaction: params.id, cancel_time: Date.now(), state: params.reason < 5 ? -1 : -2 } });
    }

    res.json({ id, result: null, error: { code: -32601, message: 'Method not found' } });
  } catch (err) {
    console.error('Payme webhook error:', err.message);
    res.json({ id: req.body?.id, result: null, error: { code: -31008, message: 'Server error' } });
  }
});

// ── POST /api/payments/webhook/click/prepare ─────────────────
router.post('/webhook/click/prepare', async (req, res) => {
  try {
    const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string } = req.body;

    const mySign = crypto.createHash('md5')
      .update(`${click_trans_id}${service_id}${CLICK_SECRET}${merchant_trans_id}${amount}${action}${sign_time}`)
      .digest('hex');

    if (mySign !== sign_string) {
      return res.json({ error: -1, error_note: 'SIGN CHECK FAILED!' });
    }

    const payment = await pool.query('SELECT * FROM payments WHERE id=$1', [merchant_trans_id]);
    if (!payment.rows.length) return res.json({ error: -5, error_note: 'Order not found' });
    if (payment.rows[0].status === 'paid') return res.json({ error: -4, error_note: 'Already paid' });

    res.json({ click_trans_id, merchant_trans_id, merchant_prepare_id: merchant_trans_id, error: 0, error_note: 'Success' });
  } catch (err) {
    res.json({ error: -9, error_note: 'Server error' });
  }
});

// ── POST /api/payments/webhook/click/complete ────────────────
router.post('/webhook/click/complete', async (req, res) => {
  try {
    const { click_trans_id, service_id, merchant_trans_id, merchant_prepare_id, amount, action, error, sign_time, sign_string } = req.body;

    const mySign = crypto.createHash('md5')
      .update(`${click_trans_id}${service_id}${CLICK_SECRET}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`)
      .digest('hex');

    if (mySign !== sign_string) {
      return res.json({ error: -1, error_note: 'SIGN CHECK FAILED!' });
    }

    if (parseInt(error) < 0) {
      await pool.query('UPDATE payments SET status=$1 WHERE id=$2', ['failed', merchant_trans_id]);
      return res.json({ error: 0, error_note: 'Success' });
    }

    const payment = await pool.query('SELECT * FROM payments WHERE id=$1', [merchant_trans_id]);
    if (payment.rows[0]) {
      await confirmDepositPayment(payment.rows[0].reservation_id, click_trans_id, 'click');
    }

    res.json({ error: 0, error_note: 'Success' });
  } catch (err) {
    res.json({ error: -9, error_note: 'Server error' });
  }
});

// ── GET /api/payments/:reservation_id/status ─────────────────
router.get('/:reservation_id/status', userAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, r.status AS reservation_status, r.payment_status, r.requires_deposit
      FROM payments p
      JOIN reservations r ON p.reservation_id = r.id
      WHERE p.reservation_id = $1 AND r.user_id = $2
      ORDER BY p.created_at DESC LIMIT 1
    `, [req.params.reservation_id, req.user.id]);

    res.json(result.rows[0] || { status: 'no_payment' });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

module.exports = router;
