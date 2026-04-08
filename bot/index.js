require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const fetch = require('node-fetch')

const BOT_TOKEN = process.env.BOT_TOKEN
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://onetableuz-bot.up.railway.app'
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://cooperative-insight-production-11df.up.railway.app/app'
const API_URL = process.env.API_URL || 'https://cooperative-insight-production-11df.up.railway.app/api'

const bot = new TelegramBot(BOT_TOKEN, { polling: false })

bot.setWebHook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`)
  .then(() => console.log('✅ Webhook sozlandi'))
  .catch(e => console.error('Webhook xatoligi:', e.message))

// ── i18n ──────────────────────────────────────────────────────
const i18n = {
  uz: {
    welcome: n => `Salom, ${n}! 👋\n\nOneTable — Shahringizdagi eng yaxshi restoranlarni bron qiling. ✨\n\n🍽 Restoranlar ro'yxatini ko'rish\n📅 Bronlarimni ko'rish\n🤖 AI Yordamchi`,
    btn_open: '🍽 Restoranlarni ochish',
    btn_bookings: '📅 Bronlarim',
    btn_ai: '🤖 AI Yordamchi',
    help: '📱 Buyruqlar:\n/start — Boshlash\n/mybookings — Bronlarim\n/ai — AI yordamchi\n/help — Yordam',
    review_ask: n => `⭐ <b>${n}</b> ga qanday baho berasiz?`,
    review_comment: "💬 Sharh yozmoqchimisiz? (yoki o'tkazib yuboring)",
    review_photo: '📸 Rasm yubormoqchimisiz? (yoki o\'tkazib yuboring)',
    review_skip: "⏭ O'tkazib yuborish",
    review_saved: '✅ Rahmat! Bahoyingiz saqlandi 🙏',
    review_cancel: '❌ Bekor',
    ai_welcome: '🤖 AI faol! Savol bering yoki /start bilan chiqing.',
    ai_typing: '⏳ Javob tayyorlanmoqda...',
    ai_error: "❌ Xatolik. Qayta urinib ko'ring.",
    ai_exit: '👋 AI rejimdan chiqdingiz.',
    review_star: n => '⭐'.repeat(n) + ` (${n}/5)`,
    no_bookings: "Hali bronlaringiz yo'q.",
  },
  ru: {
    welcome: n => `Привет, ${n}! 👋\n\nOneTable — Бронируйте лучшие рестораны Ташкента. ✨`,
    btn_open: '🍽 Открыть рестораны',
    btn_bookings: '📅 Мои брони',
    btn_ai: '🤖 AI Ассистент',
    help: '📱 Команды:\n/start — Старт\n/mybookings — Брони\n/ai — AI ассистент\n/help — Помощь',
    review_ask: n => `⭐ Как вы оцениваете <b>${n}</b>?`,
    review_comment: '💬 Хотите написать отзыв?',
    review_photo: '📸 Хотите добавить фото?',
    review_skip: '⏭ Пропустить',
    review_saved: '✅ Спасибо! Оценка сохранена 🙏',
    review_cancel: '❌ Отмена',
    ai_welcome: '🤖 AI активен! Задайте вопрос или напишите /start для выхода.',
    ai_typing: '⏳ Готовлю ответ...',
    ai_error: '❌ Ошибка. Попробуйте снова.',
    ai_exit: '👋 Вы вышли из режима AI.',
    review_star: n => '⭐'.repeat(n) + ` (${n}/5)`,
    no_bookings: 'У вас пока нет бронирований.',
  },
  en: {
    welcome: n => `Hello, ${n}! 👋\n\nOneTable — Book the best restaurants in Tashkent. ✨`,
    btn_open: '🍽 Browse Restaurants',
    btn_bookings: '📅 My Bookings',
    btn_ai: '🤖 AI Assistant',
    help: '📱 Commands:\n/start — Start\n/mybookings — My bookings\n/ai — AI assistant\n/help — Help',
    review_ask: n => `⭐ How would you rate <b>${n}</b>?`,
    review_comment: '💬 Want to leave a comment?',
    review_photo: '📸 Want to add a photo?',
    review_skip: '⏭ Skip',
    review_saved: '✅ Thank you! Review saved 🙏',
    review_cancel: '❌ Cancel',
    ai_welcome: '🤖 AI is active! Ask anything or type /start to exit.',
    ai_typing: '⏳ Preparing answer...',
    ai_error: '❌ Error. Please try again.',
    ai_exit: '👋 You exited AI mode.',
    review_star: n => '⭐'.repeat(n) + ` (${n}/5)`,
    no_bookings: 'You have no bookings yet.',
  }
}

