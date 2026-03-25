const fetch = require('node-fetch');
const config = require('../config/env');
const logger = require('../config/logger');

async function sendMessage(chatId, text, parseMode = 'HTML') {
  if (!config.BOT_TOKEN || !chatId) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode })
    });
    if (!response.ok) logger.error('Telegram send failed', await response.text());
  } catch (err) {
    logger.error('Telegram send error', err);
  }
}

async function notifyUser(userId, type, data) {
  // Get user's telegram_id and language from DB
  const db = require('../config/database');
  const user = await db.query('SELECT telegram_id, language FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.telegram_id) return;
  const lang = user.rows[0].language || 'uz';
  const texts = require('../bot/services/i18n')(lang);
  let text = '';
  switch (type) {
    case 'new_reservation':
      text = texts.new_booking(data.restaurant_name, data.date, data.time, data.guests);
      break;
    case 'confirmed':
      text = texts.booking_confirmed(data.restaurant_name, data.date, data.time);
      break;
    case 'cancelled':
      text = texts.booking_cancelled(data.restaurant_name, data.date, data.time);
      break;
  }
  await sendMessage(user.rows[0].telegram_id, text);
}

module.exports = { sendMessage, notifyUser };
