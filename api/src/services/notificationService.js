const logger = require('../logger')
async function sendTelegram(telegramId, text, keyboard = null) {
  try {
    const token = process.env.BOT_TOKEN
    if (!token || !telegramId) return false

    const body = { chat_id: telegramId, text, parse_mode: 'HTML' }
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return res.ok
  } catch(e) {
    logger.error('Telegram send error:', e.message)
    return false
  }
}

async function notifyBookingCreated(booking, user, zone) {
  if (!user?.telegram_id) return
  const text =
    `🎉 <b>Bron qabul qilindi!</b>\n\n` +
    `🍽 <b>${booking.restaurant_name}</b>\n` +
    `📅 ${booking.date} — ⏰ ${String(booking.time).slice(0,5)}\n` +
    `👥 ${booking.guests} kishi | 🪑 Stol #${booking.table_number}\n` +
    `${zone ? `🏠 Zona: ${zone}\n` : ''}` +
    `${booking.special_request ? `⭐ Maxsus: ${booking.special_request}\n` : ''}` +
    `${booking.pre_order_total ? `🍜 Pre-order: ${booking.pre_order_total.toLocaleString()} so'm\n` : ''}` +
    `\n⏳ Restoran tasdiqlaguncha kuting.`
  await sendTelegram(user.telegram_id, text)
}

async function notifyOwnerNewBooking(booking, user, ownerTelegramId, zone) {
  if (!ownerTelegramId) return
  const text =
    `🔔 <b>Yangi bron!</b>\n\n` +
    `👤 ${user?.first_name || 'Noma\'lum'}\n` +
    `📅 ${booking.date} — ⏰ ${String(booking.time).slice(0,5)}\n` +
    `👥 ${booking.guests} kishi | 🪑 Stol #${booking.table_number}\n` +
    `${zone ? `🏠 ${zone}\n` : ''}` +
    `${booking.special_request ? `⭐ Maxsus so'rov: ${booking.special_request}\n` : ''}` +
    `${booking.pre_order_total ? `🍜 Pre-order: ${booking.pre_order_total.toLocaleString()} so'm\n` : ''}`
  await sendTelegram(ownerTelegramId, text)
}

async function notifyBookingStatus(telegramId, status, booking) {
  if (!telegramId) return
  const date = String(booking.date).split('T')[0]
  const time = String(booking.time).slice(0, 5)
  const name = booking.restaurant_name || 'Restoran'

  const messages = {
    confirmed: `✅ <b>Broningiz tasdiqlandi!</b>\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n👥 ${booking.guests} kishi\n\nRestoranga vaqtida keling! 🙌`,
    cancelled:  `❌ <b>Broningiz bekor qilindi.</b>\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    completed:  `🎉 <b>Tashrifingiz uchun rahmat!</b>\n\n🍽 ${name}\nIltimos, restoran haqida fikr bildiring! ⭐`,
  }

  const text = messages[status]
  if (text) await sendTelegram(telegramId, text)
}

async function notifyPaymentSuccess(telegramId, booking) {
  if (!telegramId) return
  const text =
    `💳 <b>To'lov qabul qilindi!</b>\n\n` +
    `🍽 ${booking.restaurant_name}\n` +
    `📅 ${String(booking.date).split('T')[0]} — ⏰ ${String(booking.time).slice(0,5)}\n` +
    `💰 ${booking.amount?.toLocaleString()} so'm\n\n` +
    `🎉 Broningiz tasdiqlandi!`
  await sendTelegram(telegramId, text)
}

async function notifyOwnerNewMessage(ownerTelegramId, senderName, message, reservationId) {
  if (!ownerTelegramId) return
  await sendTelegram(ownerTelegramId,
    `💬 <b>Yangi xabar!</b>\n👤 ${senderName}: ${message}\n\n📅 Bron #${reservationId}`
  )
}

module.exports = {
  sendTelegram,
  notifyBookingCreated,
  notifyOwnerNewBooking,
  notifyBookingStatus,
  notifyPaymentSuccess,
  notifyOwnerNewMessage
}
