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
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const {
  ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET,
  ZOHO_REFRESH_TOKEN,
  ZOHO_ORG_ID,
  ZOHO_DC = 'eu',
  // Общий секрет между бэкендом e-com сайта и этим прокси.
  // Им e-com ПОДПИСЫВАЕТ токен клиента, а мы его ПРОВЕРЯЕМ.
  // Должен быть длинной случайной строкой, храниться ТОЛЬКО на
  // серверах (в Environment Variables), никогда в браузере.
  PORTAL_JWT_SECRET,
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

/* -----------------------------------------------------------------
   ВРЕМЕННЫЙ ДИАГНОСТИЧЕСКИЙ ENDPOINT — помогает понять, почему поиск
   по email не находит тикеты. Открой в браузере:
     https://<прокси>.onrender.com/api/debug?email=mirshahmur@yahoo.com
   Покажет: сколько всего тикетов, какие у них email, и что вернул
   поиск по email. УДАЛИ этот блок, когда всё заработает.
   ----------------------------------------------------------------- */
app.get('/api/debug', async (req, res) => {
  if (!checkEnv(res)) return;
  const email = req.query.email || '';
  const out = {};
  try {
    // 1. Последние тикеты в системе (какие вообще есть и с каким email)
    const all = await zohoFetch('/tickets?limit=20&include=contacts');
    out.allTicketsCount = (all.data || []).length;
    out.allTickets = (all.data || []).map((t) => ({
      id: t.ticketNumber || t.id,
      subject: t.subject,
      email: t.email,
      contactEmail: t.contact ? t.contact.email : undefined,
    }));
  } catch (e) {
    out.allTicketsError = e.message;
  }

  try {
    // 2. Что возвращает поиск по email
    const p = new URLSearchParams();
    p.set('email', email);
    p.set('limit', '50');
    const search = await zohoFetch(`/tickets/search?${p.toString()}`);
    out.searchByEmailCount = (search.data || []).length;
    out.searchByEmail = (search.data || []).map((t) => ({
      id: t.ticketNumber || t.id,
      subject: t.subject,
    }));
  } catch (e) {
    out.searchError = e.message;
    out.searchErrorStatus = e.status;
  }

  // 3. Ищем контакт по email через список контактов с фильтром
  try {
    const cp = new URLSearchParams();
    cp.set('email', email);
    const contacts = await zohoFetch(`/contacts?${cp.toString()}`);
    out.contactsByEmailCount = (contacts.data || []).length;
    out.contacts = (contacts.data || []).map((c) => ({ id: c.id, email: c.email }));

    // 4. Если контакт найден — берём его тикеты
    if ((contacts.data || []).length) {
      const cid = contacts.data[0].id;
      const tickets = await zohoFetch(`/contacts/${cid}/tickets?limit=50`);
      out.contactTicketsCount = (tickets.data || []).length;
      out.contactTickets = (tickets.data || []).map((t) => ({
        id: t.ticketNumber || t.id,
        subject: t.subject,
      }));
    }
  } catch (e) {
    out.contactLookupError = e.message;
    out.contactLookupStatus = e.status;
  }

  res.json(out);
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
// body: { subject, departmentId, description, email, name, memberId, phone, contactId }
app.post('/api/tickets', async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    const { subject, departmentId, description, email, name, memberId, phone, contactId } = req.body;

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'Please choose a category' });
    }

    // Разбиваем полное имя на имя/фамилию для контакта Zoho
    let firstName, lastName;
    if (name && name.trim()) {
      const parts = name.trim().split(/\s+/);
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      firstName = parts.length > 1 ? parts[0] : undefined;
    }

    // Zoho Desk ТРЕБУЕТ contact с обязательным lastName. Если имя не
    // заполнено — подставляем часть до @ из email, а в крайнем случае
    // "Portal User", чтобы Zoho не отклонил запрос.
    if (!lastName) {
      if (email && email.includes('@')) {
        lastName = email.split('@')[0];
      } else {
        lastName = 'Portal User';
      }
    }

    // Member ID добавляем в описание, чтобы агент его видел
    // (для отдельного поля нужно кастомное поле в Zoho Desk).
    let fullDescription = description || '';
    if (memberId && memberId.trim()) {
      fullDescription += `\n\n--- Member ID: ${memberId.trim()} ---`;
    }

    // Данные контакта Zoho ожидает во ВЛОЖЕННОМ объекте contact,
    // а не в корне тикета. Zoho сам создаст или сопоставит контакт.
    const contact = { lastName };
    if (firstName) contact.firstName = firstName;
    if (email) contact.email = email;
    if (phone) contact.phone = phone;

    const payload = {
      subject: subject.trim(),
      departmentId,
      description: fullDescription,
      // Либо готовый contactId, либо inline-объект contact.
      ...(contactId ? { contactId } : { contact }),
      // Если у тебя есть кастомное поле для Member ID в Zoho Desk,
      // раскомментируй и подставь его API-имя:
      // cf: { cf_member_id: memberId || '' },
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

/* =================================================================
   PORTAL SESSION (вход клиента через токен от e-com сайта)
   -----------------------------------------------------------------
   Клиент уже залогинен на e-com сайте. При переходе на портал e-com
   генерирует подписанный JWT с данными клиента и передаёт его сюда.
   Мы проверяем подпись общим секретом (PORTAL_JWT_SECRET) — если
   подпись верна, значит данным можно доверять (подделать нельзя,
   не зная секрета).

   Ожидаемые поля (claims) в токене от e-com:
     email      (обязательно) — email клиента
     name       (опционально) — имя клиента
     memberId   (опционально) — Herbalife Member ID
     exp        (обязательно) — время истечения токена (защита от
                                повторного использования старого токена)

   Токен передаётся в заголовке: Authorization: Bearer <token>
   ================================================================= */

/* -----------------------------------------------------------------
   ВРЕМЕННЫЙ DEV-ENDPOINT — имитация перехода с e-com сайта.
   Открой в браузере:
     https://<твой-прокси>.onrender.com/api/dev-login
   и он сгенерирует токен для тестовой почты и перекинет тебя на
   портал уже «залогиненной». Это ЗАГЛУШКА вместо e-com — когда
   e-com подключит настоящую передачу, этот endpoint нужно УДАЛИТЬ.
   ----------------------------------------------------------------- */
const DEV_LOGIN_ENABLED = true; // ← поставь false / удали блок, когда e-com заработает
const DEV_PORTAL_URL = process.env.PORTAL_URL
  || 'https://mirshahmur-commits.github.io/filuet-zoho-frontend/my-tickets.html';

app.get('/api/dev-login', (req, res) => {
  if (!DEV_LOGIN_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!PORTAL_JWT_SECRET) {
    return res.status(500).json({ error: 'PORTAL_JWT_SECRET is not set on the server' });
  }
  // Данные тестового клиента (как их прислал бы e-com)
  const token = jwt.sign(
    {
      email: 'mirshahmur@yahoo.com',
      name: 'Mirshahmur',
      memberId: 'HL-000123',
    },
    PORTAL_JWT_SECRET,
    { expiresIn: '10m' }
  );
  // Редирект на портал с токеном — ровно как сделает e-com
  res.redirect(`${DEV_PORTAL_URL}?token=${token}`);
});

function verifyPortalToken(req, res, next) {
  if (!PORTAL_JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured — PORTAL_JWT_SECRET is not set' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No session token provided' });
  }
  try {
    const payload = jwt.verify(token, PORTAL_JWT_SECRET);
    if (!payload.email) {
      return res.status(400).json({ error: 'Token is missing the email claim' });
    }
    req.client = {
      email: payload.email,
      name: payload.name || '',
      memberId: payload.memberId || '',
    };
    next();
  } catch (err) {
    // Истёкший или поддельный токен попадёт сюда
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

// GET /api/session — проверяет токен и возвращает данные клиента
// (портал вызывает это, чтобы узнать "кто вошёл" и заполнить форму)
app.get('/api/session', verifyPortalToken, (req, res) => {
  res.json(req.client);
});

// GET /api/my-tickets — тикеты ТОЛЬКО текущего клиента
app.get('/api/my-tickets', verifyPortalToken, async (req, res) => {
  if (!checkEnv(res)) return;
  try {
    // Email хранится в КОНТАКТЕ, а не в поле тикета. Поэтому:
    // 1) находим контакт по email, 2) берём тикеты этого контакта.
    const cp = new URLSearchParams();
    cp.set('email', req.client.email);
    const contacts = await zohoFetch(`/contacts?${cp.toString()}`);

    if (!(contacts.data || []).length) {
      // Контакта с таким email ещё нет — значит и тикетов нет
      return res.json([]);
    }

    const contactId = contacts.data[0].id;
    const tp = new URLSearchParams();
    if (req.query.status && req.query.status !== 'all') tp.set('status', req.query.status);
    tp.set('limit', req.query.limit || '50');

    const tickets = await zohoFetch(`/contacts/${contactId}/tickets?${tp.toString()}`);
    res.json(tickets.data || []);
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
