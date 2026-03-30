/**
 * OneTable — Booking Service
 * ✅ Har bir stol alohida band qilinadi
 * ✅ Zona ixtiyoriy — stol avtomatik tayinlanadi
 * ✅ Bir vaqtda bir nechta odam bron qila oladi (turli stollar)
 */

const db     = require('../db')
const logger = require('../logger')

// ── Bo'sh stol topish ─────────────────────────────────────────
async function findAvailableTable(client, restaurantId, zoneId, date, time, guests) {
  const booked = await client.query(`
    SELECT DISTINCT table_id FROM reservations
    WHERE restaurant_id = $1
      AND date = $2
      AND time = $3
      AND status NOT IN ('cancelled')
      AND table_id IS NOT NULL
  `, [restaurantId, date, time])

  const bookedIds = booked.rows.map(r => r.table_id)

  let q = `
    SELECT t.* FROM tables t
    WHERE t.restaurant_id = $1
      AND t.is_available = true
      AND t.capacity >= $2
  `
  const params = [restaurantId, guests]

  if (zoneId && zoneId !== 'default') {
    params.push(zoneId)
    q += ` AND t.zone_id = $${params.length}`
  }

  if (bookedIds.length > 0) {
    q += ` AND t.id NOT IN (${bookedIds.map((_, i) => `$${params.length + i + 1}`).join(',')})`
    params.push(...bookedIds)
  }

  q += ' ORDER BY t.capacity ASC LIMIT 1'

  const result = await client.query(q, params)
  return result.rows[0] || null
}

// ── Muqobil vaqtlar ───────────────────────────────────────────
async function findAlternativeTimes(restaurantId, date, time, guests) {
  const slots = []
  for (let h = 10; h <= 21; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`)
    slots.push(`${String(h).padStart(2, '0')}:30`)
  }
  slots.push('22:00')

  const totalTables = await db.query(`
    SELECT COUNT(*) FROM tables
    WHERE restaurant_id = $1 AND is_available = true AND capacity >= $2
  `, [restaurantId, guests])
  const total = parseInt(totalTables.rows[0].count)

  if (total === 0) return []

  const blocked = await db.query(`
    SELECT time FROM availability
    WHERE restaurant_id = $1 AND date = $2 AND is_blocked = true
  `, [restaurantId, date])
  const blockedTimes = blocked.rows.map(r => String(r.time).slice(0, 5))

  const bookedCounts = await db.query(`
    SELECT time, COUNT(DISTINCT table_id) as booked_count
    FROM reservations
    WHERE restaurant_id = $1 AND date = $2
      AND status NOT IN ('cancelled')
      AND table_id IS NOT NULL
    GROUP BY time
  `, [restaurantId, date])

  const bookedMap = {}
  bookedCounts.rows.forEach(r => {
    bookedMap[String(r.time).slice(0, 5)] = parseInt(r.booked_count)
  })

  const [th, tm] = time.split(':').map(Number)
  const baseMin = th * 60 + tm

  const freeSlots = slots.filter(s => {
    if (blockedTimes.includes(s)) return false
    const booked = bookedMap[s] || 0
    return booked < total
  })

  return freeSlots
    .map(s => {
      const [h, m] = s.split(':').map(Number)
      return { time: s, diff: Math.abs(h * 60 + m - baseMin) }
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time)
}

// ── Bron yaratish ─────────────────────────────────────────────
async function createReservation(userId, data) {
  const {
    restaurant_id, zone_id, date, time, guests,
    comment, special_request, food_ready_time, pre_order
  } = data

  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const resto = await client.query(
      `SELECT id, name FROM restaurants WHERE id=$1 AND status='approved' AND is_active=true`,
      [restaurant_id]
    )
    if (!resto.rows.length) throw { status: 404, message: 'Restoran topilmadi' }

    const blocked = await client.query(
      `SELECT id FROM availability WHERE restaurant_id=$1 AND date=$2 AND time=$3 AND is_blocked=true`,
      [restaurant_id, date, time]
    )
    if (blocked.rows.length) {
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      throw { status: 400, message: 'Bu vaqt bloklangan', alternatives: alts }
    }

    let table = await findAvailableTable(client, restaurant_id, zone_id, date, time, guests)

    if (!table && zone_id && zone_id !== 'default') {
      table = await findAvailableTable(client, restaurant_id, null, date, time, guests)
    }

    if (!table) {
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      throw {
        status: 400,
        message: 'Bu vaqtda bo\'sh stol mavjud emas',
        alternatives: alts,
        suggest: alts.length ? `Bo'sh vaqtlar: ${alts.join(', ')}` : 'Bu kunda joy yo\'q'
      }
    }

    let preOrderTotal = 0
    const preOrderList = Array.isArray(pre_order) ? pre_order : []
    if (preOrderList.length) {
      const ids = preOrderList.map(i => i.id).filter(Boolean)
      if (ids.length) {
        const items = await client.query(
          `SELECT id, price FROM menu_items WHERE id=ANY($1) AND restaurant_id=$2 AND is_available=true`,
          [ids, restaurant_id]
        )
        const priceMap = Object.fromEntries(items.rows.map(m => [m.id, m.price]))
        preOrderTotal = preOrderList.reduce((s, i) => s + (priceMap[i.id] || 0) * (i.qty || 1), 0)
      }
    }

    const result = await client.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, table_id,
        date, time, guests, comment,
        special_request, food_ready_time,
        pre_order, pre_order_total,
        status, payment_status, expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending','unpaid',NOW()+INTERVAL'30 min')
      RETURNING *
    `, [
      userId, restaurant_id,
      (zone_id && zone_id !== 'default') ? zone_id : (table.zone_id || null),
      table.id,
      date, time, guests,
      comment || null,
      special_request || null,
      food_ready_time || null,
      JSON.stringify(preOrderList),
      preOrderTotal
    ])

    await client.query('COMMIT')

    logger.info(`Bron: id=${result.rows[0].id}, stol=#${table.table_number}, vaqt=${time}`)

    return {
      ...result.rows[0],
      table_number: table.table_number,
      restaurant_name: resto.rows[0].name
    }

  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      throw { status: 400, message: 'Bu stol allaqachon band', alternatives: alts }
    }
    throw err
  } finally {
    client.release()
  }
}

// ── Muddati o'tgan bronlarni bekor qilish ────────────────────
async function expireReservations() {
  try {
    const result = await db.query(`
      UPDATE reservations SET status='cancelled'
      WHERE status='pending' AND expires_at < NOW()
      RETURNING id
    `)
    if (result.rows.length) logger.info(`${result.rows.length} ta bron muddati tugadi`)
    return result.rows
  } catch (e) {
    logger.error('expireReservations error: ' + e.message)
    return []
  }
}

async function checkAvailability(restaurantId, date, time, guests, zoneId) {
  const client = await db.connect()
  try {
    const table = await findAvailableTable(client, restaurantId, zoneId, date, time, guests)
    if (table) return { available: true, table_number: table.table_number }
    const alts = await findAlternativeTimes(restaurantId, date, time, guests)
    return { available: false, alternatives: alts }
  } finally {
    client.release()
  }
}

module.exports = {
  createReservation,
  findAvailableTable,
  findAlternativeTimes,
  expireReservations,
  checkAvailability
}
