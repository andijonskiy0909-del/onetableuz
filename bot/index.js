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
      `✅ Broningiz tasdiqlandi!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nRestoranga vaqtida keling! 🙌`,
    booking_cancelled: (name, date, time) =>
      `❌ Afsuski, broningiz bekor qilindi.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Tilni tanlang:',
    review_ask: (name) => `⭐ <b>${name}</b> restoraniga qanday baho berasiz?\n\nQuyidagi yulduzlardan birini tanlang:`,
    review_comment_ask: '💬 Sharh yozmoqchimisiz? Yozing yoki o\'tkazib yuboring:',
    review_photo_ask: '📸 Rasm yubormoqchimisiz? Yuboring yoki o\'tkazib yuboring:',
    review_skip: '⏭ O\'tkazib yuborish',
    review_saved: '✅ Rahmat! Sizning bahoyingiz saqlandi 🙏',
    review_star: (n) => '⭐'.repeat(n) + ' '.repeat(5 - n) + `(${n}/5)`,
    review_cancel: '❌ Bekor qilish',
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
      `✅ Бронирование подтверждено!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nПриходите вовремя! 🙌`,
    booking_cancelled: (name, date, time) =>
      `❌ К сожалению, ваше бронирование отменено.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Выберите язык:',
    review_ask: (name) => `⭐ Как вы оцениваете ресторан <b>${name}</b>?\n\nВыберите звёзды:`,
    review_comment_ask: '💬 Хотите написать отзыв? Напишите или пропустите:',
    review_photo_ask: '📸 Хотите прикрепить фото? Отправьте или пропустите:',
    review_skip: '⏭ Пропустить',
    review_saved: '✅ Спасибо! Ваша оценка сохранена 🙏',
    review_star: (n) => '⭐'.repeat(n) + ' '.repeat(5 - n) + `(${n}/5)`,
    review_cancel: '❌ Отмена',
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
      `✅ Booking confirmed!\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}\n\nSee you there! 🙌`,
    booking_cancelled: (name, date, time) =>
      `❌ Unfortunately, your booking was cancelled.\n\n🍽 ${name}\n📅 ${date} — ⏰ ${time}`,
    choose_lang: 'Choose language:',
    review_ask: (name) => `⭐ How would you rate <b>${name}</b>?\n\nChoose your rating:`,
    review_comment_ask: '💬 Want to leave a comment? Write it or skip:',
    review_photo_ask: '📸 Want to add a photo? Send it or skip:',
    review_skip: '⏭ Skip',
    review_saved: '✅ Thank you! Your review has been saved 🙏',
    review_star: (n) => '⭐'.repeat(n) + ' '.repeat(5 - n) + `(${n}/5)`,
    review_cancel: '❌ Cancel',
  }
};

// ── State ─────────────────────────────────────────────────────
const userLangs = {};
// reviewState: { step: 'rating'|'comment'|'photo', reservationId, restaurantId, restaurantName, rating, comment }
const reviewStates = {};

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

  if (!userLangs[userId]) {
    if (langCode.startsWith('ru')) userLangs[userId] = 'ru';
    else if (langCode.startsWith('en')) userLangs[userId] = 'en';
    else userLangs[userId] = 'uz';
  }

  bot.sendMessage(chatId, T(userId, 'welcome', firstName), {
    parse_mode: 'HTML',
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

// ── /help ────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, T(msg.from.id, 'help'));
});

// ── /restaurants ─────────────────────────────────────────────
bot.onText(/\/restaurants/, (msg) => {
  const userId = msg.from.id;
  bot.sendMessage(msg.chat.id, T(userId, 'open_restaurants'), {
    reply_markup: {
      inline_keyboard: [[{ text: T(userId, 'open_btn'), web_app: { url: WEBAPP_URL } }]]
    }
  });
});

// ── /mybookings ──────────────────────────────────────────────
bot.onText(/\/mybookings/, (msg) => {
  const userId = msg.from.id;
  bot.sendMessage(msg.chat.id, T(userId, 'btn_bookings'), {
    reply_markup: {
      inline_keyboard: [[{ text: T(userId, 'btn_bookings'), web_app: { url: WEBAPP_URL } }]]
    }
  });
});

