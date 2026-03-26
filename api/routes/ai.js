// src/routes/ai.js — AI Assistant route
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const { apiLimiter } = require('../middleware/security');
const { env } = require('../config/env');

const SYSTEM_PROMPTS = {
  uz: `Sen OneTable platformasining AI yordamchisisisan. Toshkentdagi restoranlar uchun smart booking platformasi. Restoranlar, bron qilish va menyu haqida qisqa va do'stona yordam ber. O'zbek tilida yoz.`,
  ru: `Ты AI-ассистент платформы OneTable. Умная система бронирования ресторанов в Ташкенте. Помогай с ресторанами и бронированием. Отвечай кратко по-русски.`,
  en: `You are the AI assistant for OneTable platform. Smart restaurant booking in Tashkent. Help with restaurants, bookings and menu. Be brief and friendly in English.`
};

// POST /api/ai/chat
router.post('/chat', apiLimiter, async (req, res, next) => {
  try {
    const { message, lang = 'uz', history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message kerak' });
    if (!env.GROQ_API_KEY) return res.status(503).json({ error: 'AI service unavailable' });

    // Fetch restaurant context
    let restaurantsContext = '';
    try {
      const { rows } = await pool.query(
        `SELECT name, cuisine, price_category, address FROM restaurants WHERE status='approved' LIMIT 8`
      );
      if (rows.length) {
        restaurantsContext = '\nMavjud restoranlar:\n' + rows.map(r =>
          `- ${r.name} (${(r.cuisine || []).join(', ')}, ${r.price_category}, ${r.address})`
        ).join('\n');
      }
    } catch {}

    const systemPrompt = (SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.uz) + restaurantsContext;

    // Limit history to last 10 messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 500, temperature: 0.7 })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'AI javob bermadi' });

    res.json({ reply });
  } catch (err) { next(err); }
});

module.exports = router;
