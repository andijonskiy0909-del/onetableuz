require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://onetableuz.vercel.app';
const API_URL = process.env.API_URL || 'https://onetableuz-production.up.railway.app/api';

// ── Tarjimalar ───────────────────────────────────────────────
const i18n = {
  uz: {
    welcome: (name) => `Salom, ${name}! 👋\n\nOneTable — Har bir kechani unutilmas qiling. ✨\n\n🍽 Restoranlarni ko'ring\n📅 Bron qiling\n⭐ Baholang`,
    btn_restaurants: '🍽 Restoranlarni ko\'rish',
    btn_bookings: '📅 Bronlarim',
    help: '📱 OneTable buyruqlari:\n\n/start — Botni boshlash\n/mybookings — Bronlarim\n/help — Yordam',
    open_restaurants: 'Restoranlarni ko\'rish uchun:',
    open_btn: '🍽 Restoranlarni ochish',
    new_booking: (name, date, time, guests) =>
      `🎉 Yangi bron!\n\n🍽 Restoran: ${name}\n📅 Sana: ${date}\n⏰ Vaqt: ${time}\n👥 Mehmonlar: ${guests} kishi`,
    booking_confirmed: (name, date, time) =>
      `✅ Broningiz tasdiqlandi!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nRestoranga vaqtida keling!`,
    booking_cancelled: (name, date, time) =>
      `❌ Afsuski, broningiz bekor qilindi.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Tilni tanlang:',
  },
  ru: {
    welcome: (name) => `Привет, ${name}! 👋\n\nOneTable — Сделайте каждый вечер незабываемым. ✨\n\n🍽 Смотрите рестораны\n📅 Бронируйте\n⭐ Оценивайте`,
    btn_restaurants: '🍽 Смотреть рестораны',
    btn_bookings: '📅 Мои брони',
    help: '📱 Команды OneTable:\n\n/start — Запустить бота\n/mybookings — Мои брони\n/help — Помощь',
    open_restaurants: 'Для просмотра ресторанов:',
    open_btn: '🍽 Открыть рестораны',
    new_booking: (name, date, time, guests) =>
      `🎉 Новое бронирование!\n\n🍽 Ресторан: ${name}\n📅 Дата: ${date}\n⏰ Время: ${time}\n👥 Гостей: ${guests}`,
    booking_confirmed: (name, date, time) =>
      `✅ Бронирование подтверждено!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nПриходите вовремя!`,
    booking_cancelled: (name, date, time) =>
      `❌ К сожалению, ваше бронирование отменено.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Выберите язык:',
  },
  en: {
    welcome: (name) => `Hello, ${name}! 👋\n\nOneTable — Make every evening unforgettable. ✨\n\n🍽 Browse restaurants\n📅 Make bookings\n⭐ Leave reviews`,
    btn_restaurants: '🍽 Browse Restaurants',
    btn_bookings: '📅 My Bookings',
    help: '📱 OneTable commands:\n\n/start — Start the bot\n/mybookings — My bookings\n/help — Help',
    open_restaurants: 'To browse restaurants:',
    open_btn: '🍽 Open Restaurants',
    new_booking: (name, date, time, guests) =>
      `🎉 New booking!\n\n🍽 Restaurant: ${name}\n📅 Date: ${date}\n⏰ Time: ${time}\n👥 Guests: ${guests}`,
    booking_confirmed: (name, date, time) =>
      `✅ Booking confirmed!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nSee you there!`,
    booking_cancelled: (name, date, time) =>
      `❌ Unfortunately, your booking was cancelled.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Choose language:',
  }
};

// Foydalanuvchi tilini saqlash (xotirada)
const userLangs = {};

function getLang(userId, fromLang) {
  if (userLangs[userId]) return userLangs[userId];
  if (fromLang) {
    if (fromLang.startsWith('ru')) return 'ru';
    if (fromLang.startsWith('en')) return 'en';
  }
  return 'uz';
}

function T(userId, key, ...args) {
  const lang = userLangs[userId] || 'uz';
  const val = i18n[lang][key];
  if (typeof val === 'function') return val(...args);
  return val || key;
}

// ── /start ───────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'Foydalanuvchi';
  const langCode = msg.from.language_code || 'uz';

  // Tilni avtomatik aniqlash (agar tanlanmagan bo'lsa)
  if (!userLangs[userId]) {
    if (langCode.startsWith('ru')) userLangs[userId] = 'ru';
    else if (langCode.startsWith('en')) userLangs[userId] = 'en';
    else userLangs[userId] = 'uz';
  }

  bot.sendMessage(chatId, T(userId, 'welcome', firstName), {
    reply_markup: {
      inline_keyboard: [
        [{ text: T(userId, 'btn_restaurants'), web_app: { url: WEBAPP_URL } }],
        [{ text: T(userId, 'btn_bookings'), web_app: { url: WEBAPP_URL } }],
        [
          { text: '🇺🇿', callback_data: 'lang_uz' },
          { text: '🇷🇺', callback_data: 'lang_ru' },
          { text: '🇬🇧', callback_data: 'lang_en' }
        ]
      ]
    }
  });
});

// ── Til tanlash ──────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('lang_')) {
    const lang = data.replace('lang_', '');
    userLangs[userId] = lang;
    await bot.answerCallbackQuery(query.id);
    const firstName = query.from.first_name || '';

    // Xabarni yangi tilda yangilash
    bot.editMessageText(T(userId, 'welcome', firstName), {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: T(userId, 'btn_restaurants'), web_app: { url: WEBAPP_URL } }],
          [{ text: T(userId, 'btn_bookings'), web_app: { url: WEBAPP_URL } }],
          [
            { text: '🇺🇿', callback_data: 'lang_uz' },
            { text: '🇷🇺', callback_data: 'lang_ru' },
            { text: '🇬🇧', callback_data: 'lang_en' }
          ]
        ]
      }
    });
  }
});

// ── /help ────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, T(msg.from.id, 'help'));
});

// ── /restaurants ─────────────────────────────────────────────
bot.onText(/\/restaurants/, (msg) => {
  const userId = msg.from.id;
  bot.sendMessage(msg.chat.id, T(userId, 'open_restaurants'), {
    reply_markup: {
      inline_keyboard: [[
        { text: T(userId, 'open_btn'), web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// ── /mybookings ──────────────────────────────────────────────
bot.onText(/\/mybookings/, (msg) => {
  const userId = msg.from.id;
  bot.sendMessage(msg.chat.id, T(userId, 'btn_bookings'), {
    reply_markup: {
      inline_keyboard: [[
        { text: T(userId, 'btn_bookings'), web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// ── Bron bildirishnomasi (API dan chaqiriladi) ───────────────
// Bu funksiya API orqali chaqiriladi:
// POST /api/bot/notify { telegram_id, type, restaurant_name, date, time, guests }
// API da bot instance import qilib, shu funksiyani chaqiring

async function sendBookingNotification(telegramId, type, data) {
  try {
    const userId = telegramId;
    const lang = userLangs[userId] || 'uz';
    let text = '';

    if (type === 'new') {
      text = i18n[lang].new_booking(data.restaurant_name, data.date, data.time, data.guests);
    } else if (type === 'confirmed') {
      text = i18n[lang].booking_confirmed(data.restaurant_name, data.date, data.time);
    } else if (type === 'cancelled') {
      text = i18n[lang].booking_cancelled(data.restaurant_name, data.date, data.time);
    }

    if (text) {
      await bot.sendMessage(telegramId, text);
    }
  } catch (err) {
    console.error('Bildirishnoma yuborishda xatolik:', err.message);
  }
}

module.exports = { bot, sendBookingNotification };

console.log('✅ OneTable bot ishga tushdi! (UZ/RU/EN)');
