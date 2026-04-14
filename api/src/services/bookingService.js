const db = require('../config/db')
const logger = require('../config/logger')

async function findAvailableTable(client, restaurantId, zoneId, date, time, guests) {
  const booked = await client.query(`
    SELECT DISTINCT table_id FROM reservations
    WHERE restaurant_id = $1 AND date = $2 AND time = $3
      AND status NOT IN ('cancelled') AND table_id IS NOT NULL
  `, [restaurantId, date, time])
  const bookedIds = booked.rows.map(r => r.table_id)

  let q = `
    SELECT t.* FROM tables t
    WHERE t.restaurant_id = $1 AND t.is_available = true AND t.capacity >= $2
  `
  const params = [restaurantId, guests]

  if (zoneId) {
    params.push(zoneId)
    q += ` AND t.zone_id = $${params.length}`
  }

  if (bookedIds.length > 0) {
    const placeholders = bookedIds.map((_, i) => `$${params.length + i + 1}`).join(',')
    q += ` AND t.id NOT IN (${placeholders})`
    params.push(...bookedIds)
  }

  q += ' ORDER BY t.capacity ASC LIMIT 1'
  const r = await client.query(q, params)
  return r.rows[0] || null
}

async function findAlternativeTimes(restaurantId, date, time, guests) {
  const slots = []
  for (let h = 10; h <= 21; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`)
    slots.push(`${String(h).padStart(2, '0')}:30`)
  }
  slots.push('22:00')

  const totalTables = await db.query(
    `SELECT COUNT(*)::int AS c FROM tables WHERE restaurant_id = $1 AND is_available = true AND capacity >= $2`,
    [restaurantId, guests]
  )
  const total = totalTables.rows[0].c
  if (total === 0) return []

  const blocked = await db.query(
    `SELECT time FROM availability WHERE restaurant_id = $1 AND date = $2 AND is_blocked = true`,
    [restaurantId, date]
  )
  const blockedTimes = blocked.rows.map(r => String(r.time).slice(0, 5))

  const bookedCounts = await db.query(`
    SELECT time, COUNT(DISTINCT table_id)::int AS n
    FROM reservations
    WHERE restaurant_id = $1 AND date = $2
      AND status NOT IN ('cancelled') AND table_id IS NOT NULL
    GROUP BY time
  `, [restaurantId, date])
  const bookedMap = {}
  bookedCounts.rows.forEach(r => { bookedMap[String(r.time).slice(0, 5)] = r.n })

  const [th, tm] = time.split(':').map(Number)
  const baseMin = th * 60 + tm

  return slots
    .filter(s => !blockedTimes.includes(s) && (bookedMap[s] || 0) < total)
    .map(s => {
      const [h, m] = s.split(':').map(Number)
      return { time: s, diff: Math.abs(h * 60 + m - baseMin) }
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time)
}

async function createReservation(userId, data) {
  const { restaurant_id, zone_id, date, time, guests, comment, special_request, pre_order } = data
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const resto = await client.query(
      `SELECT id, name FROM restaurants WHERE id = $1 AND is_active = true AND status = 'approved'`,
      [restaurant_id]
    )
    if (!resto.rows.length) throw Object.assign(new Error('Restoran topilmadi'), { status: 404 })

    const blocked = await client.query(
      `SELECT id FROM availability WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true`,
      [restaurant_id, date, time]
    )
    if (blocked.rows.length) {
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      throw Object.assign(new Error('Bu vaqt bloklangan'), { status: 400, alternatives: alts })
    }

    let table = await findAvailableTable(client, restaurant_id, zone_id, date, time, guests)
    if (!table && zone_id) {
      table = await findAvailableTable(client, restaurant_id, null, date, time, guests)
    }
    if (!table) {
      const alts = await findAlternativeTimes(restaurant_id, date, time, guests)
      throw Object.assign(new Error("Bu vaqtda boʻsh stol yoʻq"), { status: 400, alternatives: alts })
    }

    let preOrderTotal = 0
    const preOrderList = Array.isArray(pre_order) ? pre_order : []
    if (preOrderList.length) {
      const ids = preOrderList.map(i => i.menu_item_id || i.id).filter(Boolean)
      if (ids.length) {
        const items = await client.query(
          `SELECT id, price FROM menu_items WHERE id = ANY($1::bigint[]) AND restaurant_id = $2 AND is_available = true`,
          [ids, restaurant_id]
        )
        const map = Object.fromEntries(items.rows.map(m => [m.id, Number(m.price)]))
        preOrderTotal = preOrderList.reduce((s, i) => {
          const id = i.menu_item_id || i.id
          const qty = Number(i.quantity || i.qty || 1)
          return s + (map[id] || 0) * qty
        }, 0)
      }
    }

    const result = await client.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, table_id,
        date, time, guests, comment, special_request,
        pre_order, pre_order_total, status, payment_status, expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending','unpaid', NOW() + INTERVAL '30 minutes'
      ) RETURNING *
    `, [
      userId, restaurant_id,
      zone_id || table.zone_id || null,
      table.id, date, time, guests,
      comment || null, special_request || null,
      JSON.stringify(preOrderList), preOrderTotal
    ])

    await client.query('COMMIT')
    logger.info(`[booking] #${result.rows[0].id} table=${table.table_number} time=${time}`)

    return {
      ...result.rows[0],
      table_number: table.table_number,
      restaurant_name: resto.rows[0].name
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function expireReservations() {
  try {
    const r = await db.query(`
      UPDATE reservations SET status = 'cancelled'
      WHERE status = 'pending' AND expires_at < NOW()
      RETURNING id
    `)
    if (r.rows.length) logger.info(`[cron] expired ${r.rows.length} reservations`)
    return r.rows
  } catch (e) {
    logger.error('expireReservations:', e.message)
    return []
  }
}

module.exports = { createReservation, findAvailableTable, findAlternativeTimes, expireReservations }
