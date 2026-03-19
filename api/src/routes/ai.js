const router = require('express').Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

router.post('/chat', async (req, res) => {
  try {
    const { message, restaurant, lang } = req.body;
    if (!message) return res.status(400).json({ error: 'Message kerak' });

    const systemPrompts = {
      uz: `Sen OneTable platformasining AI yordamchisisisan. Toshkentdagi restoranlar haqida ma'lumot berasan, bron qilishga yordam berasan va menyuni tushuntirasан.
${restaurant ? `Hozirgi restoran: ${restaurant.name}. Manzil: ${restaurant.address}. Oshxona: ${restaurant.cuisine?.join(', ')}. Narx: ${restaurant.price_category}.` : ''}
Qisqa, aniq va do'stona javob ber. O'zbek tilida gapir.`,
      ru: `Ты AI-ассистент платформы OneTable. Помогаешь с информацией о ресторанах в Ташкенте, бронированием и меню.
${restaurant ? `Текущий ресторан: ${restaurant.name}. Адрес: ${restaurant.address}. Кухня: ${restaurant.cuisine?.join(', ')}. Цена: ${restaurant.price_category}.` : ''}
Отвечай кратко, точно и дружелюбно. Говори на русском языке.`,
      en: `You are the AI assistant for OneTable platform. You help with restaurant information in Tashkent, bookings and menu questions.
${restaurant ? `Current restaurant: ${restaurant.name}. Address: ${restaurant.address}. Cuisine: ${restaurant.cuisine?.join(', ')}. Price: ${restaurant.price_category}.` : ''}
Be brief, accurate and friendly. Speak in English.`
    };

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompts[lang || 'uz'] },
          { role: 'user', content: message }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'AI javob bermadi' });
    res.json({ reply });
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
