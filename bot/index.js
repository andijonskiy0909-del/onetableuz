require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const fetch = require('node-fetch')

const BOT_TOKEN = process.env.BOT_TOKEN
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''
const WEBAPP_URL = process.env.WEBAPP_URL || ''
const API_URL = process.env.API_URL || ''
const DASHBOARD_URL = (WEBHOOK_URL || '').replace(/\/$/, '') + '/dashboard'

if (!BOT_TOKEN) {
  console.error('[bot] BOT_TOKEN yoʻq — bot ishga tushmaydi')
  module.exports = { bot: null, processUpdate: () => {} }
  return
}

const useWebhook = Boolean(WEBHOOK_URL)
const bot = new TelegramBot(BOT_TOKEN, { polling: !useWebhook })

if (useWebhook) {
  bot.setWebHook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`)
    .then(() => console.log('[bot] ✅ Webhook sozlandi'))
    .catch(e => console.error('[bot] Webhook xato:', e.message))
} else {
  console.log('[bot] ✅ Polling mode')
}

// ── i18n ──────────────────────────────────────────────────
const i18n = {
  uz: {
    welcome: n => `Salom, ${n}! 👋\n\nOneTable — Toshkentdagi eng yaxshi restoranlarni bron qiling. ✨`,
    btn_open: '🍽 Restoranlarni ochish',
    btn_bookings: '📅 Bronlarim',
    btn_ai: '🤖 AI Yordamchi',
    btn_dashboard: '🏪 Restoran egasi',
    help: '📱 Buyruqlar:\n/start — Boshlash\n/mybookings — Bronlarim\n/ai — AI yordamchi\n/help — Yordam',
    review_ask: n => `⭐ <b>${n}</b> ga qanday baho berasiz?`,
    review_comment: "💬 Sharh yozmoqchimisiz? (yoki oʻtkazib yuboring)",
    review_photo: "📸 Rasm yubormoqchimisiz? (yoki oʻtkazib yuboring)",
    review_skip: "⏭ Oʻtkazib yuborish",
    review_saved: '✅ Rahmat! Bahoyingiz saqlandi 🙏',
    review_cancel: '❌ Bekor',
    ai_welcome: '🤖 AI faol! Savol bering yoki /start bilan chiqing.',
    ai_typing: '⏳ Javob tayyorlanmoqda...',
    ai_error: "❌ Xatolik. Qayta urinib koʻring.",
    ai_exit: '👋 AI rejimdan chiqdingiz.'
  },
  ru: {
    welcome: n => `Привет, ${n}! 👋\n\nOneTable — бронирование лучших ресторанов Ташкента. ✨`,
    btn_open: '🍽 Открыть рестораны',
    btn_bookings: '📅 Мои брони',
    btn_ai: '🤖 AI Ассистент',
    btn_dashboard: '🏪 Владелец ресторана',
    help: '📱 Команды:\n/start — Старт\n/mybookings — Мои брони\n/ai — AI\n/help — Помощь',
    review_ask: n => `⭐ Как оцениваете <b>${n}</b>?`,
    review_comment: '💬 Хотите написать отзыв?',
    review_photo: '📸 Добавить фото?',
    review_skip: '⏭ Пропустить',
    review_saved: '✅ Спасибо! Оценка сохранена 🙏',
    review_cancel: '❌ Отмена',
    ai_welcome: '🤖 AI активен! Задайте вопрос или /start для выхода.',
    ai_typing: '⏳ Готовлю ответ...',
    ai_error: '❌ Ошибка. Попробуйте снова.',
    ai_exit: '👋 Вы вышли из режима AI.'
  },
  en: {
    welcome: n => `Hello, ${n}! 👋\n\nOneTable — book the best restaurants in Tashkent. ✨`,
    btn_open: '🍽 Browse Restaurants',
    btn_bookings: '📅 My Bookings',
    btn_ai: '🤖 AI Assistant',
    btn_dashboard: '🏪 Restaurant Owner',
    help: '📱 Commands:\n/start — Start\n/mybookings — Bookings\n/ai — AI\n/help — Help',
    review_ask: n => `⭐ How would you rate <b>${n}</b>?`,
    review_comment: '💬 Leave a comment?',
    review_photo: '📸 Add a photo?',
    review_skip: '⏭ Skip',
    review_saved: '✅ Thank you! Review saved 🙏',
    review_cancel: '❌ Cancel',
    ai_welcome: '🤖 AI active! Ask anything or /start to exit.',
    ai_typing: '⏳ Preparing answer...',
    ai_error: '❌ Error. Try again.',
    ai_exit: '👋 You exited AI mode.'
  }
}

const state = { langs: {}, reviews: {}, ai: {}, aiHistory: {} }

function T(uid, key, ...args) {
  const lang = state.langs[uid] || 'uz'
  const v = i18n[lang][key]
  return typeof v === 'function' ? v(...args) : (v || key)
}

function mainKeyboard(uid) {
  const rows = []
  if (WEBAPP_URL) {
    rows.push([{ text: T(uid, 'btn_open'), web_app: { url: WEBAPP_URL } }])
    rows.push([{ text: T(uid, 'btn_bookings'), web_app: { url: `${WEBAPP_URL}?page=bookings` } }])
  }
  rows.push([{ text: T(uid, 'btn_ai'), callback_data: 'open_ai' }])
  if (DASHBOARD_URL) rows.push([{ text: T(uid, 'btn_dashboard'), url: DASHBOARD_URL }])
  rows.push([
    { text: '🇺🇿', callback_data: 'lang_uz' },
    { text: '🇷🇺', callback_data: 'lang_ru' },
    { text: '🇬🇧', callback_data: 'lang_en' }
  ])
  return { inline_keyboard: rows }
}

// ── /start ────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const uid = msg.from.id
  state.ai[uid] = false
  state.aiHistory[uid] = []
  if (!state.langs[uid]) {
    const lc = msg.from.language_code || 'uz'
    state.langs[uid] = lc.startsWith('ru') ? 'ru' : lc.startsWith('en') ? 'en' : 'uz'
  }
  bot.sendMessage(msg.chat.id, T(uid, 'welcome', msg.from.first_name || 'Foydalanuvchi'), {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(uid)
  }).catch(e => console.error('[bot] send:', e.message))
})

bot.onText(/\/help/, msg => bot.sendMessage(msg.chat.id, T(msg.from.id, 'help')).catch(()=>{}))

bot.onText(/\/ai/, msg => {
  const uid = msg.from.id
  state.ai[uid] = true
  state.aiHistory[uid] = []
  bot.sendMessage(msg.chat.id, T(uid, 'ai_welcome'), {
    reply_markup: { inline_keyboard: [[{ text: '❌ AI dan chiqish', callback_data: 'exit_ai' }]] }
  }).catch(()=>{})
})

bot.onText(/\/mybookings/, msg => {
  const uid = msg.from.id
  const rows = []
  if (WEBAPP_URL) rows.push([{ text: T(uid, 'btn_bookings'), web_app: { url: `${WEBAPP_URL}?page=bookings` } }])
  bot.sendMessage(msg.chat.id, T(uid, 'btn_bookings'), { reply_markup: { inline_keyboard: rows } }).catch(()=>{})
})

// ── Callback handler ──────────────────────────────────────
bot.on('callback_query', async (q) => {
  const uid = q.from.id
  const chatId = q.message.chat.id
  const data = q.data || ''

  try {
    if (data.startsWith('lang_')) {
      state.langs[uid] = data.replace('lang_', '')
      await bot.answerCallbackQuery(q.id)
      await bot.editMessageText(T(uid, 'welcome', q.from.first_name || ''), {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(uid)
      }).catch(()=>{})
      return
    }

    if (data === 'open_ai') {
      await bot.answerCallbackQuery(q.id)
      state.ai[uid] = true
      state.aiHistory[uid] = []
      await bot.sendMessage(chatId, T(uid, 'ai_welcome'), {
        reply_markup: { inline_keyboard: [[{ text: '❌ Chiqish', callback_data: 'exit_ai' }]] }
      })
      return
    }

    if (data === 'exit_ai') {
      await bot.answerCallbackQuery(q.id)
      state.ai[uid] = false
      state.aiHistory[uid] = []
      await bot.sendMessage(chatId, T(uid, 'ai_exit'))
      return
    }

    if (data.startsWith('review_rate_')) {
      const parts = data.split('_')
      const rating = Number(parts[2])
      const resId = parts[3]
      const restId = parts[4]
      await bot.answerCallbackQuery(q.id, { text: `⭐ ${rating}/5` })
      state.reviews[uid] = {
        step: 'comment',
        reservationId: resId,
        restaurantId: restId,
        rating,
        comment: null
      }
      await bot.sendMessage(chatId, T(uid, 'review_comment'), {
        reply_markup: { inline_keyboard: [[{ text: T(uid, 'review_skip'), callback_data: 'review_skip_comment' }]] }
      })
      return
    }

    if (data === 'review_skip_comment') {
      await bot.answerCallbackQuery(q.id)
      if (state.reviews[uid]) {
        state.reviews[uid].step = 'photo'
        state.reviews[uid].comment = ''
      }
      await bot.sendMessage(chatId, T(uid, 'review_photo'), {
        reply_markup: { inline_keyboard: [[{ text: T(uid, 'review_skip'), callback_data: 'review_skip_photo' }]] }
      })
      return
    }

    if (data === 'review_skip_photo') {
      await bot.answerCallbackQuery(q.id)
      await saveReview(uid, chatId, null)
      return
    }

    if (data === 'review_cancel') {
      await bot.answerCallbackQuery(q.id)
      delete state.reviews[uid]
      return
    }

    await bot.answerCallbackQuery(q.id)
  } catch (e) {
    console.error('[bot] callback:', e.message)
  }
})

// ── Message handler ───────────────────────────────────────
bot.on('message', async (msg) => {
  const uid = msg.from.id
  const chatId = msg.chat.id
  if (msg.text && msg.text.startsWith('/')) return

  if (state.ai[uid] && msg.text) {
    await handleAI(uid, chatId, msg.text)
    return
  }

  const rs = state.reviews[uid]
  if (!rs) return

  if (rs.step === 'comment' && msg.text) {
    rs.comment = msg.text
    rs.step = 'photo'
    await bot.sendMessage(chatId, T(uid, 'review_photo'), {
      reply_markup: { inline_keyboard: [[{ text: T(uid, 'review_skip'), callback_data: 'review_skip_photo' }]] }
    }).catch(()=>{})
    return
  }

  if (rs.step === 'photo' && msg.photo && msg.photo.length) {
    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id
      const fi = await bot.getFile(fileId)
      const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fi.file_path}`
      await saveReview(uid, chatId, photoUrl)
    } catch (e) {
      await bot.sendMessage(chatId, '❌ Rasm xato')
    }
  }
})

