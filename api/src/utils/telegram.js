const BOT_TOKEN = process.env.BOT_TOKEN

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] BOT_TOKEN yo‘q')
    return false
  }

  if (!chatId) {
    console.warn('[Telegram] chatId yo‘q')
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    })

    const data = await response.json()

    if (!data.ok) {
      console.error('[Telegram] sendMessage error:', data)
      return false
    }

    return true
  } catch (err) {
    console.error('[Telegram] sendMessage failed:', err.message)
    return false
  }
}

module.exports = {
  sendTelegramMessage
}
