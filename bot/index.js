const express = require('express');
const config = require('../src/config/env');
const logger = require('../src/config/logger');
const bot = require('./handlers/webhookHandler');

const app = express();
app.use(express.json());

// Telegram webhook endpoint
app.post('/webhook/telegram', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(config.PORT + 1, () => {
  logger.info(`Bot webhook server running on port ${config.PORT + 1}`);
  // Set webhook
  const api = require('node-telegram-bot-api');
  const t = new api(config.BOT_TOKEN);
  t.setWebHook(`${config.API_URL}/webhook/telegram`);
});