// ── AI ────────────────────────────────────────────────────
async function handleAI(uid, chatId, message) {
  const lang = state.langs[uid] || 'uz'
  let typingMsg
  try {
    typingMsg = await bot.sendMessage(chatId, T(uid, 'ai_typing'))
  } catch { return }

  try {
    if (!state.aiHistory[uid]) state.aiHistory[uid] = []
    state.aiHistory[uid].push({ role: 'user', content: message })
    if (state.aiHistory[uid].length > 10) {
      state.aiHistory[uid] = state.aiHistory[uid].slice(-10)
    }

    let ctx = ''
    try {
      const r = await fetch(`${API_URL}/restaurants`)
      const d = await r.json()
      if (Array.isArray(d)) {
        ctx = d.slice(0, 5).map(x =>
          `- ${x.name} (${(Array.isArray(x.cuisine) ? x.cuisine.join(', ') : x.cuisine) || ''}, ${x.price_category || ''}, ${x.address || ''})`
        ).join('\n')
      }
    } catch {}

    const prompts = {
      uz: `Sen OneTable AI yordamchisisan. Toshkentdagi restoran bron platformasi.\n${ctx ? `Restoranlar:\n${ctx}` : ''}\nQisqa javob ber. Oʻzbek tilida.`,
      ru: `Ты AI-ассистент OneTable. Рестораны Ташкента.\n${ctx ? `Рестораны:\n${ctx}` : ''}\nКратко по-русски.`,
      en: `You are OneTable AI assistant. Restaurants in Tashkent.\n${ctx ? `Restaurants:\n${ctx}` : ''}\nBe brief.`
    }

    let reply = '...'
    if (process.env.GROQ_API_KEY) {
      const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: prompts[lang] || prompts.uz },
            ...state.aiHistory[uid]
          ],
          max_tokens: 500,
          temperature: 0.7
        })
      })
      const d = await gr.json()
      reply = d.choices?.[0]?.message?.content || reply
    } else {
      reply = lang === 'ru' ? 'AI временно недоступен' : lang === 'en' ? 'AI temporarily unavailable' : 'AI vaqtincha mavjud emas'
    }

    state.aiHistory[uid].push({ role: 'assistant', content: reply })
    if (typingMsg) await bot.deleteMessage(chatId, typingMsg.message_id).catch(()=>{})
    await bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌ Chiqish', callback_data: 'exit_ai' }]] }
    })
  } catch (e) {
    console.error('[bot] AI:', e.message)
    if (typingMsg) await bot.deleteMessage(chatId, typingMsg.message_id).catch(()=>{})
    await bot.sendMessage(chatId, T(uid, 'ai_error')).catch(()=>{})
  }
}

