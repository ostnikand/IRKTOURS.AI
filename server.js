require('dotenv').config();
const express = require('express');
const { randomUUID } = require('crypto');

if (process.env.GIGACHAT_TLS_SKIP_VERIFY === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('WARNING: TLS verification is disabled. Use only for local demo/testing.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const GIGACHAT_AUTH_KEY = process.env.GIGACHAT_AUTH_KEY;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
const GIGACHAT_MODEL = process.env.GIGACHAT_MODEL || 'GigaChat-2-Max';

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

let tokenCache = { accessToken: null, expiresAtMs: 0 };

async function getGigaChatToken() {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAtMs - 60_000) return tokenCache.accessToken;
  const resp = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': randomUUID(),
      'Authorization': `Basic ${GIGACHAT_AUTH_KEY}`,
    },
    body: new URLSearchParams({ scope: GIGACHAT_SCOPE }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Не удалось получить токен GigaChat: ${resp.status} ${text}`);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('GigaChat не вернул access_token');
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAtMs = data.expires_at ? data.expires_at * 1000 : now + 25 * 60 * 1000;
  return tokenCache.accessToken;
}

function buildPrompt({ duration, interests, budget, transport, season, travelerType, pace, outskirts }) {
  return `
Ты — помощник по составлению ПРЕДВАРИТЕЛЬНЫХ туристических маршрутов по Иркутску и окрестностям.

Твоя задача — не продавать готовый тур, а давать туристу аккуратный черновик маршрута, который потом можно показать турагенту или туроператору для проверки и доработки.

Входные параметры:
- Продолжительность: ${duration}
- Интересы: ${interests}
- Бюджет: ${budget}
- Передвижение: ${transport}
- Сезон: ${season}
- Тип поездки: ${travelerType}
- Темп: ${pace}
- Выезд за город: ${outskirts}

Жёсткие правила:
1. Используй только реальные и общеизвестные места Иркутска и ближайших окрестностей.
2. Не выдумывай музеи, кафе, отели, экскурсии, адреса, цены и расписания, если ты в них не уверен.
3. Если точных данных нет — пиши обобщённо и безопасно.
4. Не перегружай маршрут: лучше меньше точек, но логично и реалистично.
5. Учитывай сезон, темп поездки и транспорт.
6. Маршрут должен быть удобным по географии: без лишних переездов.
7. Для каждой точки указывай:
   - что это
   - зачем включено в маршрут
   - сколько примерно времени занять
8. В конце обязательно добавь:
   - Почему маршрут предварительный
   - Что стоит уточнить у турагента/туроператора
   - Кому маршрут подойдёт

Формат ответа:
1) Краткое резюме маршрута
2) Маршрут по дням
3) Короткий блок с рекомендациями
4) Финальная фраза: "Это предварительный маршрут для проверки и доработки специалистом."

Пиши на русском языке, спокойно, чётко и без выдуманных деталей.
`.trim();
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/generate-tour', async (req, res) => {
  try {
    const { duration, interests, budget, transport, season, travelerType, pace, outskirts } = req.body || {};
    if (!duration || !interests || !budget || !transport || !season || !travelerType || !pace || !outskirts) {
      return res.status(400).json({ error: 'Не хватает параметров для генерации маршрута.' });
    }
    const accessToken = await getGigaChatToken();
    const prompt = buildPrompt({ duration, interests, budget, transport, season, travelerType, pace, outskirts });

    const response = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Session-ID': randomUUID(),
      },
      body: JSON.stringify({
        model: GIGACHAT_MODEL,
        messages: [
          { role: 'system', content: 'Ты помощник по предварительным туристическим маршрутам. Не выдумывай факты, адреса, цены и расписания. Если данных не хватает — отвечай осторожно и обобщённо. Отвечай только на русском языке.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1800,
      }),
    });

    const raw = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: `Ошибка GigaChat: ${response.status} ${raw}` });
    const data = JSON.parse(raw);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: 'GigaChat вернул пустой ответ.' });
    res.json({ text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера.' });
  }
});

app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
