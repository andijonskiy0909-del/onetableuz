// bot/src/index.js — OneTable Bot (FIXED)
'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const API = process.env.API_URL || 'https://onetableuz-production.up.railway.app/api';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://onetableuz.vercel.app';

// ── Tarjimalar ────────────────────────────────────────────────
const i18n = {
  uz: {
    welcome: n => `Salom, ${n}! 👋\n\nOneTable — Restoranlarni bron qilish platformasi. ✨`,
    btn_webapp: '🍽 Restoranlarni ochish',
    btn_book: '📅 Bron qilish',
    btn_mybookings: '📋 Bronlarim',
    btn_ai: '🤖 AI Yordamchi',
    choose_restaurant: '🍽 Restoran tanlang:',
    choose_date: '📅 Sana kiriting (YYYY-MM-DD):',
    choose_time: '⏰ Vaqt tanlang:',
    choose_guests: '👥 Mehmonlar sonini tanlang:',
    choose_table: '🪑 Stol tanlang:',
    choose_zone: '🏠 Zona tanlang:',
    no_tables: 'Bu vaqtda stollar to\'liq band. Boshqa vaqt tanlang.',
    no_restaurants: 'Restoranlar topilmadi.',
    booking_sent: '✅ Bron so\'rovi yuborildi! Restoran tasdiqlaganda xabar keladi.',
    booking_error: '❌ Xatolik yuz berdi. Qayta urinib ko\'ring.',
    cancel_booking: 'Bronni bekor qilish',
    my_bookings_empty: '📭 Sizda hozircha bron yo\'q.',
    status_pending: '⏳ Kutilmoqda',
    status_confirmed: '✅ Tasdiqlangan',
    status_cancelled: '❌ Bekor qilingan',
    status_completed: '🎉 Bajarildi',
    ai_mode: '🤖 AI Yordamchi faol! Savolingizni yozing.\n/start — chiqish',
    login_first: '🔐 Avval Telegram orqali kirishingiz kerak.',
    back: '⬅️ Orqaga',
    skip: '⏭ O\'tkazib yuborish',
    table_free: '🟢 Bo\'sh',
    table_busy: '🔴 Band',
    persons: n => `${n} kishi`,
    deposit_warning: `⚠️ Avvalgi broniga kelmagansiz!\n💳 Keyingi bron uchun depozit to'lash kerak.`,
    noshow_warning: n => `⚠️ Avval kelmagansiz. Depozit: ${n.toLocaleString()} so'm`,
  },
  ru: {
    welcome: n => `Привет, ${n}! 👋\n\nOneTable — Бронирование ресторанов. ✨`,
    btn_webapp: '🍽 Открыть рестораны',
    btn_book: '📅 Забронировать',
    btn_mybookings: '📋 Мои брони',
    btn_ai: '🤖 AI Ассистент',
    choose_restaurant: '🍽 Выберите ресторан:',
    choose_date: '📅 Введите дату (YYYY-MM-DD):',
    choose_time: '⏰ Выберите время:',
    choose_guests: '👥 Выберите количество гостей:',
    choose_table: '🪑 Выберите стол:',
    choose_zone: '🏠 Выберите зону:',
    no_tables: 'В это время все столы заняты. Выберите другое время.',
    no_restaurants: 'Рестораны не найдены.',
    booking_sent: '✅ Заявка отправлена! Уведомим после подтверждения.',
    booking_error: '❌ Произошла ошибка. Попробуйте снова.',
    status_pending: '⏳ Ожидание',
    status_confirmed: '✅ Подтверждено',
    status_cancelled: '❌ Отменено',
    status_completed: '🎉 Завершено',
    ai_mode: '🤖 AI Ассистент активен! Задайте вопрос.\n/start — выход',
    back: '⬅️ Назад',
    skip: '⏭ Пропустить',
    table_free: '🟢 Свободен',
    table_busy: '🔴 Занят',
    persons: n => `${n} чел.`,
    noshow_warning: n => `⚠️ Вы не пришли. Депозит: ${n.toLocaleString()} сум`,
  }
};

// ── State management ──────────────────────────────────────────
const userState = new Map();   // userId → { step, data... }
const userLangs = new Map();   // userId → 'uz'|'ru'
const aiModes   = new Set();   // userIds in AI mode
const aiHistory = new Map();   // userId → [{role,content}]

function T(userId, key, arg) {
  const lang = userLangs.get(userId) || 'uz';
  const t = i18n[lang]?.[key] || i18n.uz[key] || key;
  return typeof t === 'function' ? t(arg) : t;
}

