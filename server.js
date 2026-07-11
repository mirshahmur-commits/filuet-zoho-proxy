/* =================================================================
   HERBALIFE / FILUET — ZOHO DESK API PROXY — server.js
   -----------------------------------------------------------------
   ОДИН ФАЙЛ. Задача этого сервера — единственная: спрятать твои
   Zoho OAuth-секреты (client_id / client_secret / refresh_token) от
   браузера. Твой фронтенд (index.html / new-ticket.html /
   my-tickets.html) будет стучаться СЮДА, а этот сервер уже сам
   стучится в Zoho Desk API, подставляя токен.

   =================================================================
   ЧАСТЬ 1 — КАК ЗАПУСТИТЬ ЛОКАЛЬНО (проверить, что всё работает)
   =================================================================
   1. Установи Node.js (https://nodejs.org, LTS-версия) — если ещё
      не стоит.
   2. Создай пустую папку, положи в неё этот файл (server.js) и
      файл package.json (дам его тебе тоже, но если лень — просто
      выполни ниже команды и npm сам всё создаст).
   3. В терминале, находясь в этой папке:

        npm init -y
        npm install express node-fetch@2 cors

   4. Заполни переменные окружения (см. ЧАСТЬ 2 ниже) — проще всего
      создать рядом файл .env (см. пример .env.example в конце
      этого файла) и запускать через:

        npm install dotenv
        node server.js

   5. Открой в браузере http://localhost:3000/health — если видишь
      {"status":"ok"} — сервер жив.

   =================================================================
   ЧАСТЬ 2 — ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (ГДЕ ВЗЯТЬ И КУДА ВПИСАТЬ)
   =================================================================
   Нужно 5 значений. НИКОГДА не вписывай их прямо в код — только
   через переменные окружения (ниже объяснено, где их задать на
   Render.com).

   ZOHO_CLIENT_ID       — из Zoho API Console (api-console.zoho.com)
   ZOHO_CLIENT_SECRET    — оттуда же
   ZOHO_REFRESH_TOKEN    — получаешь один раз через Self Client flow
                            (пошагово — см. комментарий ниже, метка
                            "КАК ПОЛУЧИТЬ REFRESH TOKEN")
   ZOHO_ORG_ID            — Setup → Developer Space → API → your Org ID
                            (или Zoho Desk → профиль → Org ID)
   ZOHO_DC                — датацентр аккаунта: com / eu / in / com.au
                            / jp  (по умолчанию "eu", похоже на твой
                            регион — проверь в своём аккаунте Zoho:
                            смотри на домен, с которого заходишь —
                            desk.zoho.eu = "eu" и т.д.)

   -----------------------------------------------------------------
   КАК ПОЛУЧИТЬ REFRESH TOKEN (один раз, руками, 10 минут):
   -----------------------------------------------------------------
   1. Зайди на https://api-console.zoho.com (тем же аккаунтом, что
      админ Zoho Desk).
   2. Add Client → Self Client → Create.
   3. Скопируй Client ID и Client Secret — это и есть
      ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET.
   4. Вкладка "Generate Code":
        Scope:  Desk.tickets.ALL,Desk.basic.READ,Desk.contacts.ALL
        Time duration: 10 minutes
        Description: любая
      Нажми Create — получишь "grant token" (короткоживущий код).
   5. В течение этих 10 минут выполни (замени {DC} на com/eu/in/
      com.au/jp — твой датацентр; {CODE} на полученный код):

        curl -X POST "https://accounts.zoho.{DC}/oauth/v2/token" \
          -d "grant_type=authorization_code" \
          -d "client_id=ZOHO_CLIENT_ID" \
          -d "client_secret=ZOHO_CLIENT_SECRET" \
          -d "code={CODE}"

      В ответе будет "refresh_token" — это и есть ZOHO_REFRESH_TOKEN.
      Он НЕ истекает (пока сама не отзовёшь), поэтому этот шаг
      делается один раз.

   =================================================================
   ЧАСТЬ 3 — ДЕПЛОЙ НА RENDER.COM (пошагово, без опыта достаточно)
   =================================================================
   1. Залей эту папку (server.js + package.json) в новый репозиторий
      на GitHub (можно прямо через веб-интерфейс GitHub — "Add file
      → Upload files", без командной строки).
   2. Зайди на https://render.com → зарегистрируйся (можно через
      GitHub-аккаунт).
   3. New → Web Service → выбери свой репозиторий.
   4. Runtime: Node. Build command: npm install. Start command:
      node server.js.
   5. Внизу — "Environment" → добавь 5 переменных из ЧАСТИ 2 (Key /
      Value, без кавычек).
   6. Create Web Service. Через пару минут получишь публичный адрес
      вида https://hlf-proxy.onrender.com — это и есть тот URL,
      который нужно вписать в js/api.js на фронтенде вместо моков.

   Бесплатный тариф Render "засыпает" после 15 минут без запросов и
   первый запрос после сна выполняется медленнее (~30 сек) — для
   портала поддержки это обычно не критично, но имей в виду.

   =================================================================
   ЧАСТЬ 4 — КАК ПОДКЛЮЧИТЬ К ФРОНТЕНДУ
   =================================================================
   В файле js/api.js на фронтенде нужно заменить мок-функции на
   fetch к этому серверу, например:

     const PROXY_URL = 'https://hlf-proxy.onrender.com';

     async function createTicket(payload) {
       const res = await fetch(`${PROXY_URL}/api/tickets`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload)
       });
       if (!res.ok) throw new Error((await res.json()).error || 'Ticket creation failed');
       return res.json();
     }

   Эндпоинты этого прокси-сервера уже спроектированы 1:1 под текущий
   контракт js/api.js — см. список роутов ниже в коде.
   ================================================================= */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const {
  ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET,
  ZOHO_REFRESH_TOKEN,
  ZOHO_ORG_ID,
  ZOHO_DC = 'eu',
  PORT = 3000,
} = process.env;

