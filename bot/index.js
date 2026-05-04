require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env.example') })
try { require('dotenv').config() } catch {}

const TelegramBot = require('node-telegram-bot-api')
const fetch = require('node-fetch')

const BOT_TOKEN = process.env.BOT_TOKEN
const WEBHOOK_URL = (process.env.WEBHOOK_URL || '').replace(/\/$/, '')
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '')
const API_URL = (process.env.API_URL || '').replace(/\/$/, '')


if (!BOT_TOKEN) {
  console.warn('[bot] BOT_TOKEN not set — bot disabled')
  module.exports = { bot: null, processUpdate: () => {}, askForReview: () => {} }
  return
}

const useWebhook = Boolean(WEBHOOK_URL)
const bot = new TelegramBot(BOT_TOKEN, { polling: !useWebhook })

if (useWebhook) {
  bot.setWebHook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`)
    .then(() => console.log('[bot] ✅ Webhook set'))
    .catch(e => console.error('[bot] Webhook error:', e.message))
} else {
  console.log('[bot] ✅ Polling mode')
}

const state = { langs: {}, reviews: {}, ai: {}, aiHistory: {} }

const i18n = {
  uz: {
    welcome: n => `Salom, ${n}! 👋\n\n🍽 OneTable — Restoran bron qilishni osonlashtiramiz.`,
    btn_open: '🍽 Restoranlar',
    btn_bookings: '📅 Bronlarim',
    btn_ai: '🤖 AI Yordamchi',
    
    help: '/start — Boshlash\n/mybookings — Bronlarim\n/ai — AI\n/help — Yordam',
    review_ask: n => `⭐ <b>${n}</b> ni baholang:`,
    review_comment: '💬 Sharh? (yoki o\'tkazib yuboring)',
    review_skip: '⏭ O\'tkazish',
    review_saved: '✅ Rahmat!',
    ai_welcome: '🤖 AI faol! Savol bering.',
    ai_typing: '⏳ ...',
    ai_error: '❌ Xatolik.',
    ai_exit: '👋 AI o\'chirildi.'
  },
  ru: {
    welcome: n => `Привет, ${n}! 👋\n\n🍽 OneTable — Упрощаем бронирование столиков в ресторанах.`,
    btn_open: '🍽 Рестораны',
    btn_bookings: '📅 Мои брони',
    btn_ai: '🤖 AI',
   
    help: '/start — Старт\n/mybookings — Брони\n/ai — AI\n/help — Помощь',
    review_ask: n => `⭐ Оцените <b>${n}</b>:`,
    review_comment: '💬 Комментарий?',
    review_skip: '⏭ Пропустить',
    review_saved: '✅ Спасибо!',
    ai_welcome: '🤖 AI активен!',
    ai_typing: '⏳ ...',
    ai_error: '❌ Ошибка.',
    ai_exit: '👋 AI выключен.'
  },
  en: {
    welcome: n => `Hello, ${n}! 👋\n\n🍽 OneTable — Simplifying restaurant table reservations.`,
    btn_open: '🍽 Restaurants',
    btn_bookings: '📅 Bookings',
    btn_ai: '🤖 AI',
    
    help: '/start — Start\n/mybookings — Bookings\n/ai — AI\n/help — Help',
    review_ask: n => `⭐ Rate <b>${n}</b>:`,
    review_comment: '💬 Comment?',
    review_skip: '⏭ Skip',
    review_saved: '✅ Thank you!',
    ai_welcome: '🤖 AI active!',
    ai_typing: '⏳ ...',
    ai_error: '❌ Error.',
    ai_exit: '👋 AI off.'
  }
}

const T = (uid, key, ...args) => {
  const lang = state.langs[uid] || 'uz'
  const v = i18n[lang]?.[key] || i18n.uz[key] || key
  return typeof v === 'function' ? v(...args) : v
}

function mainKB(uid) {
  const rows = []
  if (WEBAPP_URL) {
    rows.push([{ text: T(uid, 'btn_open'), web_app: { url: WEBAPP_URL } }])
    rows.push([{ text: T(uid, 'btn_bookings'), web_app: { url: `${WEBAPP_URL}?page=bookings` } }])
  }
  rows.push([{ text: T(uid, 'btn_ai'), callback_data: 'ai' }])
  
  rows.push([
    { text: '🇺🇿', callback_data: 'lang_uz' },
    { text: '🇷🇺', callback_data: 'lang_ru' },
    { text: '🇬🇧', callback_data: 'lang_en' }
  ])
  return { inline_keyboard: rows }
}

bot.onText(/\/start/, (msg) => {
  const uid = msg.from.id
  state.ai[uid] = false
  if (!state.langs[uid]) {
    const lc = msg.from.language_code || 'uz'
    state.langs[uid] = lc.startsWith('ru') ? 'ru' : lc.startsWith('en') ? 'en' : 'uz'
  }
  bot.sendMessage(msg.chat.id, T(uid, 'welcome', msg.from.first_name || ''), {
    parse_mode: 'HTML', reply_markup: mainKB(uid)
  }).catch(() => {})
})

bot.onText(/\/help/, m => bot.sendMessage(m.chat.id, T(m.from.id, 'help')).catch(() => {}))

bot.onText(/\/ai/, m => {
  state.ai[m.from.id] = true
  state.aiHistory[m.from.id] = []
  bot.sendMessage(m.chat.id, T(m.from.id, 'ai_welcome'), {
    reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'ai_exit' }]] }
  }).catch(() => {})
})

bot.onText(/\/mybookings/, m => {
  if (WEBAPP_URL) {
    bot.sendMessage(m.chat.id, T(m.from.id, 'btn_bookings'), {
      reply_markup: { inline_keyboard: [[{ text: '📅', web_app: { url: `${WEBAPP_URL}?page=bookings` } }]] }
    }).catch(() => {})
  }
})

bot.on('callback_query', async (q) => {
  const uid = q.from.id, chatId = q.message.chat.id, data = q.data || ''
  try {
    await bot.answerCallbackQuery(q.id)

    if (data.startsWith('lang_')) {
      state.langs[uid] = data.slice(5)
      bot.editMessageText(T(uid, 'welcome', q.from.first_name || ''), {
        chat_id: chatId, message_id: q.message.message_id,
        parse_mode: 'HTML', reply_markup: mainKB(uid)
      }).catch(() => {})
      return
    }

    if (data === 'ai') {
      state.ai[uid] = true; state.aiHistory[uid] = []
      bot.sendMessage(chatId, T(uid, 'ai_welcome'), {
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'ai_exit' }]] }
      })
      return
    }

    if (data === 'ai_exit') {
      state.ai[uid] = false; state.aiHistory[uid] = []
      bot.sendMessage(chatId, T(uid, 'ai_exit'))
      return
    }

    if (data.startsWith('rr_')) {
      const [, rating, resId, restId] = data.split('_')
      state.reviews[uid] = { step: 'comment', reservationId: resId, restaurantId: restId, rating: Number(rating), comment: null }
      bot.sendMessage(chatId, T(uid, 'review_comment'), {
        reply_markup: { inline_keyboard: [[{ text: T(uid, 'review_skip'), callback_data: 'rskip' }]] }
      })
      return
    }

    if (data === 'rskip') {
      await saveReview(uid, chatId, null)
      return
    }

    if (data === 'rcancel') {
      delete state.reviews[uid]
      return
    }
  } catch (e) { console.error('[bot] cb:', e.message) }
})

bot.on('message', async (msg) => {
  const uid = msg.from.id, chatId = msg.chat.id
  if (msg.text?.startsWith('/')) return

  if (state.ai[uid] && msg.text) {
    await handleAI(uid, chatId, msg.text)
    return
  }

  const rs = state.reviews[uid]
  if (!rs) return

  if (rs.step === 'comment' && msg.text) {
    rs.comment = msg.text
    await saveReview(uid, chatId, null)
  }
})

async function handleAI(uid, chatId, message) {
  let typing
  try { typing = await bot.sendMessage(chatId, T(uid, 'ai_typing')) } catch { return }
  try {
    if (!state.aiHistory[uid]) state.aiHistory[uid] = []
    state.aiHistory[uid].push({ role: 'user', content: message })
    if (state.aiHistory[uid].length > 10) state.aiHistory[uid] = state.aiHistory[uid].slice(-10)

    let reply = 'AI mavjud emas'
    if (process.env.GROQ_API_KEY) {
      const lang = state.langs[uid] || 'uz'
      const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: `Sen OneTable AI yordamchisisan.

Qoidalar:
- Faqat OneTable mini app ichidagi restoranlar haqida gapirasan.
- Faqat berilgan restoran ma’lumotlari asosida tavsiya berasan.
- O‘zing restoran o‘ylab topmaysan.
- Agar ma’lumot bo‘lmasa "Bu restoran haqida ma’lumot topilmadi" deysan.
- Restoranlarni quyidagilar asosida tahlil qilasan:
  1. Reyting
  2. Narx kategoriyasi
  3. Joylashuv
  4. Oshxona turi
  5. Bo‘sh stol mavjudligi
  6. Foydalanuvchi sharhlari
- Eng yaxshi variantlarni foydalanuvchi talabiga qarab tavsiya qilasan.
- Qisqa, aniq va foydali javob berasan.
- Javob tili: ${lang}` },
            ...state.aiHistory[uid]
          ],
          max_tokens: 500, temperature: 0.7
        })
      })
      const d = await gr.json()
      reply = d.choices?.[0]?.message?.content || reply
    }

    state.aiHistory[uid].push({ role: 'assistant', content: reply })
    if (typing) await bot.deleteMessage(chatId, typing.message_id).catch(() => {})
    bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'ai_exit' }]] }
    })
  } catch (e) {
    if (typing) await bot.deleteMessage(chatId, typing.message_id).catch(() => {})
    bot.sendMessage(chatId, T(uid, 'ai_error')).catch(() => {})
  }
}

async function saveReview(uid, chatId, photoUrl) {
  const rs = state.reviews[uid]
  if (!rs) return
  try {
    await fetch(`${API_URL}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: uid, reservation_id: rs.reservationId,
        restaurant_id: rs.restaurantId, rating: rs.rating,
        comment: rs.comment || null, photo_url: photoUrl || null
      })
    })
    bot.sendMessage(chatId, T(uid, 'review_saved')).catch(() => {})
  } catch { bot.sendMessage(chatId, '❌').catch(() => {}) }
  finally { delete state.reviews[uid] }
}

