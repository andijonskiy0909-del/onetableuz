

const { pool, withTransaction } = require('../config/db');
const { env } = require('../config/env');
const notify = require('./notificationService');

// ── Muqobil vaqtlarni topish ──────────────────────────────────
async function findAlternativeTimes(restaurantId, date, time) {
  const { rows } = await pool.query(
    `SELECT time::text, COUNT(*)::int as cnt
     FROM reservations
     WHERE restaurant_id=$1 AND date=$2 AND status NOT IN ('cancelled')
     GROUP BY time`,
    [restaurantId, date]
  );
  const { rows: restoRows } = await pool.query(
    'SELECT capacity FROM restaurants WHERE id=$1', [restaurantId]
  );
  const capacity = restoRows[0]?.capacity || 50;
  const busy = rows.filter(r => r.cnt >= capacity).map(r => r.time.slice(0, 5));

  const allSlots = [];
  for (let h = 10; h <= 21; h++) {
    allSlots.push(`${String(h).padStart(2,'0')}:00`);
    allSlots.push(`${String(h).padStart(2,'0')}:30`);
  }
  allSlots.push('22:00');

  const free = allSlots.filter(s => !busy.includes(s));
  const [hh, mm] = time.split(':').map(Number);
  const base = hh * 60 + mm;
  return free
    .map(s => { const [h,m]=s.split(':').map(Number); return {time:s,diff:Math.abs(h*60+m-base)}; })
    .sort((a,b) => a.diff-b.diff).slice(0,3).map(s=>s.time);
}

// ── No-show tekshiruvi ────────────────────────────────────────
async function userHasNoShow(userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM reservations WHERE user_id=$1 AND status=\'noshow\' LIMIT 1', [userId]
  );
  return rows.length > 0;
}

// ────────────────────────────────────────────────────────────────
// ASOSIY FIX: To'g'ri availability tekshiruvi
//
// MUAMMO: eski kod COUNT(*) >= capacity deb tekshirar edi.
// Masalan: capacity=50, 1 ta bron bor → 1 >= 50? YO'Q → bo'sh
// Lekin ASLIDA: capacity bu "bir vaqtda qancha stolda odam o'tirishi mumkin"
// Demak: bir vaqtda 50 ta guruh kelishi mumkin bo'lsa,
//        49 ta bron bo'lganda ham 50-guruh bron qila olishi kerak.
//
// STOL bilan ishlash:
//   Agar stol biriktirilgan bo'lsa → shu stolni boshqa birovga bergani yo'q
//   Agar stol biriktirilmagan bo'lsa → zona/restoran sig'imiga qarab tekshir
// ────────────────────────────────────────────────────────────────

async function checkAvailability(restaurantId, date, time, zoneId) {
  // 1. Bloklangan vaqt?
  const { rows: blocked } = await pool.query(
    `SELECT 1 FROM availability
     WHERE restaurant_id=$1 AND date=$2 AND time=$3 AND is_blocked=true`,
    [restaurantId, date, time]
  );
  if (blocked.length) return { available: false, reason: 'blocked' };

  // 2. Restoran mavjudmi?
  const { rows: restoRows } = await pool.query(
    'SELECT id, capacity FROM restaurants WHERE id=$1 AND status=\'approved\'', [restaurantId]
  );
  if (!restoRows.length) return { available: false, reason: 'not_found' };
  const capacity = restoRows[0].capacity || 50;

  // 3. Agar zona tanlangan bo'lsa
  if (zoneId) {
    // Zonaning stollarini ol
    const { rows: tables } = await pool.query(
      'SELECT id FROM tables WHERE zone_id=$1 AND is_available=true', [zoneId]
    );

    if (tables.length > 0) {
      // Stol bor → band bo'lmagan stolni top
      const tableIds = tables.map(t => t.id);
      const { rows: bookedTables } = await pool.query(
        `SELECT DISTINCT table_id FROM reservations
         WHERE table_id=ANY($1) AND date=$2 AND time=$3
           AND status NOT IN ('cancelled')`,
        [tableIds, date, time]
      );
      const bookedIds = new Set(bookedTables.map(r => r.table_id));
      const freeTable = tables.find(t => !bookedIds.has(t.id));
      if (!freeTable) return { available: false, reason: 'zone_full' };
      return { available: true, tableId: freeTable.id };
    }

    // Stol yo'q → zona sig'imi bo'yicha tekshir
    const { rows: zoneInfo } = await pool.query(
      'SELECT capacity FROM zones WHERE id=$1', [zoneId]
    );
    const zoneCapacity = zoneInfo[0]?.capacity || 10;
    const { rows: zoneBrons } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reservations
       WHERE restaurant_id=$1 AND date=$2 AND time=$3
         AND zone_id=$4 AND status NOT IN ('cancelled')`,
      [restaurantId, date, time, zoneId]
    );
    if (zoneBrons[0].cnt >= zoneCapacity) return { available: false, reason: 'zone_full' };
    return { available: true, tableId: null };
  }

  // 4. Zona yo'q → restoran umumiy sig'imi bo'yicha tekshir
  const { rows: brons } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM reservations
     WHERE restaurant_id=$1 AND date=$2 AND time=$3
       AND status NOT IN ('cancelled')`,
    [restaurantId, date, time]
  );
  if (brons[0].cnt >= capacity) return { available: false, reason: 'full' };
  return { available: true, tableId: null };
}