const ACCOUNTS_BASE = `https://accounts.zoho.${ZOHO_DC}`;
const API_BASE = `https://desk.zoho.${ZOHO_DC}/api/v1`;

function checkEnv(res) {
  const missing = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    res.status(500).json({
      error: `Server misconfigured — missing environment variables: ${missing.join(', ')}`,
    });
    return false;
  }
  return true;
}

/* ---------------- ACCESS TOKEN CACHE ----------------
   Access-токен Zoho живёт 1 час. Кэшируем в памяти процесса и
   обновляем заранее (за 2 минуты до истечения), чтобы не дёргать
   Zoho на каждый запрос. */
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const url = new URL(`${ACCOUNTS_BASE}/oauth/v2/token`);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('client_id', ZOHO_CLIENT_ID);
  url.searchParams.set('client_secret', ZOHO_CLIENT_SECRET);
  url.searchParams.set('refresh_token', ZOHO_REFRESH_TOKEN);

  const resp = await fetch(url.toString(), { method: 'POST' });
  const data = await resp.json();

  if (!resp.ok || !data.access_token) {
    throw new Error(`Failed to refresh Zoho access token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  // expires_in обычно 3600 сек — обновим за 120 сек до истечения
  cachedTokenExpiresAt = now + (data.expires_in - 120) * 1000;
  return cachedToken;
}

async function zohoFetch(path, options = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: ZOHO_ORG_ID,
      'Content-Type': 'application/json',
    },
  });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(data.message || `Zoho API error (${resp.status})`);
    err.status = resp.status;
    err.details = data;
    throw err;
  }
  return data;
}

/* =================================================================
   ROUTES — контракт совпадает с js/api.js на фронтенде
   ================================================================= */

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// GET /api/departments — список отделов/категорий
app.get('/api/departments', async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    const data = await zohoFetch('/departments');
    const departments = (data.data || []).map((d) => ({ id: d.id, name: d.name }));
    res.json(departments);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/tickets?contactId=...&status=...&searchStr=...
app.get('/api/tickets', async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    const params = new URLSearchParams();
    if (req.query.contactId) params.set('contactId', req.query.contactId);
    if (req.query.status && req.query.status !== 'all') params.set('status', req.query.status);
    if (req.query.query) params.set('searchStr', req.query.query);
    params.set('limit', req.query.limit || '50');

    const data = await zohoFetch(`/tickets?${params.toString()}`);
    res.json(data.data || []);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/tickets/:id
app.get('/api/tickets/:id', async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    const data = await zohoFetch(`/tickets/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/tickets — создание тикета
// body: { subject, departmentId, description, email, priority, contactId }
app.post('/api/tickets', async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    const { subject, departmentId, description, email, priority, contactId } = req.body;

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'Please choose a category' });
    }

    const payload = {
      subject: subject.trim(),
      departmentId,
      description: description || '',
      priority: priority || 'Medium',
      // Zoho Desk требует contact — либо contactId существующего
      // контакта, либо email для авто-создания/поиска контакта.
      ...(contactId ? { contactId } : {}),
      ...(email ? { email } : {}),
    };

    const data = await zohoFetch('/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Zoho Desk proxy listening on port ${PORT}`);
});

/* =================================================================
   .env.example — создай рядом файл .env с этим содержимым, вписав
   свои реальные значения (файл .env НЕ заливай на GitHub — добавь
   его в .gitignore. На Render эти же переменные задаются в панели
   Environment, .env файл там не нужен).
   -----------------------------------------------------------------

   ZOHO_CLIENT_ID=1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ZOHO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ZOHO_REFRESH_TOKEN=1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ZOHO_ORG_ID=60012345678
   ZOHO_DC=eu
   PORT=3000

   ================================================================= */