function setState(userId, data) {
  userState.set(userId, { ...userState.get(userId), ...data });
}
function getState(userId) { return userState.get(userId) || {}; }
function clearState(userId) { userState.delete(userId); }

// ── API helpers ───────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) return null;
  return r.json();
}

async function apiPost(path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { ok: r.ok, data: await r.json() };
}

// ── Login (Telegram auth) ─────────────────────────────────────
async function loginUser(from) {
  const { ok, data } = await apiPost('/auth/telegram', {
    telegram_id: from.id,
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name
  });
  return ok ? data.token : null;
}

// ── /start ────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  clearState(userId);
  aiModes.delete(userId);

  // Auto detect language
  if (!userLangs.has(userId)) {
    const lc = msg.from.language_code || 'uz';
    userLangs.set(userId, lc.startsWith('ru') ? 'ru' : 'uz');
  }

  const name = msg.from.first_name || 'Do\'st';
  bot.sendMessage(chatId, T(userId, 'welcome', name), {
    reply_markup: {
      inline_keyboard: [
        [{ text: T(userId, 'btn_webapp'), web_app: { url: WEBAPP_URL } }],
        [{ text: T(userId, 'btn_book'), callback_data: 'book_start' }],
        [{ text: T(userId, 'btn_mybookings'), callback_data: 'my_bookings' }],
        [{ text: T(userId, 'btn_ai'), callback_data: 'ai_start' }],
        [
          { text: '🇺🇿 UZ', callback_data: 'lang_uz' },
          { text: '🇷🇺 RU', callback_data: 'lang_ru' }
        ]
      ]
    }
  });
});

// ── /mybookings shortcut ──────────────────────────────────────
bot.onText(/\/mybookings/, (msg) => showMyBookings(msg.chat.id, msg.from.id));
bot.onText(/\/ai/, (msg) => startAI(msg.chat.id, msg.from.id));

// ─────────────────────────────────────────────────────────────
// BRON JARAYONI (multi-step)
// Step 1: Restoran tanlash
// Step 2: Sana kiritish
// Step 3: Vaqt tanlash
// Step 4: Mehmonlar soni
// Step 5: Zona tanlash (agar bor)
// Step 6: STOL tanlash ← YANGI
// Step 7: Tasdiqlash
// ─────────────────────────────────────────────────────────────

async function startBooking(chatId, userId) {
  const restaurants = await apiGet('/restaurants?limit=20');
  if (!restaurants || !restaurants.length) {
    return bot.sendMessage(chatId, T(userId, 'no_restaurants'));
  }

  setState(userId, { step: 'choose_restaurant', restaurants });

  const buttons = restaurants.slice(0, 10).map(r => ([{
    text: `${r.is_premium ? '💎 ' : ''}${r.name} ⭐${r.rating || '4.5'}`,
    callback_data: `resto_${r.id}`
  }]));

  bot.sendMessage(chatId, T(userId, 'choose_restaurant'), {
    reply_markup: { inline_keyboard: [...buttons, [{ text: T(userId, 'back'), callback_data: 'back_start' }]] }
  });
}

async function askDate(chatId, userId) {
  setState(userId, { step: 'enter_date' });
  const today = new Date().toISOString().split('T')[0];
  bot.sendMessage(chatId,
    `📅 Sanani kiriting:\n\nFormat: <code>YYYY-MM-DD</code>\nMasalan: <code>${today}</code>`,
    { parse_mode: 'HTML' }
  );
}

async function askTime(chatId, userId) {
  const state = getState(userId);
  const { restaurantId, date } = state;

  // Band vaqtlarni ol
  let busyTimes = [];
  try {
    const avail = await apiGet(`/restaurants/${restaurantId}/availability?date=${date}`);
    busyTimes = avail?.busy_times || [];
  } catch {}

  setState(userId, { step: 'choose_time', busyTimes });

  const slots = [];
  for (let h = 10; h <= 21; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`);
    slots.push(`${String(h).padStart(2,'0')}:30`);
  }
  slots.push('22:00');

  const now = new Date();
  const isToday = new Date(date).toDateString() === now.toDateString();

  // 4 ta column → inline keyboard
  const rows = [];
  for (let i = 0; i < slots.length; i += 4) {
    const rowSlots = slots.slice(i, i + 4);
    rows.push(rowSlots.map(s => {
      const [h, m] = s.split(':').map(Number);
      const isPast = isToday && (h * 60 + m) < (now.getHours() * 60 + now.getMinutes() + 60);
      const isBusy = busyTimes.includes(s) || isPast;
      return {
        text: isBusy ? `❌ ${s}` : `✅ ${s}`,
        callback_data: isBusy ? 'slot_busy' : `time_${s}`
      };
    }));
  }
  rows.push([{ text: T(userId, 'back'), callback_data: 'back_date' }]);

  bot.sendMessage(chatId, T(userId, 'choose_time') + `\n\n✅ = Bo'sh  ❌ = Band`, {
    reply_markup: { inline_keyboard: rows }
  });
}

