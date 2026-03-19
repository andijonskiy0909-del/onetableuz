const router = require('express').Router();

router.post('/chat', async (req, res) => {
  try {
    const { message, lang } = req.body;
    if (!message) return res.status(400).json({ error: 'Message kerak' });

    const systemPrompts = {
      uz: `Sen OneTable platformasining AI yordamchisisisan. Toshkentdagi restoranlar uchun smart booking platformasi. Restoranlar, bron qilish va menyu haqida yordam berasan. Qisqa va do'stona javob ber. O'zbek tilida yoz.`,
      ru: `Ты AI-ассистент платформы OneTable. Умная система бронирования ресторанов в Ташкенте. Помогаешь с ресторанами, бронированием и меню. Отвечай кратко и дружелюбно. Пиши на русском.`,
      en: `You are the AI assistant for OneTable platform. A smart restaurant booking system in Tashkent. Help with restaurants, bookings and menu. Be brief and friendly. Write in English.`
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
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
    if (data.error) {
      console.error('Groq error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'AI javob bermadi' });
    res.json({ reply });
  } catch (err) {
    console.error('AI route error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
