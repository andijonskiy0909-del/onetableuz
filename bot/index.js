require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://onetableuz.vercel.app';

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Foydalanuvchi';

  bot.sendMessage(chatId, 
    `Salom, ${firstName}! 👋\n\nOneTable — Toshkentdagi restoranlarni bron qilish platformasi.\n\n🍽 Restoranlarni ko'ring\n📅 Bron qiling\n⭐ Baholang`, 
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🍽 Restoranlarni ko\'rish',
              web_app: { url: WEBAPP_URL }
            }
          ],
          [
            {
              text: '📅 Bronlarim',
              web_app: { url: `${WEBAPP_URL}/reservations` }
            }
          ]
        ]
      }
    }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    '📱 OneTable bot buyruqlari:\n\n/start — Botni boshlash\n/restaurants — Restoranlar ro\'yxati\n/mybookings — Mening bronlarim\n/help — Yordam'
  );
});

bot.onText(/\/restaurants/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Restoranlarni ko\'rish uchun:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🍽 Restoranlarni ochish',
          web_app: { url: WEBAPP_URL }
        }
      ]]
    }
  });
});

console.log('OneTable bot ishga tushdi!');