async function askGuests(chatId, userId) {
  setState(userId, { step: 'choose_guests' });
  const buttons = [
    [1,2,3,4].map(n => ({ text: T(userId, 'persons', n), callback_data: `guests_${n}` })),
    [5,6,7,8].map(n => ({ text: T(userId, 'persons', n), callback_data: `guests_${n}` })),
    [{ text: '9+', callback_data: 'guests_9' }, { text: T(userId, 'back'), callback_data: 'back_time' }]
  ];
  bot.sendMessage(chatId, T(userId, 'choose_guests'), { reply_markup: { inline_keyboard: buttons } });
}

async function askZone(chatId, userId) {
  const state = getState(userId);
  const zones = await apiGet(`/restaurants/${state.restaurantId}/zones`);

  if (!zones || !zones.length) {
    // Zona yo'q → to'g'ridan stollarni ko'rsat
    return askTable(chatId, userId);
  }

  setState(userId, { step: 'choose_zone', zones });
  const buttons = zones.map(z => ([{
    text: `${z.icon || '🪑'} ${z.name} (${z.capacity} kishi)`,
    callback_data: `zone_${z.id}`
  }]));
  buttons.push([
    { text: T(userId, 'skip'), callback_data: 'zone_skip' },
    { text: T(userId, 'back'), callback_data: 'back_guests' }
  ]);
  bot.sendMessage(chatId, T(userId, 'choose_zone'), { reply_markup: { inline_keyboard: buttons } });
}

// ─────────────────────────────────────────────────────────────
// ASOSIY FIX: askTable — stollarni ko'rsatish
// Dashboard da qo'shilgan stollar shu yerda ko'rinadi.
// Band stollar ❌, bo'sh stollar ✅ ko'rsatiladi.
// ─────────────────────────────────────────────────────────────
async function askTable(chatId, userId) {
  const state = getState(userId);
  const { restaurantId, date, time, zoneId } = state;

  let url = `/restaurants/${restaurantId}/tables?date=${date}&time=${time}`;
  if (zoneId) url += `&zone_id=${zoneId}`;

  const tables = await apiGet(url);

  if (!tables || !tables.length) {
    // Stol yo'q → to'g'ridan tasdiqlashga o't
    setState(userId, { step: 'confirm', tableId: null });
    return showConfirm(chatId, userId);
  }

  // Faqat bo'sh stollarni filter qil
  const freeTables = tables.filter(t => !t.is_booked);

  if (!freeTables.length) {
    bot.sendMessage(chatId, T(userId, 'no_tables'), {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Boshqa vaqt tanlash', callback_data: 'back_time' }]]
      }
    });
    return;
  }

  setState(userId, { step: 'choose_table', tables: freeTables });

  // Stollarni 2 ta column da ko'rsat
  const rows = [];
  for (let i = 0; i < freeTables.length; i += 2) {
    const pair = freeTables.slice(i, i + 2).map(t => ({
      text: `${T(userId, 'table_free')} Stol ${t.table_number} (${t.capacity}👤${t.zone_name ? ' · ' + t.zone_name : ''})`,
      callback_data: `table_${t.id}`
    }));
    rows.push(pair);
  }
  rows.push([
    { text: T(userId, 'skip'), callback_data: 'table_skip' },
    { text: T(userId, 'back'), callback_data: 'back_zone' }
  ]);

  bot.sendMessage(chatId, T(userId, 'choose_table') + `\n\n🟢 Bo'sh stollar ko'rsatilmoqda:`, {
    reply_markup: { inline_keyboard: rows }
  });
}

async function showConfirm(chatId, userId) {
  const state = getState(userId);
  const { restaurantName, date, time, guests, zoneName, tableNumber } = state;

  setState(userId, { step: 'confirm' });

  const text =
    `📋 <b>Bron ma'lumotlari:</b>\n\n` +
    `🍽 <b>${restaurantName}</b>\n` +
    `📅 Sana: <b>${date}</b>\n` +
    `⏰ Vaqt: <b>${time}</b>\n` +
    `👥 Mehmonlar: <b>${guests} kishi</b>\n` +
    `${zoneName ? `🏠 Zona: <b>${zoneName}</b>\n` : ''}` +
    `${tableNumber ? `🪑 Stol: <b>${tableNumber}</b>\n` : ''}` +
    `\nTasdiqlaysizmi?`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Ha, bron qilish', callback_data: 'confirm_yes' }],
        [{ text: '❌ Bekor qilish', callback_data: 'back_start' }]
      ]
    }
  });
}