const state = { langs: {}, reviews: {}, ai: {}, aiHistory: {} }

function T(uid, key, ...args) {
  const lang = state.langs[uid] || 'uz'
  const v = i18n[lang][key]
  return typeof v === 'function' ? v(...args) : (v || key)
}

function mainKeyboard(uid) {
  const DASH = 'https://cooperative-insight-production-11df.up.railway.app/dashboard'
  return {
    inline_keyboard: [
      [{ text: T(uid, 'btn_open'), web_app: { url: WEBAPP_URL } }],
      [{ text: T(uid, 'btn_bookings'), web_app: { url: WEBAPP_URL + '?page=bookings' } }],
      [{ text: T(uid, 'btn_ai'), callback_data: 'open_ai' }],
      [{ text: '🏪 Restoran egasi (Dashboard)', url: DASH }],
      [
        { text: '🇺🇿', callback_data: 'lang_uz' },
        { text: '🇷🇺', callback_data: 'lang_ru' },
        { text: '🇬🇧', callback_data: 'lang_en' }
      ]
    ]
  }
}

// ── /start ────────────────────────────────────────────────────
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
  })
})

bot.onText(/\/help/, msg => bot.sendMessage(msg.chat.id, T(msg.from.id, 'help')))

bot.onText(/\/ai/, msg => {
  const uid = msg.from.id
  state.ai[uid] = true
  state.aiHistory[uid] = []
  bot.sendMessage(msg.chat.id, T(uid, 'ai_welcome'), {
    reply_markup: { inline_keyboard: [[{ text: '❌ AI dan chiqish', callback_data: 'exit_ai' }]] }
  })
})

bot.onText(/\/mybookings/, msg => {
  bot.sendMessage(msg.chat.id, T(msg.from.id, 'btn_bookings'), {
    reply_markup: {
      inline_keyboard: [[{
        text: T(msg.from.id, 'btn_bookings'),
        web_app: { url: `${WEBAPP_URL}?page=bookings` }
      }]]
    }
  })
})