// ── Bron yaratish ─────────────────────────────────────────────
async function createReservation({ userId, restaurantId, date, time, guests,
  comment, specialRequest, zoneId, preOrder }) {

  return withTransaction(async (client) => {
    // Restoranni lock qil
    const { rows: restos } = await client.query(
      'SELECT id, name, capacity FROM restaurants WHERE id=$1 AND status=\'approved\' FOR UPDATE',
      [restaurantId]
    );
    if (!restos.length) throw Object.assign(new Error('Restoran topilmadi'), { statusCode: 404 });
    const { name: restaurantName } = restos[0];

    // Availability check
    const check = await checkAvailability(restaurantId, date, time, zoneId);
    if (!check.available) {
      const alternatives = await findAlternativeTimes(restaurantId, date, time);
      const msgs = { blocked: 'Bu vaqt bloklangan', zone_full: 'Bu zona band', full: 'Bu vaqtda joy mavjud emas', not_found: 'Restoran topilmadi' };
      throw Object.assign(new Error(msgs[check.reason] || 'Xatolik'), { statusCode: 400, alternatives });
    }

    // Depozit kerakmi?
    const requiresDeposit = await userHasNoShow(userId);
    const status = requiresDeposit ? 'waiting_payment' : 'pending';
    const paymentStatus = requiresDeposit ? 'unpaid' : 'not_required';
    const preOrderJson = JSON.stringify(preOrder || []);
    const preOrderTotal = (preOrder || []).reduce((s,i) => s+(i.price||0)*(i.qty||1), 0);

    const { rows } = await client.query(
      `INSERT INTO reservations
         (user_id,restaurant_id,zone_id,table_id,date,time,guests,
          comment,special_request,pre_order,pre_order_total,
          status,requires_deposit,payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [userId, restaurantId, zoneId||null, check.tableId||null,
       date, time, guests, comment||null, specialRequest||null,
       preOrderJson, preOrderTotal, status, requiresDeposit, paymentStatus]
    );

    return { booking: rows[0], restaurantName, requiresDeposit };
  });
}

// ── Bekor qilish ──────────────────────────────────────────────
async function cancelReservation(reservationId, userId) {
  const { rows } = await pool.query(
    `SELECT r.*, res.name AS restaurant_name FROM reservations r
     JOIN restaurants res ON r.restaurant_id=res.id
     WHERE r.id=$1 AND r.user_id=$2`, [reservationId, userId]
  );
  if (!rows.length) throw Object.assign(new Error('Bron topilmadi'), { statusCode: 404 });
  const booking = rows[0];
  if (booking.status === 'cancelled') throw Object.assign(new Error('Allaqachon bekor'), { statusCode: 400 });
  const dt = new Date(`${String(booking.date).split('T')[0]}T${booking.time}`);
  if (dt < new Date()) throw Object.assign(new Error("O'tgan bronni bekor qilib bo'lmaydi"), { statusCode: 400 });
  await pool.query('UPDATE reservations SET status=\'cancelled\' WHERE id=$1', [reservationId]);
  const { rows: u } = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [userId]);
  if (u[0]?.telegram_id) notify.notifyBookingCancelledByUser(u[0].telegram_id, booking, booking.restaurant_name).catch(()=>{});
  return { success: true };
}

// ── Status o'zgartirish (owner) ───────────────────────────────
async function updateReservationStatus(reservationId, restaurantId, status) {
  if (!['confirmed','cancelled','completed','noshow'].includes(status))
    throw Object.assign(new Error("Noto'g'ri status"), { statusCode: 400 });
  const { rows } = await pool.query(
    'UPDATE reservations SET status=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *',
    [status, reservationId, restaurantId]
  );
  if (!rows.length) throw Object.assign(new Error('Bron topilmadi'), { statusCode: 404 });
  const booking = rows[0];
  const { rows: ud } = await pool.query(
    `SELECT u.telegram_id, res.name AS rname FROM users u
     JOIN reservations r ON r.user_id=u.id JOIN restaurants res ON r.restaurant_id=res.id WHERE r.id=$1`,
    [reservationId]
  );
  if (ud[0]?.telegram_id) {
    const tid=ud[0].telegram_id, name=ud[0].rname;
    if (status==='confirmed') notify.notifyBookingConfirmed(tid,booking,name).catch(()=>{});
    else if (status==='cancelled') notify.notifyBookingCancelled(tid,booking,name).catch(()=>{});
    else if (status==='completed') notify.notifyBookingCompleted(tid,name).catch(()=>{});
    else if (status==='noshow') notify.notifyNoShow(tid,env.DEPOSIT_AMOUNT).catch(()=>{});
  }
  return booking;
}

// ── Band vaqtlar (webapp uchun) ───────────────────────────────
async function getBusySlots(restaurantId, date) {
  const { rows: restoRows } = await pool.query(
    'SELECT capacity FROM restaurants WHERE id=$1', [restaurantId]
  );
  const capacity = restoRows[0]?.capacity || 50;
  const { rows } = await pool.query(
    `SELECT time::text, COUNT(*)::int as cnt FROM reservations
     WHERE restaurant_id=$1 AND date=$2 AND status NOT IN ('cancelled')
     GROUP BY time`, [restaurantId, date]
  );
  // Faqat to'liq band bo'lgan vaqtlarni qaytarish
  return rows.filter(r => r.cnt >= capacity).map(r => r.time.slice(0,5));
}

module.exports = {
  createReservation, cancelReservation,
  updateReservationStatus, getBusySlots,
  findAlternativeTimes, checkAvailability, userHasNoShow
};