async function submitBooking(chatId, userId) {
  const state = getState(userId);
  const token = await loginUser({ id: userId, username: '', first_name: '' });

  if (!token) {
    return bot.sendMessage(chatId, T(userId, 'login_first'));
  }

  const { ok, data } = await apiPost('/reservations', {
    restaurant_id: state.restaurantId,
    date: state.date,
    time: state.time,
    guests: state.guests,
    zone_id: state.zoneId || null,
    table_id: state.tableId || null,
    comment: state.comment || ''
  }, token);

  if (ok) {
    clearState(userId);
    let msg = T(userId, 'booking_sent');
    if (data.requires_deposit) {
      msg = T(userId, 'noshow_warning', data.deposit_amount) + '\n\n' + msg;
    }
    bot.sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [[{ text: '📋 Bronlarimni ko\'rish', callback_data: 'my_bookings' }]]
      }
    });
  } else {
    let errMsg = data.error || T(userId, 'booking_error');
    if (data.alternatives?.length) {
      errMsg += `\n\n🕐 Bo'sh vaqtlar: ${data.alternatives.join(', ')}`;
    }
    bot.sendMessage(chatId, '❌ ' + errMsg, {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Qayta urinish', callback_data: 'back_time' }]]
      }
    });
  }
}

// ── My Bookings ───────────────────────────────────────────────
async function showMyBookings(chatId, userId) {
  const token = await loginUser({ id: userId });
  if (!token) return bot.sendMessage(chatId, T(userId, 'login_first'));

  const r = await fetch(`${API}/reservations/my`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const bookings = await r.json();

  if (!bookings || !bookings.length) {
    return bot.sendMessage(chatId, T(userId, 'my_bookings_empty'), {
      reply_markup: { inline_keyboard: [[{ text: '🍽 Bron qilish', callback_data: 'book_start' }]] }
    });
  }

  const statusEmoji = { pending:'⏳', confirmed:'✅', cancelled:'❌', completed:'🎉', noshow:'👻', waiting_payment:'💳' };
  const text = bookings.slice(0, 5).map((b, i) =>
    `${i+1}. <b>${b.restaurant_name}</b>\n` +
    `   ${statusEmoji[b.status]||'📋'} ${String(b.date).split('T')[0]} ${String(b.time).slice(0,5)} · ${b.guests} kishi`
  ).join('\n\n');

  // Cancel buttons for pending/confirmed
  const cancelBtns = bookings
    .filter(b => ['pending','confirmed'].includes(b.status))
    .slice(0, 3)
    .map(b => [{ text: `❌ ${b.restaurant_name} ni bekor qilish`, callback_data: `cancel_${b.id}` }]);

  bot.sendMessage(chatId, `📋 <b>Bronlarim:</b>\n\n${text}`, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [...cancelBtns, [{ text: '🏠 Bosh sahifa', callback_data: 'back_start' }]]
    }
  });
}

// ── AI mode ───────────────────────────────────────────────────
async function startAI(chatId, userId) {
  aiModes.add(userId);
  aiHistory.set(userId, []);
  bot.sendMessage(chatId, T(userId, 'ai_mode'), {
    reply_markup: { inline_keyboard: [[{ text: '❌ AI dan chiqish', callback_data: 'ai_exit' }]] }
  });
}

async function handleAI(chatId, userId, text) {
  const history = aiHistory.get(userId) || [];
  const typing = await bot.sendMessage(chatId, '⏳...');

  try {
    const lang = userLangs.get(userId) || 'uz';
    history.push({ role: 'user', content: text });
    if (history.length > 10) history.splice(0, history.length - 10);

    const { ok, data } = await apiPost('/ai/chat', { message: text, lang, history });
    await bot.deleteMessage(chatId, typing.message_id).catch(() => {});

    if (ok && data.reply) {
      aiHistory.set(userId, [...history, { role: 'assistant', content: data.reply }]);
      bot.sendMessage(chatId, data.reply, {
        reply_markup: { inline_keyboard: [[{ text: '❌ AI dan chiqish', callback_data: 'ai_exit' }]] }
      });
    } else {
      bot.sendMessage(chatId, '❌ Javob kelmadi. Qayta urinib ko\'ring.');
    }
  } catch {
    await bot.deleteMessage(chatId, typing.message_id).catch(() => {});
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
  }
}