// ── Callback query handler ────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;

  // Til tanlash
  if (data.startsWith('lang_')) {
    const lang = data.replace('lang_', '');
    userLangs[userId] = lang;
    await bot.answerCallbackQuery(query.id);
    const firstName = query.from.first_name || '';
    bot.editMessageText(T(userId, 'welcome', firstName), {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
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
    return;
  }

  // ⭐ Baho tanlash
  if (data.startsWith('review_rate_')) {
    const parts = data.split('_'); // review_rate_5_reservationId_restaurantId
    const rating = parseInt(parts[2]);
    const reservationId = parts[3];
    const restaurantId = parts[4];

    await bot.answerCallbackQuery(query.id, { text: T(userId, 'review_star', rating) });

    reviewStates[userId] = {
      step: 'comment',
      reservationId,
      restaurantId,
      restaurantName: reviewStates[userId]?.restaurantName || '',
      rating
    };

    bot.sendMessage(chatId, T(userId, 'review_comment_ask'), {
      reply_markup: {
        inline_keyboard: [[{ text: T(userId, 'review_skip'), callback_data: 'review_skip_comment' }]]
      }
    });
    return;
  }

  // Sharhni o'tkazib yuborish
  if (data === 'review_skip_comment') {
    await bot.answerCallbackQuery(query.id);
    if (reviewStates[userId]) {
      reviewStates[userId].step = 'photo';
      reviewStates[userId].comment = '';
    }
    bot.sendMessage(chatId, T(userId, 'review_photo_ask'), {
      reply_markup: {
        inline_keyboard: [[{ text: T(userId, 'review_skip'), callback_data: 'review_skip_photo' }]]
      }
    });
    return;
  }

  // Rasmni o'tkazib yuborish
  if (data === 'review_skip_photo') {
    await bot.answerCallbackQuery(query.id);
    await saveReview(userId, chatId, null);
    return;
  }

  // Reviewni bekor qilish
  if (data === 'review_cancel') {
    await bot.answerCallbackQuery(query.id);
    delete reviewStates[userId];
    return;
  }
});

// ── Xabar handler (sharh va rasm uchun) ──────────────────────
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const state = reviewStates[userId];

  if (!state) return;

  // Sharh yozish
  if (state.step === 'comment' && msg.text && !msg.text.startsWith('/')) {
    state.comment = msg.text;
    state.step = 'photo';

    bot.sendMessage(chatId, T(userId, 'review_photo_ask'), {
      reply_markup: {
        inline_keyboard: [[{ text: T(userId, 'review_skip'), callback_data: 'review_skip_photo' }]]
      }
    });
    return;
  }

  // Rasm yuborish
  if (state.step === 'photo' && msg.photo) {
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    // Telegram file URL ni olish
    const fileInfo = await bot.getFile(photoId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    await saveReview(userId, chatId, photoUrl);
    return;
  }
});

// ── Reviewni APIga saqlash ────────────────────────────────────
async function saveReview(userId, chatId, photoUrl) {
  const state = reviewStates[userId];
  if (!state) return;

  try {
    const res = await fetch(`${API_URL}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: userId,
        reservation_id: state.reservationId,
        restaurant_id: state.restaurantId,
        rating: state.rating,
        comment: state.comment || null,
        photo_url: photoUrl || null
      })
    });

    if (res.ok) {
      bot.sendMessage(chatId, T(userId, 'review_saved'));
    } else {
      bot.sendMessage(chatId, '❌ Saqlashda xatolik. Keyinroq urinib ko\'ring.');
    }
  } catch (e) {
    console.error('Review saqlashda xatolik:', e.message);
  } finally {
    delete reviewStates[userId];
  }
}

// ── Review so'rash (bron tasdiqlangandan keyin chaqiriladi) ───
async function askForReview(telegramId, reservationId, restaurantId, restaurantName) {
  try {
    const userId = telegramId;
    const lang = userLangs[userId] || 'uz';

    // State ni tayyorlash
    reviewStates[userId] = {
      step: 'rating',
      reservationId: String(reservationId),
      restaurantId: String(restaurantId),
      restaurantName,
      rating: null,
      comment: null
    };

    const stars = [1, 2, 3, 4, 5].map(n => ({
      text: '⭐'.repeat(n),
      callback_data: `review_rate_${n}_${reservationId}_${restaurantId}`
    }));

    await bot.sendMessage(telegramId, i18n[lang].review_ask(restaurantName), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          stars.slice(0, 3),
          [...stars.slice(3), { text: i18n[lang].review_cancel, callback_data: 'review_cancel' }]
        ]
      }
    });
  } catch (e) {
    console.error('Review so\'rash xatoligi:', e.message);
  }
}

// ── Bildirishnoma yuborish ────────────────────────────────────
async function sendBookingNotification(telegramId, type, data) {
  try {
    const userId = telegramId;
    const lang = userLangs[userId] || 'uz';
    let text = '';

    if (type === 'new') {
      text = i18n[lang].new_booking(data.restaurant_name, data.date, data.time, data.guests);
    } else if (type === 'confirmed') {
      text = i18n[lang].booking_confirmed(data.restaurant_name, data.date, data.time);

      // Bron tasdiqlangandan 2 soniya keyin review so'rash
      setTimeout(() => {
        askForReview(telegramId, data.reservation_id, data.restaurant_id, data.restaurant_name);
      }, 2000);

    } else if (type === 'cancelled') {
      text = i18n[lang].booking_cancelled(data.restaurant_name, data.date, data.time);
    }

    if (text) {
      await bot.sendMessage(telegramId, text, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Bildirishnoma yuborishda xatolik:', err.message);
  }
}

module.exports = { bot, sendBookingNotification, askForReview };

console.log('✅ OneTable bot ishga tushdi! (UZ/RU/EN) — Review tizimi faol ⭐');
