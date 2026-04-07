
const router = require('express').Router();
const { pool } = require('../config/db');
const { apiLimiter } = require('../middleware/security');
const { getBusySlots } = require('../services/reservationService');

router.get('/', apiLimiter, async (req, res, next) => {
  try {
    const { search, cuisine, price, premium, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = `WHERE r.status = 'approved'`;
    if (search) { params.push(`%${search}%`); where += ` AND (r.name ILIKE $${params.length} OR r.address ILIKE $${params.length})`; }
    if (cuisine) { params.push(cuisine); where += ` AND $${params.length}=ANY(r.cuisine)`; }
    if (price)   { params.push(price);   where += ` AND r.price_category=$${params.length}`; }
    if (premium === 'true') where += ` AND r.is_premium=true`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(
      `SELECT r.id,r.name,r.description,r.address,r.phone,r.cuisine,r.price_category,r.rating,
              r.review_count,r.image_url,r.working_hours,r.latitude,r.longitude,r.capacity,r.is_premium
       FROM restaurants r ${where}
       ORDER BY r.is_premium DESC,r.rating DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { rows } = await pool.query(`SELECT * FROM restaurants WHERE id=$1 AND status='approved'`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Restoran topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/menu', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,name,category,price,description,image_url FROM menu_items
       WHERE restaurant_id=$1 AND is_available=true ORDER BY category,name`,
      [parseInt(req.params.id)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id/zones', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,name,description,icon,capacity FROM zones
       WHERE restaurant_id=$1 AND is_available=true ORDER BY created_at`,
      [parseInt(req.params.id)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// YANGI ENDPOINT — stollar
router.get('/:id/tables', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { date, time } = req.query;
    const { rows: tables } = await pool.query(
      `SELECT t.id,t.table_number,t.capacity,t.zone_id,
              z.name as zone_name,z.icon as zone_icon
       FROM tables t LEFT JOIN zones z ON t.zone_id=z.id
       WHERE t.restaurant_id=$1 AND t.is_available=true
       ORDER BY z.name,t.table_number`, [id]
    );
    if (date && time && tables.length) {
      const tableIds = tables.map(t => t.id);
      const { rows: booked } = await pool.query(
        `SELECT DISTINCT table_id FROM reservations
         WHERE table_id=ANY($1) AND date=$2 AND time=$3
           AND status NOT IN ('cancelled')`,
        [tableIds, date, time]
      );
      const bookedIds = new Set(booked.map(r => r.table_id));
      return res.json(tables.map(t => ({ ...t, is_booked: bookedIds.has(t.id) })));
    }
    res.json(tables);
  } catch (err) { next(err); }
});

router.get('/:id/availability', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date kerak' });
    const busyTimes = await getBusySlots(id, date);
    const { rows: blocked } = await pool.query(
      `SELECT time::text FROM availability WHERE restaurant_id=$1 AND date=$2 AND is_blocked=true`,
      [id, date]
    );
    blocked.forEach(r => { const t=r.time.slice(0,5); if(!busyTimes.includes(t)) busyTimes.push(t); });
    res.json({ date, busy_times: busyTimes });
  } catch (err) { next(err); }
});

router.get('/:id/reviews', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT rv.id,rv.rating,rv.comment,rv.photo_url,rv.created_at,u.first_name,u.last_name
       FROM reviews rv JOIN users u ON rv.user_id=u.id
       WHERE rv.restaurant_id=$1 ORDER BY rv.created_at DESC LIMIT 50`, [id]
    );
    const { rows: stats } = await pool.query(
      `SELECT AVG(rating)::numeric(3,1) as avg_rating,COUNT(*)::int as total,
              COUNT(*) FILTER(WHERE rating=5)::int as five_star,
              COUNT(*) FILTER(WHERE rating=4)::int as four_star,
              COUNT(*) FILTER(WHERE rating=3)::int as three_star,
              COUNT(*) FILTER(WHERE rating=2)::int as two_star,
              COUNT(*) FILTER(WHERE rating=1)::int as one_star
       FROM reviews WHERE restaurant_id=$1`, [id]
    );
    res.json({ reviews: rows, stats: stats[0] });
  } catch (err) { next(err); }
});

module.exports = router;
