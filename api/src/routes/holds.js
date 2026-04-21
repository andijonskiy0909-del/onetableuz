const router = require('express').Router();
const bookingService = require('../services/bookingService');
const logger = require('../config/logger');

// POST /api/holds — stol uchun hold yaratish
router.post('/', async (req, res) => {
  try {
    const { tableId, date, time, sessionId, userId } = req.body;
    
    if (!tableId || !date || !time || !sessionId) {
      return res.status(400).json({ error: 'tableId, date, time, sessionId — majburiy' });
    }
    
    const result = await bookingService.createHold({
      tableId: Number(tableId),
      date,
      time,
      sessionId,
      userId: userId ? Number(userId) : null
    });
    
    res.json(result);
  } catch (err) {
    logger.warn(`Hold create failed: ${err.message}`);
    res.status(409).json({ error: err.message });
  }
});

// DELETE /api/holds — hold'ni bekor qilish
router.delete('/', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId majburiy' });
    }
    
    await bookingService.releaseHold(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/holds/check — stol bo'shligini tekshirish
router.get('/check', async (req, res) => {
  try {
    const { tableId, date, time } = req.query;
    if (!tableId || !date || !time) {
      return res.status(400).json({ error: 'tableId, date, time — majburiy' });
    }
    
    const available = await bookingService.isTableAvailable(
      Number(tableId), date, time
    );
    
    res.json({ available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