// ── Callback ──────────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const uid = q.from.id
  const chatId = q.message.chat.id
  const data = q.data

  if (data.startsWith('lang_')) {
    state.langs[uid] = data.replace('lang_', '')
    await bot.answerCallbackQuery(q.id)
    bot.editMessageText(T(uid, 'welcome', q.from.first_name || ''), {
      chat_id: chatId,
      message_id: q.message.message_id,
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(uid)
    }).catch(() => {})
    return
  }

  if (data === 'open_ai') {
    await bot.answerCallbackQuery(q.id)
    state.ai[uid] = true
    state.aiHistory[uid] = []
    bot.sendMessage(chatId, T(uid, 'ai_welcome'), {
      reply_markup: { inline_keyboard: [[{ text: '❌ Chiqish', callback_data: 'exit_ai' }]] }
    })
    return
  }

  if (data === 'exit_ai') {
    await bot.answerCallbackQuery(q.id)
    state.ai[uid] = false
    state.aiHistory[uid] = []
    bot.sendMessage(chatId, T(uid, 'ai_exit'))
    return
  }

  if (data.startsWith('review_rate_')) {
    const parts = data.split('_')
    const rating = +parts[2]
    const resId = parts[3]
    const restId = parts[4]
    await bot.answerCallbackQuery(q.id, { text: T(uid, 'review_star', rating) })
    state.reviews[uid] = {
      step: 'comment',
      reservationId: resId,
      restaurantId: restId,
      rating,
      comment: null
    }
    bot.sendMessage(chatId, T(uid, 'review_comment'), {
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
    bot.sendMessage(chatId, T(uid, 'review_photo'), {
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
})

// ── Message handler ───────────────────────────────────────────
bot.on('message', async (msg) => {
  const uid = msg.from.id
  const chatId = msg.chat.id
  if (msg.text?.startsWith('/')) return

  if (state.ai[uid] && msg.text) {
    await handleAI(uid, chatId, msg.text)
    return
  }

  const rs = state.reviews[uid]
  if (!rs) return

  if (rs.step === 'comment' && msg.text) {
    rs.comment = msg.text
    rs.step = 'photo'
    bot.sendMessage(chatId, T(uid, 'review_photo'), {
      reply_markup: { inline_keyboard: [[{ text: T(uid, 'review_skip'), callback_data: 'review_skip_photo' }]] }
    })
    return
  }

  if (rs.step === 'photo' && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id
    const fi = await bot.getFile(fileId)
    const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fi.file_path}`
    await saveReview(uid, chatId, photoUrl)
    return
  }
})

// ── AI ────────────────────────────────────────────────────────
async function handleAI(uid, chatId, message) {
  const lang = state.langs[uid] || 'uz'
  const typing = await bot.sendMessage(chatId, T(uid, 'ai_typing'))
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
        ctx = d.slice(0, 5).map(r =>
          `- ${r.name} (${r.cuisine?.join(', ') || ''}, ${r.price_category || ''}, ${r.address || ''})`
        ).join('\n')
      }
    } catch(e) {}

    const prompts = {
      uz: `Sen OneTable AI yordamchisisisan. Toshkentdagi restoran bron platformasi.\n${ctx ? `Restoranlar:\n${ctx}` : ''}\nQisqa javob ber. O'zbek tilida.`,
      ru: `Ты AI-ассистент OneTable. Рестораны Ташкента.\n${ctx ? `Рестораны:\n${ctx}` : ''}\nКратко по-русски.`,
      en: `You are OneTable AI assistant. Restaurant booking platform in Tashkent.\n${ctx ? `Restaurants:\n${ctx}` : ''}\nBe brief.`
    }

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
    const reply = d.choices?.[0]?.message?.content
    if (!reply) throw new Error('No reply')

    state.aiHistory[uid].push({ role: 'assistant', content: reply })
    await bot.deleteMessage(chatId, typing.message_id).catch(() => {})
    bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌ Chiqish', callback_data: 'exit_ai' }]] }
    })
  } catch(e) {
    await bot.deleteMessage(chatId, typing.message_id).catch(() => {})
    bot.sendMessage(chatId, T(uid, 'ai_error'))
  }
}

// ── Review saqlash ────────────────────────────────────────────
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
    bot.sendMessage(chatId, r.ok ? T(uid, 'review_saved') : '❌ Saqlashda xatolik')
  } catch(e) {
    bot.sendMessage(chatId, '❌ Xatolik')
  } finally {
    delete state.reviews[uid]
  }
}

// ── Review so'rash ────────────────────────────────────────────
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
    const stars = [1, 2, 3, 4, 5].map(n => ({
      text: '⭐'.repeat(n),
      callback_data: `review_rate_${n}_${reservationId}_${restaurantId}`
    }))
    await bot.sendMessage(telegramId, i18n[lang].review_ask(restaurantName), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          stars.slice(0, 3),
          [...stars.slice(3), { text: i18n[lang].review_cancel, callback_data: 'review_cancel' }]
        ]
      }
    })
  } catch(e) {
    console.error('askForReview error:', e.message)
  }
}

// ── Cron: Review so'rash ──────────────────────────────────────
async function checkReviews() {
  try {
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
  } catch(e) {
    console.error('Review cron error:', e.message)
  }
}

setInterval(checkReviews, 30 * 60 * 1000)
setTimeout(checkReviews, 15000)

// ── Webhook handler ───────────────────────────────────────────
function processUpdate(update) {
  bot.processUpdate(update)
}

module.exports = { bot, askForReview, processUpdate }