async function askForReview(telegramId, reservationId, restaurantId, restaurantName) {
  try {
    const uid = telegramId
    const lang = state.langs[uid] || 'uz'
    state.reviews[uid] = { step: 'rating', reservationId: String(reservationId), restaurantId: String(restaurantId) }
    const stars = [1,2,3,4,5].map(n => ({
      text: '⭐'.repeat(n), callback_data: `rr_${n}_${reservationId}_${restaurantId}`
    }))
    await bot.sendMessage(telegramId, (i18n[lang]?.review_ask || i18n.uz.review_ask)(restaurantName), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [stars.slice(0,3), [...stars.slice(3), { text: '❌', callback_data: 'rcancel' }]] }
    })
  } catch (e) { console.error('[bot] askForReview:', e.message) }
}

// Review cron
async function checkReviews() {
  if (!API_URL) return
  try {
    const r = await fetch(`${API_URL}/reservations/past-unreviewed`)
    if (!r.ok) return
    const list = await r.json()
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (item.telegram_id) {
        await askForReview(item.telegram_id, item.id, item.restaurant_id, item.restaurant_name)
        await fetch(`${API_URL}/reservations/${item.id}/review-asked`, { method: 'PUT' }).catch(() => {})
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  } catch (e) { console.error('[bot] cron:', e.message) }
}

setInterval(checkReviews, 30 * 60 * 1000)
setTimeout(checkReviews, 20000)

function processUpdate(update) {
  try { bot.processUpdate(update) } catch (e) { console.error('[bot] update:', e.message) }
}

module.exports = { bot, askForReview, processUpdate }