// ── Review save ───────────────────────────────────────────
async function saveReview(uid, chatId, photoUrl) {
  const rs = state.reviews[uid]
  if (!rs) return
  try {
    const r = await fetch(`${API_URL}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: uid,
        reservation_id: rs.reservationId,
        restaurant_id: rs.restaurantId,
        rating: rs.rating,
        comment: rs.comment || null,
        photo_url: photoUrl || null
      })
    })
    await bot.sendMessage(chatId, r.ok ? T(uid, 'review_saved') : '❌ Saqlashda xato').catch(()=>{})
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Xatolik').catch(()=>{})
  } finally {
    delete state.reviews[uid]
  }
}

// ── Ask for review ────────────────────────────────────────
async function askForReview(telegramId, reservationId, restaurantId, restaurantName) {
  try {
    const uid = telegramId
    const lang = state.langs[uid] || 'uz'
    state.reviews[uid] = {
      step: 'rating',
      reservationId: String(reservationId),
      restaurantId: String(restaurantId),
      restaurantName,
      rating: null,
      comment: null
    }
    const stars = [1,2,3,4,5].map(n => ({
      text: '⭐'.repeat(n),
      callback_data: `review_rate_${n}_${reservationId}_${restaurantId}`
    }))
    await bot.sendMessage(telegramId, i18n[lang].review_ask(restaurantName), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          stars.slice(0,3),
          [...stars.slice(3), { text: i18n[lang].review_cancel, callback_data: 'review_cancel' }]
        ]
      }
    })
  } catch (e) {
    console.error('[bot] askForReview:', e.message)
  }
}

// ── Cron: check reviews ───────────────────────────────────
async function checkReviews() {
  try {
    if (!API_URL) return
    const r = await fetch(`${API_URL}/reservations/past-unreviewed`)
    if (!r.ok) return
    const list = await r.json()
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (item.telegram_id) {
        await askForReview(item.telegram_id, item.id, item.restaurant_id, item.restaurant_name)
        await fetch(`${API_URL}/reservations/${item.id}/review-asked`, { method: 'PUT' })
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  } catch (e) {
    console.error('[bot] checkReviews:', e.message)
  }
}

setInterval(checkReviews, 30 * 60 * 1000)
setTimeout(checkReviews, 15000)

function processUpdate(update) {
  try { bot.processUpdate(update) } catch (e) { console.error('[bot] processUpdate:', e.message) }
}

module.exports = { bot, askForReview, processUpdate }