// ── Callback Query Handler ────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // Lang
  if (data === 'lang_uz') { userLangs.set(userId, 'uz'); return bot.sendMessage(chatId, '🇺🇿 O\'zbek tili tanlandi'); }
  if (data === 'lang_ru') { userLangs.set(userId, 'ru'); return bot.sendMessage(chatId, '🇷🇺 Русский язык выбран'); }

  // AI
  if (data === 'ai_start') return startAI(chatId, userId);
  if (data === 'ai_exit') { aiModes.delete(userId); return bot.sendMessage(chatId, '👋 AI rejimdan chiqdingiz.'); }

  // Bosh sahifa
  if (data === 'back_start') {
    clearState(userId); aiModes.delete(userId);
    return bot.sendMessage(chatId, '/start tugmasini bosing');
  }

  // Booking flow
  if (data === 'book_start') return startBooking(chatId, userId);
  if (data === 'my_bookings') return showMyBookings(chatId, userId);

  // Restoran tanlash
  if (data.startsWith('resto_')) {
    const restoId = parseInt(data.split('_')[1]);
    const state = getState(userId);
    const resto = state.restaurants?.find(r => r.id === restoId);
    setState(userId, { restaurantId: restoId, restaurantName: resto?.name || 'Restoran' });
    return askDate(chatId, userId);
  }

  // Vaqt → band
  if (data === 'slot_busy') {
    return bot.sendMessage(chatId, '❌ Bu vaqt band yoki o\'tib ketgan. Boshqasini tanlang.');
  }

  // Vaqt tanlash
  if (data.startsWith('time_')) {
    const time = data.replace('time_', '');
    setState(userId, { time });
    return askGuests(chatId, userId);
  }

  // Mehmonlar
  if (data.startsWith('guests_')) {
    const guests = parseInt(data.split('_')[1]);
    setState(userId, { guests });
    return askZone(chatId, userId);
  }

  // Zona
  if (data.startsWith('zone_')) {
    const zoneId = parseInt(data.split('_')[1]);
    const state = getState(userId);
    const zone = state.zones?.find(z => z.id === zoneId);
    setState(userId, { zoneId, zoneName: zone?.name });
    return askTable(chatId, userId);
  }
  if (data === 'zone_skip') {
    setState(userId, { zoneId: null, zoneName: null });
    return askTable(chatId, userId);
  }

  // Stol
  if (data.startsWith('table_')) {
    const tableId = parseInt(data.split('_')[1]);
    const state = getState(userId);
    const table = state.tables?.find(t => t.id === tableId);
    setState(userId, { tableId, tableNumber: table?.table_number });
    return showConfirm(chatId, userId);
  }
  if (data === 'table_skip') {
    setState(userId, { tableId: null, tableNumber: null });
    return showConfirm(chatId, userId);
  }

  // Tasdiqlash
  if (data === 'confirm_yes') return submitBooking(chatId, userId);

  // Cancel booking
  if (data.startsWith('cancel_')) {
    const bookingId = data.split('_')[1];
    const token = await loginUser({ id: userId });
    if (!token) return bot.sendMessage(chatId, T(userId, 'login_first'));
    const r = await fetch(`${API}/reservations/${bookingId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) bot.sendMessage(chatId, '✅ Bron bekor qilindi.');
    else bot.sendMessage(chatId, '❌ Bekor qilib bo\'lmadi.');
    return;
  }

  // Back buttons
  if (data === 'back_date') return startBooking(chatId, userId);
  if (data === 'back_time') return askDate(chatId, userId);
  if (data === 'back_guests') return askTime(chatId, userId);
  if (data === 'back_zone') return askGuests(chatId, userId);
  if (data === 'back_table') return askZone(chatId, userId);
});

// ── Message Handler ───────────────────────────────────────────
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  // AI mode
  if (aiModes.has(userId)) return handleAI(chatId, userId, text);

  // Sana kiritish
  const state = getState(userId);
  if (state.step === 'enter_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return bot.sendMessage(chatId, '❌ Format noto\'g\'ri. Masalan: 2025-12-25');
    }
    const d = new Date(text);
    const today = new Date(); today.setHours(0,0,0,0);
    if (d < today) {
      return bot.sendMessage(chatId, '❌ O\'tgan sanaga bron bo\'lmaydi.');
    }
    setState(userId, { date: text });
    return askTime(chatId, userId);
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
console.log('✅ OneTable Bot ishga tushdi!');

module.exports = { bot };
