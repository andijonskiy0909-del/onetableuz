// ════════════════════════════════════════════════════════════════════
// ONETABLE — bookingService.js (PRODUCTION-GRADE)
// ════════════════════════════════════════════════════════════════════
// Bu fayl — sizning eski services/bookingService.js o'rniga keladi.
//
// Asosiy himoyalar:
// 1. ATOMIC TRANSACTION — INSERT BEGIN/COMMIT ichida
// 2. PARTIAL UNIQUE INDEX'ga tayanish — DB darajasida duplicate yo'q
// 3. RESERVATION HOLDS — 10 daqiqa stol "qulflanadi"
// 4. RETRY LOGIC — race condition'da do'stona xato
// 5. TRUST SCORE — har bron uchun avtomatik yangilash
// 6. AUDIT LOG — har o'zgarish yoziladi
// ════════════════════════════════════════════════════════════════════

const db = require('../config/db');
const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────────────────
// HELPER: Transaction wrapper (db.js da getClient yo'q bo'lsa ham ishlaydi)
// ─────────────────────────────────────────────────────────────────────
async function withTransaction(callback) {
  // Agar db.getClient() mavjud bo'lsa — to'g'ri transaction
  if (typeof db.getClient === 'function') {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  
  // Fallback: db.query() bilan, transactionsiz lekin atomic INSERT
  // (DB constraint'i baribir himoya qiladi)
  return callback(db);
}

// ─────────────────────────────────────────────────────────────────────
// 1. RESERVATION HOLDS — vaqtinchalik stol ushlash
// ─────────────────────────────────────────────────────────────────────

/**
 * Mijoz stol tanlaganda — 10 daqiqaga "qulflash"
 * Boshqa mijoz shu stolni ko'ra olmaydi
 */
async function createHold({ tableId, date, time, sessionId, userId }) {
  // Avval eski expired hold'larni tozalash
  await db.query(`DELETE FROM reservation_holds WHERE expires_at < NOW()`);
  
  try {
    const result = await db.query(`
      INSERT INTO reservation_holds (table_id, date, time, session_id, user_id, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')
      RETURNING id, expires_at
    `, [tableId, date, time, sessionId, userId]);
    
    return {
      success: true,
      holdId: result.rows[0].id,
      expiresAt: result.rows[0].expires_at,
      message: 'Stol 10 daqiqaga band qilindi'
    };
  } catch (err) {
    // UNIQUE constraint xato — stol allaqachon kimdir tomonidan ushlangan
    if (err.code === '23505') {
      throw new Error('Bu stol vaqtincha boshqa mijoz tomonidan tanlangan. 10 daqiqadan keyin qayta urinib ko\'ring.');
    }
    throw err;
  }
}

/**
 * Hold'ni bekor qilish (mijoz "ortga" bossa)
 */
async function releaseHold(sessionId) {
  await db.query(`DELETE FROM reservation_holds WHERE session_id = $1`, [sessionId]);
}

/**
 * Stol band yoki bo'shligi tekshirish (hold + reservations)
 */
async function isTableAvailable(tableId, date, time) {
  // Avval expired hold'larni tozalash
  await db.query(`DELETE FROM reservation_holds WHERE expires_at < NOW()`);
  
  // Aktiv bron bormi?
  const reserv = await db.query(`
    SELECT id FROM reservations
    WHERE table_id = $1 AND date = $2 AND time = $3
      AND status NOT IN ('cancelled', 'no_show')
    LIMIT 1
  `, [tableId, date, time]);
  
  if (reserv.rows.length > 0) return false;
  
  // Aktiv hold bormi?
  const hold = await db.query(`
    SELECT id FROM reservation_holds
    WHERE table_id = $1 AND date = $2 AND time = $3
      AND expires_at > NOW()
    LIMIT 1
  `, [tableId, date, time]);
  
  return hold.rows.length === 0;
}

// ─────────────────────────────────────────────────────────────────────
// 2. AUTO-PICK TABLE — agar mijoz stol tanlamasa
// ─────────────────────────────────────────────────────────────────────

async function autoPickTable({ restaurantId, zoneId, guests, date, time }) {
  // Bo'sh stollarni topish (capacity yetarli + bron yo'q + hold yo'q)
  const params = [restaurantId, guests, date, time];
  let zoneFilter = '';
  
  if (zoneId) {
    params.push(zoneId);
    zoneFilter = `AND t.zone_id = $${params.length}`;
  }
  
  const result = await db.query(`
    SELECT t.id, t.table_number, t.capacity
    FROM tables t
    WHERE t.restaurant_id = $1
      AND t.capacity >= $2
      AND COALESCE(t.is_available, true) = true
      ${zoneFilter}
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.table_id = t.id 
          AND r.date = $3 AND r.time = $4
          AND r.status NOT IN ('cancelled', 'no_show')
      )
      AND NOT EXISTS (
        SELECT 1 FROM reservation_holds h
        WHERE h.table_id = t.id
          AND h.date = $3 AND h.time = $4
          AND h.expires_at > NOW()
      )
    ORDER BY t.capacity ASC, t.id ASC
    LIMIT 1
  `, params);
  
  return result.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────
// 3. ASOSIY: BRON YARATISH (ATOMIC + SAFE)
// ─────────────────────────────────────────────────────────────────────

/**
 * Bron yaratish — eng muhim funksiya.
 * Race condition'lar 3 qatlam himoyalangan:
 *   1. DB Partial Unique Index (eng ishonchli)
 *   2. Reservation hold (UX)
 *   3. Application-level check
 */
async function createReservation({
  userId, restaurantId, zoneId, tableId,
  date, time, guests, comment,
  sessionId,  // mijoz hold qilgan session
  source = 'mini_app'
}) {
  // ─── 1. Validation ───
  if (!userId || !restaurantId || !date || !time || !guests) {
    throw new Error('Majburiy ma\'lumotlar yetishmayapti');
  }
  if (guests < 1 || guests > 50) {
    throw new Error('Mehmon soni 1 dan 50 gacha bo\'lishi kerak');
  }
  
  // ─── 2. Restoran sozlamalarini olish ───
  const restRes = await db.query(`
    SELECT id, name, deposit_required, deposit_amount, settings
    FROM restaurants WHERE id = $1
  `, [restaurantId]);
  
  if (restRes.rows.length === 0) {
    throw new Error('Restoran topilmadi');
  }
  const restaurant = restRes.rows[0];
  
  // ─── 3. Mijoz trust score'ini olish ───
  const userRes = await db.query(`
    SELECT trust_score, total_bookings, no_show_count
    FROM users WHERE id = $1
  `, [userId]);
  
  const user = userRes.rows[0] || { trust_score: 50, total_bookings: 0, no_show_count: 0 };
  
  // ─── 4. Stol tanlash (yoki auto-pick) ───
  let finalTableId = tableId;
  
  if (finalTableId) {
    // Mijoz tanlagan stol — bo'shligi tekshirish
    const available = await isTableAvailable(finalTableId, date, time);
    if (!available) {
      throw new Error('Afsus, bu stol allaqachon band qilingan. Boshqa stol tanlang.');
    }
  } else {
    // Auto-pick
    const picked = await autoPickTable({ restaurantId, zoneId, guests, date, time });
    if (!picked) {
      throw new Error('Bu vaqt uchun bo\'sh stol topilmadi. Boshqa vaqt yoki sana tanlang.');
    }
    finalTableId = picked.id;
  }
  
  // ─── 5. Deposit logikasi ───
  const depositInfo = calculateDeposit({
    restaurant,
    user,
    guests,
    date,
    time
  });
  
  const status = depositInfo.required ? 'pending_deposit' : 'pending';
  
  // ─── 6. INSERT — ATOMIC TRANSACTION + RETRY ───
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const result = await withTransaction(async (client) => {
        // Insert reservation — agar PARTIAL UNIQUE INDEX bor bo'lsa,
        // shu yerda race condition aniqlanadi
        const insertRes = await client.query(`
          INSERT INTO reservations (
            user_id, restaurant_id, zone_id, table_id,
            date, time, guests, comment,
            status, payment_status,
            deposit_required, deposit_amount, deposit_status,
            source, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, NOW()
          )
          RETURNING *
        `, [
          userId, restaurantId, zoneId, finalTableId,
          date, time, guests, comment || null,
          status, 'unpaid',
          depositInfo.required, depositInfo.amount,
          depositInfo.required ? 'awaiting' : 'not_required',
          source
        ]);
        
        const reservation = insertRes.rows[0];
        
        // Hold'ni o'chirish
        if (sessionId) {
          await client.query(`DELETE FROM reservation_holds WHERE session_id = $1`, [sessionId]);
        }
        
        // Audit log
        await client.query(`
          INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, changes)
          VALUES ('user', $1, 'created', 'reservation', $2, $3)
        `, [userId, reservation.id, JSON.stringify({ guests, date, time, table_id: finalTableId })]);
        
        return reservation;
      });
      
      // ─── 7. Notification yuborish ───
      await sendReservationCreatedEvents(result, restaurant);
      
      logger.info(`✅ Reservation created: id=${result.id}, user=${userId}, restaurant=${restaurantId}`);
      
      return {
        success: true,
        reservation: result,
        deposit: depositInfo
      };
      
    } catch (err) {
      // PostgreSQL UNIQUE VIOLATION — race condition aniqlandi
      if (err.code === '23505') {
        if (attempts >= maxAttempts) {
          logger.warn(`Race condition on table ${finalTableId} — both attempts failed`);
          throw new Error('Afsus, bu stol shu zahoti boshqa mijoz tomonidan band qilindi. Boshqa stol tanlang.');
        }
        
        // Retry — boshqa stol topish (faqat auto-pick paytida)
        if (!tableId) {
          const picked = await autoPickTable({ restaurantId, zoneId, guests, date, time });
          if (picked) {
            finalTableId = picked.id;
            continue;
          }
        }
        
        throw new Error('Bu stol band qilindi. Iltimos, boshqa tanlang.');
      }
      
      // Boshqa xatolar — qayta urinmasdan tashlash
      logger.error(`Reservation INSERT error: ${err.message}, code: ${err.code}`);
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4. DEPOSIT KALKULYATSIYASI — Trust score asosida
// ─────────────────────────────────────────────────────────────────────

function calculateDeposit({ restaurant, user, guests, date, time }) {
  // Restoranda deposit yo'q?
  if (!restaurant.deposit_required) {
    return { required: false, amount: 0, reason: 'restaurant_no_deposit' };
  }
  
  const baseDepositAmount = parseFloat(restaurant.deposit_amount) || 0;
  
  // Eski mijoz, yuqori trust — deposit yo'q
  if (user.trust_score >= 80 && user.total_bookings >= 3 && user.no_show_count === 0) {
    return { required: false, amount: 0, reason: 'trusted_user' };
  }
  
  // Past trust — to'liq deposit
  if (user.trust_score < 50) {
    return { required: true, amount: baseDepositAmount, reason: 'low_trust' };
  }
  
  // O'rta trust + no-show tarixi bor — yarim deposit
  if (user.no_show_count >= 1) {
    return { required: true, amount: Math.round(baseDepositAmount / 2), reason: 'previous_no_show' };
  }
  
  // Katta guruh (8+ kishi) — to'liq deposit
  if (guests >= 8) {
    return { required: true, amount: baseDepositAmount, reason: 'large_group' };
  }
  
  // Peak hour (Juma-Shanba 19:00+) — to'liq deposit
  const dayOfWeek = new Date(date).getDay(); // 0=Yakshanba, 5=Juma, 6=Shanba
  const hour = parseInt(String(time).split(':')[0]);
  if ((dayOfWeek === 5 || dayOfWeek === 6) && hour >= 19) {
    return { required: true, amount: baseDepositAmount, reason: 'peak_hour' };
  }
  
  // Aks holda — deposit yo'q
  return { required: false, amount: 0, reason: 'normal_booking' };
}

// ─────────────────────────────────────────────────────────────────────
// 5. NOTIFICATION (Socket.io + Telegram)
// ─────────────────────────────────────────────────────────────────────

async function sendReservationCreatedEvents(reservation, restaurant) {
  try {
    // Owner dashboard — real-time update
    const app = require('../app').app;
    if (app) {
      const io = app.get('io');
      if (io) {
        // Mijoz va stol ma'lumotlarini olish (enrichment)
        const enriched = await enrichReservation(reservation);
        io.to(`restaurant_${reservation.restaurant_id}`).emit('reservation:new', enriched);
      }
    }
    
    // Telegram bot — owner'ga xabar
    // (bot logic boshqa joyda)
    
  } catch (err) {
    // Notification xatosi — bron yaratilganini buzmaydi
    logger.warn(`Notification send failed: ${err.message}`);
  }
}

async function enrichReservation(reservation) {
  const result = await db.query(`
    SELECT 
      r.*,
      u.first_name || ' ' || COALESCE(u.last_name, '') AS user_name,
      u.phone AS user_phone,
      t.table_number,
      z.name AS zone_name
    FROM reservations r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    LEFT JOIN zones z ON z.id = r.zone_id
    WHERE r.id = $1
  `, [reservation.id]);
  
  return result.rows[0] || reservation;
}

// ─────────────────────────────────────────────────────────────────────
// 6. CRON: Pending deposit'larni avtomatik bekor qilish (1 soatdan keyin)
// ─────────────────────────────────────────────────────────────────────

async function expireReservations() {
  try {
    // 1 soatdan oshgan pending_deposit'larni cancel qilish
    const expired = await db.query(`
      UPDATE reservations
      SET status = 'cancelled',
          cancelled_by = 'system',
          cancel_reason = 'Deposit not paid within 1 hour'
      WHERE status = 'pending_deposit'
        AND created_at < NOW() - INTERVAL '1 hour'
      RETURNING id
    `);
    
    if (expired.rows.length > 0) {
      logger.info(`✅ Auto-cancelled ${expired.rows.length} unpaid reservations`);
    }
    
    // No-show belgilash: vaqti 30 daqiqa o'tgan, lekin status hali 'confirmed'
    const noShows = await db.query(`
      UPDATE reservations r
      SET status = 'no_show',
          no_show_at = NOW()
      WHERE r.status = 'confirmed'
        AND (r.date || ' ' || r.time)::timestamp < NOW() - INTERVAL '30 minutes'
      RETURNING id, user_id
    `);
    
    // No-show qilgan mijozlarning trust_score'ini kamaytirish
    for (const row of noShows.rows) {
      await db.query(`
        UPDATE users 
        SET trust_score = GREATEST(0, trust_score - 20),
            no_show_count = no_show_count + 1
        WHERE id = $1
      `, [row.user_id]);
    }
    
    if (noShows.rows.length > 0) {
      logger.info(`⚠️  Marked ${noShows.rows.length} reservations as no_show`);
    }
    
    // Expired hold'larni tozalash
    await db.query(`DELETE FROM reservation_holds WHERE expires_at < NOW()`);
    
  } catch (err) {
    logger.error(`expireReservations error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 7. RESERVATION YANGILASH (cancel, complete, etc.)
// ─────────────────────────────────────────────────────────────────────

async function cancelReservation(reservationId, { actorType, actorId, reason }) {
  return withTransaction(async (client) => {
    const res = await client.query(`
      UPDATE reservations
      SET status = 'cancelled',
          cancelled_by = $1,
          cancel_reason = $2
      WHERE id = $3
        AND status NOT IN ('cancelled', 'no_show', 'completed')
      RETURNING *
    `, [actorType, reason || null, reservationId]);
    
    if (res.rows.length === 0) {
      throw new Error('Bron topilmadi yoki bekor qilinmaydigan holatda');
    }
    
    // Mijoz kech bekor qilsa — trust score -10
    const reservation = res.rows[0];
    if (actorType === 'user') {
      const reservTime = new Date(`${reservation.date}T${reservation.time}`);
      const hoursUntil = (reservTime - new Date()) / (1000 * 60 * 60);
      
      if (hoursUntil < 2) {
        await client.query(`
          UPDATE users 
          SET trust_score = GREATEST(0, trust_score - 10),
              late_cancel_count = late_cancel_count + 1
          WHERE id = $1
        `, [reservation.user_id]);
      }
    }
    
    await client.query(`
      INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, changes)
      VALUES ($1, $2, 'cancelled', 'reservation', $3, $4)
    `, [actorType, actorId, reservationId, JSON.stringify({ reason })]);
    
    return reservation;
  });
}

async function completeReservation(reservationId, ownerId) {
  return withTransaction(async (client) => {
    const res = await client.query(`
      UPDATE reservations
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1 AND status = 'confirmed'
      RETURNING *
    `, [reservationId]);
    
    if (res.rows.length === 0) {
      throw new Error('Bron topilmadi yoki tasdiqlangan holatda emas');
    }
    
    // Mijoz trust_score +5
    const reservation = res.rows[0];
    await client.query(`
      UPDATE users 
      SET trust_score = LEAST(100, trust_score + 5),
          total_bookings = total_bookings + 1
      WHERE id = $1
    `, [reservation.user_id]);
    
    await client.query(`
      INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, changes)
      VALUES ('owner', $1, 'completed', 'reservation', $2, '{}')
    `, [ownerId, reservationId]);
    
    return reservation;
  });
}

// ─────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────

module.exports = {
  // Holds
  createHold,
  releaseHold,
  isTableAvailable,
  
  // Reservations
  createReservation,
  cancelReservation,
  completeReservation,
  
  // Auto-pick
  autoPickTable,
  
  // Cron
  expireReservations,
  
  // Helpers
  calculateDeposit,
  enrichReservation
};
