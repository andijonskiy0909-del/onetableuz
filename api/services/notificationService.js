// src/services/notificationService.js — Telegram notification service
'use strict';

const { env } = require('../config/env');
const logger = require('../config/logger');

const TG_API = `https://api.telegram.org/bot${env.BOT_TOKEN}`;

async function sendMessage(chatId, text, options = {}) {
  if (!env.BOT_TOKEN || !chatId) return false;
  try {
    const res = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options })
    });
    const data = await res.json();
    if (!data.ok) {
      logger.warn('Telegram send failed', { chatId, error: data.description });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Telegram notification error', { error: err.message, chatId });
    return false;
  }
}

// ── Reservation notifications ─────────────────────────────────

async function notifyBookingCreated(telegramId, booking, restaurantName, zoneName) {
  const text =
    `🎉 <b>Bron qabul qilindi!</b>\n\n` +
    `🍽 <b>${restaurantName}</b>\n` +
    `📅 Sana: ${booking.date}\n` +
    `⏰ Vaqt: ${String(booking.time).slice(0, 5)}\n` +
    `👥 Mehmonlar: ${booking.guests} kishi\n` +
    `${zoneName ? `🏠 Zona: ${zoneName}\n` : ''}` +
    `${booking.comment ? `💬 Izoh: ${booking.comment}\n` : ''}` +
    `\n⏳ Restoran tasdiqlaguncha kuting.`;
  return sendMessage(telegramId, text);
}

async function notifyDepositRequired(telegramId, booking, restaurantName, depositAmount) {
  const text =
    `⚠️ <b>Depozit talab qilinadi!</b>\n\n` +
    `🍽 <b>${restaurantName}</b>\n` +
    `📅 ${booking.date} — ⏰ ${String(booking.time).slice(0, 5)}\n` +
    `👥 ${booking.guests} kishi\n\n` +
    `❗ Avvalgi broningizda kelmadingiz.\n` +
    `💳 Bron tasdiqlashi uchun <b>${depositAmount.toLocaleString()} so'm</b> depozit to'lang.`;
  return sendMessage(telegramId, text);
}

async function notifyDepositPaymentOptions(telegramId, bookingId) {
  return sendMessage(telegramId, `💳 To'lov usulini tanlang:`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '💳 Click', callback_data: `pay_click_${bookingId}` },
        { text: '💳 Payme', callback_data: `pay_payme_${bookingId}` }
      ]]
    }
  });
}

async function notifyBookingConfirmed(telegramId, booking, restaurantName) {
  const text =
    `✅ <b>Broningiz tasdiqlandi!</b>\n\n` +
    `🍽 ${restaurantName}\n` +
    `📅 ${String(booking.date).split('T')[0]} — ⏰ ${String(booking.time).slice(0, 5)}\n` +
    `👥 ${booking.guests} kishi\n\n` +
    `🙌 Restoranga vaqtida keling!`;
  return sendMessage(telegramId, text);
}

async function notifyBookingCancelled(telegramId, booking, restaurantName) {
  const text =
    `❌ <b>Broningiz rad etildi.</b>\n\n` +
    `🍽 ${restaurantName}\n` +
    `📅 ${String(booking.date).split('T')[0]} — ⏰ ${String(booking.time).slice(0, 5)}`;
  return sendMessage(telegramId, text);
}

async function notifyBookingCompleted(telegramId, restaurantName) {
  const text = `🎉 <b>Tashrifingiz uchun rahmat!</b>\n\n🍽 ${restaurantName}\n\nIltimos, restoran haqida fikr qoldiring.`;
  return sendMessage(telegramId, text);
}

async function notifyBookingCancelledByUser(telegramId, booking, restaurantName) {
  const text =
    `🗑 <b>Bron bekor qilindi</b>\n\n` +
    `🍽 ${restaurantName}\n` +
    `📅 ${String(booking.date).split('T')[0]} — ⏰ ${String(booking.time).slice(0, 5)}`;
  return sendMessage(telegramId, text);
}

async function notifyNoShow(telegramId, depositAmount) {
  const text =
    `⚠️ <b>Eslatma!</b>\n\n` +
    `Siz bugungi broningizga kelmagandingiz.\n\n` +
    `Keyingi bronda <b>${depositAmount.toLocaleString()} so'm</b> depozit talab qilinadi.`;
  return sendMessage(telegramId, text);
}

async function notifyPaymentSuccess(telegramId, booking, restaurantName) {
  const text =
    `✅ <b>To'lov qabul qilindi!</b>\n\n` +
    `🍽 <b>${restaurantName}</b>\n` +
    `📅 ${String(booking.date).split('T')[0]} — ⏰ ${String(booking.time).slice(0, 5)}\n` +
    `👥 ${booking.guests} kishi\n\n` +
    `🎉 Broningiz tasdiqlandi!`;
  return sendMessage(telegramId, text);
}

module.exports = {
  sendMessage,
  notifyBookingCreated,
  notifyDepositRequired,
  notifyDepositPaymentOptions,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingCompleted,
  notifyBookingCancelledByUser,
  notifyNoShow,
  notifyPaymentSuccess
};
