import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from './db.js';

// Логин и пароль владельца не хранятся в коде — читаются из .env (см.
// .env.example), который в git не попадает (.gitignore). Так секреты не
// оказываются в истории репозитория.
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — ошибку покажем ниже, при проверке самих переменных.
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// ---------- Авторизация владельца ----------
// Единственный пользователь — владелец автосервиса.
const OWNER_PHONE = process.env.OWNER_PHONE;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
// Ключ API Профит-Лиги — опционален: без него отслеживание статуса запчастей
// просто не работает, сервер не падает (см. /api/profitliga/*).
const PROFITLIGA_API_KEY = process.env.PROFITLIGA_API_KEY || '';
if (!OWNER_PHONE || !OWNER_PASSWORD) {
  console.error(
    'Не заданы OWNER_PHONE/OWNER_PASSWORD. Скопируйте .env.example в .env и впишите туда логин и пароль владельца.'
  );
  process.exit(1);
}
const SESSION_COOKIE = 'session';
const sessions = new Set();

// ---------- Авторизация клиента (вход по VIN) ----------
// Отдельная от владельца сессия: клиент входит по VIN своей машины. Если VIN
// не найден в базе — просим пароль (текущий год), чтобы отсечь спам-ботов,
// но не мешать реальным новым клиентам, которых ещё нет в базе.
const CLIENT_SESSION_COOKIE = 'client_session';
const clientSessions = new Map(); // token -> vin

// Сессии (владельца и клиентов) держим в памяти для быстрой проверки на
// каждый запрос, но зеркалим в таблицу sessions — иначе перезапуск сервера
// разлогинивал бы всех, хотя cookie в браузере (Max-Age 30 дней) ещё месяц
// оставалась бы валидной, и телефон "забывал" бы вход при каждом деплое.
function loadPersistedSessions() {
  db.prepare(`DELETE FROM sessions WHERE created_at < datetime('now', '-30 days')`).run();
  for (const row of db.prepare('SELECT token, kind, vin FROM sessions').all()) {
    if (row.kind === 'owner') sessions.add(row.token);
    else if (row.kind === 'client' && row.vin) clientSessions.set(row.token, row.vin);
  }
}
loadPersistedSessions();

function normalizeVin(v) {
  return (v || '').trim().toUpperCase().slice(0, 17);
}

function currentYearPassword() {
  return String(new Date().getFullYear());
}

function getClientVin(req) {
  const token = parseCookies(req)[CLIENT_SESSION_COOKIE];
  return token ? clientSessions.get(token) || null : null;
}

function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}

// Логин вводится без маски — сравниваем по цифрам, но приводим 8XXXXXXXXXX к 7XXXXXXXXXX,
// как раньше делала маска на клиенте, иначе "8918..." и "+7918..." не совпадут.
function normalizeRuPhoneDigits(v) {
  let digits = onlyDigits(v);
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  return digits;
}

// Ищем клиента по телефону (сравниваем по цифрам, независимо от формата
// хранения) — самый свежий по updated_at, если телефон встречается у нескольких строк.
function findClientByPhoneDigits(phoneDigits) {
  const rows = db.prepare(`SELECT * FROM clients WHERE phone != '' ORDER BY updated_at DESC`).all();
  return rows.find((r) => normalizeRuPhoneDigits(r.phone) === phoneDigits) || null;
}

// Префикс для случая "нашли клиента по телефону, но VIN у него не указан"
// (или телефон вообще неизвестен) — технический ключ сессии/анкеты, который
// НЕЛЬЗЯ путать с настоящим VIN и НЕЛЬЗЯ показывать клиенту как его VIN (см.
// getClientProfile — оттуда он специально не отдаётся на фронтенд). Клиент
// должен вписать свой настоящий VIN сам в анкете — это и создаст заявку
// админу (см. isNewClient в /api/client/car), как при обычной регистрации.
const PHONE_LOGIN_PREFIX = 'PHONE:';

// Вход клиента — по VIN или по телефону, оба сводятся к одному "идентификатору"
// сессии, на котором держится весь клиентский кабинет (client_car_profiles,
// история ремонта, сессии). По VIN — используется сам VIN. По телефону —
// либо VIN уже найденного по телефону клиента (если он указан), либо
// технический PHONE:-идентификатор (см. выше), но никогда не сам номер
// телефона в качестве "VIN".
function resolveClientLoginIdentifier(body) {
  const vinInput = normalizeVin(body.vin);
  if (vinInput) {
    const known = !!db.prepare('SELECT 1 FROM clients WHERE UPPER(vin) = ? LIMIT 1').get(vinInput);
    return { identifier: vinInput, known };
  }
  const phoneDigits = normalizeRuPhoneDigits(body.phone);
  if (phoneDigits) {
    const match = findClientByPhoneDigits(phoneDigits);
    const matchVin = (match?.vin || '').trim().toUpperCase();
    if (matchVin) return { identifier: matchVin, known: true };
    if (match) {
      // Клиент реально есть в базе (нашёлся по телефону), просто без VIN —
      // авторизуем сразу (без пароля) и подставляем уже известные данные
      // в анкету, чтобы не просить ввести их заново.
      const identifier = PHONE_LOGIN_PREFIX + phoneDigits;
      db.prepare(
        'INSERT OR IGNORE INTO client_car_profiles (vin, name, phone, car_make, car_model, plate) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(identifier, match.name || '', match.phone || '', match.car_make || '', match.car_model || '', match.plate || '');
      return { identifier, known: true };
    }
    return { identifier: PHONE_LOGIN_PREFIX + phoneDigits, known: false };
  }
  return { identifier: '', known: false };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return !!token && sessions.has(token);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function rowsToObjects(stmt, ...args) {
  return stmt.all(...args);
}

// ---------- Clients ----------
function listClients() {
  // client_notes — заметка, которую сам клиент оставил в своём кабинете
  // (client_car_profiles, по VIN) — показываем её в карточке клиента с
  // пометкой "добавил клиент", не смешивая с заметкой самого админа.
  return db
    .prepare(
      `SELECT c.*, p.notes AS client_notes
       FROM clients c
       LEFT JOIN client_car_profiles p ON c.vin != '' AND UPPER(c.vin) = p.vin
       ORDER BY c.name COLLATE NOCASE`
    )
    .all();
}

function createClient(data) {
  const stmt = db.prepare(
    `INSERT INTO clients (name, phone, car_make, car_model, plate, tag, vin, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );
  const info = stmt.run(
    data.name?.trim() || '',
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    data.tag || '',
    (data.vin || '').trim().toUpperCase(),
    data.notes || ''
  );
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
}

function updateClient(id, data) {
  db.prepare(
    `UPDATE clients SET name=?, phone=?, car_make=?, car_model=?, plate=?, tag=?, vin=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    data.name?.trim() || '',
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    data.tag || '',
    (data.vin || '').trim().toUpperCase(),
    data.notes || '',
    id
  );
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function deleteClient(id) {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

// ---------- Repair records (история ремонта) ----------
function parseRepairRecord(row) {
  if (!row) return row;
  return { ...row, works: JSON.parse(row.works || '[]'), parts: JSON.parse(row.parts || '[]') };
}

function normalizeRepairItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const out = { name: String(it?.name || '').trim(), price: Number(it?.price) || 0 };
      if (it?.article !== undefined) out.article = String(it.article || '').trim();
      if (it?.brand !== undefined) out.brand = String(it.brand || '').trim();
      if (it?.qty !== undefined) out.qty = Number(it.qty) || 0;
      if (it?.received !== undefined) out.received = !!it.received;
      if (it?.supplier !== undefined) out.supplier = String(it.supplier || '').trim();
      // Аналоги запчастей (несколько вариантов на выбор в заказе) — group
      // объединяет строки, selected отмечает, какая считается в итоге.
      if (it?.analogGroup) out.analogGroup = String(it.analogGroup).trim();
      if (it?.analogSelected !== undefined) out.analogSelected = !!it.analogSelected;
      // included=false — позиция, которую клиент решил не делать: остаётся
      // в записи (чтобы не терять данные), но не в сумме и не в заказ-наряде.
      // Отсутствие поля равносильно true — старые записи без него не ломаются.
      if (it?.included === false) out.included = false;
      // master у работы — переопределение мастера записи для конкретной
      // работы (когда запись делали разные мастера); пусто = считается по
      // мастеру всей записи. reportExcluded — работа не в сумме отчёта, но
      // остаётся в заказ-наряде клиенту как есть (в отличие от included).
      if (it?.master !== undefined) out.master = String(it.master || '').trim();
      if (it?.reportExcluded !== undefined) out.reportExcluded = !!it.reportExcluded;
      return out;
    })
    .filter((it) => it.name || it.price);
}

function listRepairRecords(clientId) {
  return db
    .prepare('SELECT * FROM repair_records WHERE client_id = ? ORDER BY date DESC, id DESC')
    .all(clientId)
    .map(parseRepairRecord);
}

// ---------- Отчёт (выполненные работы за неделю, по автомобилям) ----------
function listRepairRecordsByDateRange(start, end) {
  return db
    .prepare(
      `SELECT r.*, c.tag AS client_tag, c.name AS client_name, c.car_make, c.car_model
       FROM repair_records r
       JOIN clients c ON c.id = r.client_id
       WHERE r.date BETWEEN ? AND ? AND r.report_hidden = 0
       ORDER BY r.date, r.id`
    )
    .all(start, end)
    .map(parseRepairRecord);
}

function createRepairRecord(clientId, data) {
  const info = db
    .prepare(
      'INSERT INTO repair_records (client_id, title, date, mileage, works, parts, parts_eta, advance, notes, master) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      clientId,
      (data.title || '').trim(),
      data.date || '',
      data.mileage ? Number(data.mileage) : null,
      JSON.stringify(normalizeRepairItems(data.works)),
      JSON.stringify(normalizeRepairItems(data.parts)),
      data.parts_eta || '',
      Number(data.advance) || 0,
      data.notes || '',
      (data.master || '').trim()
    );
  return parseRepairRecord(db.prepare('SELECT * FROM repair_records WHERE id = ?').get(info.lastInsertRowid));
}

function updateRepairRecord(id, data) {
  db.prepare('UPDATE repair_records SET title=?, date=?, mileage=?, works=?, parts=?, parts_eta=?, advance=?, notes=?, master=?, report_hidden=? WHERE id=?').run(
    (data.title || '').trim(),
    data.date || '',
    data.mileage ? Number(data.mileage) : null,
    JSON.stringify(normalizeRepairItems(data.works)),
    JSON.stringify(normalizeRepairItems(data.parts)),
    data.parts_eta || '',
    Number(data.advance) || 0,
    data.notes || '',
    (data.master || '').trim(),
    data.report_hidden ? 1 : 0,
    id
  );
  return parseRepairRecord(db.prepare('SELECT * FROM repair_records WHERE id = ?').get(id));
}

// Список мастеров для фильтра в отчёте — мастер записи плюс мастера,
// переопределённые у отдельных работ (см. normalizeRepairItems), без повторов.
function listReportMasters() {
  const masters = new Set();
  for (const row of db.prepare(`SELECT master, works FROM repair_records`).all()) {
    if (row.master) masters.add(row.master);
    try {
      for (const w of JSON.parse(row.works || '[]')) if (w.master) masters.add(w.master);
    } catch {
      // Повреждённый JSON — пропускаем эту запись, на список остальных не влияет.
    }
  }
  return Array.from(masters).sort((a, b) => a.localeCompare(b, 'ru'));
}

function deleteRepairRecord(id) {
  db.prepare('DELETE FROM repair_records WHERE id = ?').run(id);
}

// ---------- Queue (клиенты в очереди на запчасти) ----------
function parseQueueEntry(row) {
  if (!row) return row;
  return { ...row, works: JSON.parse(row.works || '[]'), parts: JSON.parse(row.parts || '[]') };
}

function listQueueEntries() {
  return db.prepare('SELECT * FROM queue_entries ORDER BY created_at DESC').all().map(parseQueueEntry);
}

function createQueueEntry(data) {
  const info = db
    .prepare(
      `INSERT INTO queue_entries (name, phone, car_make, car_model, plate, vin, tag, status, title, date, mileage, works, parts, parts_eta, advance, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (data.name || '').trim(),
      data.phone || '',
      data.car_make || '',
      data.car_model || '',
      data.plate || '',
      (data.vin || '').trim().toUpperCase(),
      (data.tag || '').trim(),
      data.status || 'waiting',
      (data.title || '').trim(),
      data.date || '',
      data.mileage ? Number(data.mileage) : null,
      JSON.stringify(normalizeRepairItems(data.works)),
      JSON.stringify(normalizeRepairItems(data.parts)),
      data.parts_eta || '',
      Number(data.advance) || 0,
      data.notes || ''
    );
  return parseQueueEntry(db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(info.lastInsertRowid));
}

function updateQueueEntry(id, data) {
  db.prepare(
    `UPDATE queue_entries
     SET name=?, phone=?, car_make=?, car_model=?, plate=?, vin=?, tag=?, status=?, title=?, date=?, mileage=?, works=?, parts=?, parts_eta=?, advance=?, notes=?
     WHERE id=?`
  ).run(
    (data.name || '').trim(),
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    (data.vin || '').trim().toUpperCase(),
    (data.tag || '').trim(),
    data.status || 'waiting',
    (data.title || '').trim(),
    data.date || '',
    data.mileage ? Number(data.mileage) : null,
    JSON.stringify(normalizeRepairItems(data.works)),
    JSON.stringify(normalizeRepairItems(data.parts)),
    data.parts_eta || '',
    Number(data.advance) || 0,
    data.notes || '',
    id
  );
  return parseQueueEntry(db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(id));
}

function deleteQueueEntry(id) {
  db.prepare('DELETE FROM queue_entries WHERE id = ?').run(id);
}

// ---------- Профит-Лига: статус заказанных запчастей ----------
// Мастер при заказе на сайте pr-lg.ru вписывает в комментарий к позиции
// что-то узнаваемое (например "АлександрIS250" — клиент+модель) — тот же
// текст мастер вписывает в поле "Тег" у клиента/заказа в нашем приложении.
// Здесь тег сопоставляется с комментариями из последних заказов ПЛ через их
// API, чтобы понять статус, не заходя на их сайт. Один тег может встречаться
// в нескольких их заказах (позиции докупались отдельно) — поэтому на тег
// приходится список позиций, а не одна.
let plOrdersCache = { ts: 0, byTag: new Map() };
const PL_CACHE_TTL_MS = 3 * 60 * 1000;

async function fetchProfitLigaOrders() {
  const now = Date.now();
  if (now - plOrdersCache.ts < PL_CACHE_TTL_MS) return plOrdersCache.byTag;
  const byTag = new Map();
  if (PROFITLIGA_API_KEY) {
    // Страницы отсортированы от новых к старым; для отслеживания «в пути»
    // хватает первой (последние ~100 заказов) — давно закрытые не нужны.
    const res = await fetch(`https://api.pr-lg.ru/orders/list?secret=${PROFITLIGA_API_KEY}&page=1`);
    const json = await res.json();
    for (const order of json.data || []) {
      for (const p of order.products || []) {
        const key = String(p.comment || '').trim().toLowerCase();
        if (!key) continue;
        if (!byTag.has(key)) byTag.set(key, []);
        byTag.get(key).push({
          order_id: order.order_id,
          article: p.article,
          brand: p.brand,
          status_id: Number(p.status_id),
          status: p.status,
          status_update: p.status_update,
        });
      }
    }
  }
  plOrdersCache = { ts: now, byTag };
  return byTag;
}

const PL_DELIVERED_STATUSES = new Set([9, 19]);
const PL_PROBLEM_STATUSES = new Set([6, 15, 17, 20, 22, 24, 25, 26, 27]);
function plStatusCategory(statusId) {
  if (PL_DELIVERED_STATUSES.has(statusId)) return 'delivered';
  if (PL_PROBLEM_STATUSES.has(statusId)) return 'problem';
  return 'transit';
}

// Артикул сравнивается без пробелов/дефисов и без учёта регистра — у нас и у
// ПЛ один и тот же артикул может быть записан по-разному (напр. "CD 22-009"
// и "CD22009"). Совпадение только тега недостаточно: тег общий на весь заказ,
// а конкретная запчасть считается пришедшей только если у ПЛ нашлась позиция
// с ТЕМ ЖЕ артикулом — иначе смена артикула/названия на несуществующие не
// должна была бы отмечать позицию полученной (баг, который это исправляет).
function normalizeArticle(s) {
  return String(s || '').toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
}

// ---------- Consumables (расходники) ----------
// Разделы, категории и сами расходники (артикулы) — пользователь заводит всё сам,
// никакой предустановленной структуры нет. Иерархия: раздел → категория → расходник.
function listConsumableSections() {
  return db.prepare('SELECT * FROM consumable_sections ORDER BY name COLLATE NOCASE').all();
}

function createConsumableSection(data) {
  const info = db.prepare('INSERT INTO consumable_sections (name) VALUES (?)').run((data.name || '').trim());
  return db.prepare('SELECT * FROM consumable_sections WHERE id = ?').get(info.lastInsertRowid);
}

function updateConsumableSection(id, data) {
  db.prepare('UPDATE consumable_sections SET name=? WHERE id=?').run((data.name || '').trim(), id);
  return db.prepare('SELECT * FROM consumable_sections WHERE id = ?').get(id);
}

function deleteConsumableSection(id) {
  const categoryIds = db.prepare('SELECT id FROM consumable_categories WHERE section_id = ?').all(id).map((c) => c.id);
  for (const categoryId of categoryIds) {
    db.prepare('DELETE FROM consumables WHERE category_id = ?').run(categoryId);
  }
  db.prepare('DELETE FROM consumable_categories WHERE section_id = ?').run(id);
  db.prepare('DELETE FROM consumable_sections WHERE id = ?').run(id);
}

function listConsumableCategories() {
  return db.prepare('SELECT * FROM consumable_categories ORDER BY name COLLATE NOCASE').all();
}

function createConsumableCategory(data) {
  const info = db
    .prepare('INSERT INTO consumable_categories (section_id, name) VALUES (?, ?)')
    .run(data.section_id ? Number(data.section_id) : null, (data.name || '').trim());
  return db.prepare('SELECT * FROM consumable_categories WHERE id = ?').get(info.lastInsertRowid);
}

function updateConsumableCategory(id, data) {
  db.prepare('UPDATE consumable_categories SET section_id=?, name=? WHERE id=?').run(
    data.section_id ? Number(data.section_id) : null,
    (data.name || '').trim(),
    id
  );
  return db.prepare('SELECT * FROM consumable_categories WHERE id = ?').get(id);
}

function deleteConsumableCategory(id) {
  db.prepare('DELETE FROM consumables WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM consumable_categories WHERE id = ?').run(id);
}

function listConsumables() {
  return db.prepare('SELECT * FROM consumables ORDER BY name COLLATE NOCASE').all();
}

function createConsumable(data) {
  const info = db
    .prepare('INSERT INTO consumables (category_id, name, article, notes) VALUES (?, ?, ?, ?)')
    .run(
      data.category_id ? Number(data.category_id) : null,
      (data.name || '').trim(),
      (data.article || '').trim(),
      data.notes || ''
    );
  return db.prepare('SELECT * FROM consumables WHERE id = ?').get(info.lastInsertRowid);
}

function updateConsumable(id, data) {
  db.prepare('UPDATE consumables SET category_id=?, name=?, article=?, notes=? WHERE id=?').run(
    data.category_id ? Number(data.category_id) : null,
    (data.name || '').trim(),
    (data.article || '').trim(),
    data.notes || '',
    id
  );
  return db.prepare('SELECT * FROM consumables WHERE id = ?').get(id);
}

function deleteConsumable(id) {
  db.prepare('DELETE FROM consumables WHERE id = ?').run(id);
}

// ---------- ТО: артикулы масла/фильтров по марке/модели авто ----------
function listToArticles() {
  return db.prepare('SELECT * FROM to_articles ORDER BY car_make COLLATE NOCASE, car_model COLLATE NOCASE').all();
}

function createToArticle(data) {
  const info = db
    .prepare(
      `INSERT INTO to_articles (car_make, car_model, tag, oil_spec, oil_article, oil_filter_article, air_filter_article, cabin_filter_article, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (data.car_make || '').trim(),
      (data.car_model || '').trim(),
      (data.tag || '').trim(),
      (data.oil_spec || '').trim(),
      (data.oil_article || '').trim(),
      (data.oil_filter_article || '').trim(),
      (data.air_filter_article || '').trim(),
      (data.cabin_filter_article || '').trim(),
      data.notes || ''
    );
  return db.prepare('SELECT * FROM to_articles WHERE id = ?').get(info.lastInsertRowid);
}

function updateToArticle(id, data) {
  db.prepare(
    `UPDATE to_articles
     SET car_make=?, car_model=?, tag=?, oil_spec=?, oil_article=?, oil_filter_article=?, air_filter_article=?, cabin_filter_article=?, notes=?
     WHERE id=?`
  ).run(
    (data.car_make || '').trim(),
    (data.car_model || '').trim(),
    (data.tag || '').trim(),
    (data.oil_spec || '').trim(),
    (data.oil_article || '').trim(),
    (data.oil_filter_article || '').trim(),
    (data.air_filter_article || '').trim(),
    (data.cabin_filter_article || '').trim(),
    data.notes || '',
    id
  );
  return db.prepare('SELECT * FROM to_articles WHERE id = ?').get(id);
}

function deleteToArticle(id) {
  db.prepare('DELETE FROM to_articles WHERE id = ?').run(id);
}

// ---------- Client portal (кабинет клиента) ----------
function getClientProfile(vin) {
  const matched = db.prepare('SELECT * FROM clients WHERE UPPER(vin) = ?').all(vin);
  const profile = db.prepare('SELECT * FROM client_car_profiles WHERE vin = ?').get(vin);
  const repairs = db
    .prepare(
      `SELECT r.* FROM repair_records r
       JOIN clients c ON c.id = r.client_id
       WHERE UPPER(c.vin) = ?
       ORDER BY r.date DESC, r.id DESC`
    )
    .all(vin)
    .map(parseRepairRecord);
  const fallback = matched[0] || {};
  // vin, вошедший по телефону без указанного VIN, — технический ключ сессии
  // (см. PHONE_LOGIN_PREFIX), не настоящий VIN; клиенту его не показываем —
  // иначе он выглядел бы как VIN и клиент решил бы, что всё уже заполнено.
  const isPhonePlaceholder = vin.startsWith(PHONE_LOGIN_PREFIX);
  return {
    vin: isPhonePlaceholder ? '' : vin,
    known: matched.length > 0,
    // Данные, которые ведёт админ, теперь в приоритете — правки в админке
    // (например, марку/модель) клиент сразу видит у себя в кабинете. Если
    // админ ещё не завёл карточку (клиент новый, known=false), используются
    // данные, которые клиент успел ввести сам. Заметки — отдельная история:
    // у клиента и у админа свои поля, каждое видно другой стороне отдельно
    // (car.notes/car.admin_notes), без слияния в одну строку.
    car: {
      name: fallback.name || profile?.name || '',
      phone: fallback.phone || profile?.phone || '',
      car_make: fallback.car_make || profile?.car_make || '',
      car_model: fallback.car_model || profile?.car_model || '',
      plate: fallback.plate || profile?.plate || '',
      notes: profile?.notes || '',
      admin_notes: fallback.notes || '',
    },
    repairs,
  };
}

function saveClientCarProfile(vin, data) {
  const name = (data.name || '').trim();
  const phone = (data.phone || '').trim();
  const car_make = (data.car_make || '').trim();
  const car_model = (data.car_model || '').trim();
  const plate = (data.plate || '').trim();
  const notes = (data.notes || '').trim();
  const existing = db.prepare('SELECT vin FROM client_car_profiles WHERE vin = ?').get(vin);
  if (existing) {
    db.prepare(`UPDATE client_car_profiles SET name=?, phone=?, car_make=?, car_model=?, plate=?, notes=?, updated_at=datetime('now') WHERE vin=?`).run(
      name,
      phone,
      car_make,
      car_model,
      plate,
      notes,
      vin
    );
  } else {
    db.prepare('INSERT INTO client_car_profiles (vin, name, phone, car_make, car_model, plate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      vin,
      name,
      phone,
      car_make,
      car_model,
      plate,
      notes
    );
  }
  return getClientProfile(vin);
}

function createClientRequest(vin, data) {
  const info = db
    .prepare('INSERT INTO client_requests (vin, message, photo) VALUES (?, ?, ?)')
    .run(vin, (data.message || '').trim(), data.photo || null);
  return db.prepare('SELECT * FROM client_requests WHERE id = ?').get(info.lastInsertRowid);
}

function listClientRequestsByVin(vin) {
  return db.prepare('SELECT * FROM client_requests WHERE vin = ? ORDER BY created_at DESC').all(vin);
}

function listClientRequestsForAdmin() {
  return db
    .prepare('SELECT * FROM client_requests ORDER BY created_at DESC')
    .all()
    .map((r) => {
      const client = db.prepare('SELECT name, phone FROM clients WHERE UPPER(vin) = ? LIMIT 1').get(r.vin);
      // Если клиента ещё нет в базе, но он сам успел заполнить анкету в своём
      // кабинете (машина/телефон) — отдаём её, чтобы админ мог подтянуть эти
      // данные в диалог "Добавить клиента", а не вбивать их заново вручную.
      const profile = client ? null : db.prepare('SELECT name, phone, car_make, car_model, plate, notes FROM client_car_profiles WHERE vin = ?').get(r.vin);
      return {
        ...r,
        client_name: client ? client.name : null,
        client_phone: client ? client.phone : null,
        client_profile: profile || null,
      };
    });
}

function markClientRequestRead(id) {
  db.prepare('UPDATE client_requests SET is_read = 1 WHERE id = ?').run(id);
}

function deleteClientRequest(id) {
  db.prepare('DELETE FROM client_requests WHERE id = ?').run(id);
}

// ---------- Заметки владельца ----------
// Свободные личные заметки, tag отличает срочные от обычных — сортируем
// срочные наверх, внутри группы новые сверху.
function normalizeNoteTag(tag) {
  return tag === 'urgent' ? 'urgent' : 'normal';
}

function listStaffNotes() {
  return db
    .prepare(`SELECT * FROM staff_notes ORDER BY (tag = 'urgent') DESC, created_at DESC, id DESC`)
    .all();
}

function createStaffNote(data) {
  const info = db
    .prepare('INSERT INTO staff_notes (text, tag) VALUES (?, ?)')
    .run((data.text || '').trim(), normalizeNoteTag(data.tag));
  return db.prepare('SELECT * FROM staff_notes WHERE id = ?').get(info.lastInsertRowid);
}

function updateStaffNote(id, data) {
  db.prepare(`UPDATE staff_notes SET text=?, tag=?, updated_at=datetime('now') WHERE id=?`).run(
    (data.text || '').trim(),
    normalizeNoteTag(data.tag),
    id
  );
  return db.prepare('SELECT * FROM staff_notes WHERE id = ?').get(id);
}

function deleteStaffNote(id) {
  db.prepare('DELETE FROM staff_notes WHERE id = ?').run(id);
}

// ---------- Appointments ----------
function listAppointments(start, end) {
  return db
    .prepare(
      `SELECT a.*,
              COALESCE(c.name, a.walkin_name) as client_name,
              COALESCE(c.phone, a.walkin_phone) as client_phone,
              c.car_make, c.car_model, c.plate, c.vin as client_vin,
              a.walkin_car,
              (a.client_id IS NULL) as is_walkin
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.date BETWEEN ? AND ?
       ORDER BY a.date, a.time`
    )
    .all(start, end);
}

function normalizeAppointmentInput(data) {
  // client_id может прийти пустой строкой из <select> — считаем это "разовый визит"
  const clientId = data.client_id ? Number(data.client_id) : null;
  return {
    client_id: clientId,
    walkin_name: clientId ? '' : (data.walkin_name || '').trim(),
    walkin_phone: clientId ? '' : (data.walkin_phone || ''),
    walkin_car: clientId ? '' : (data.walkin_car || ''),
    vin: (data.vin || '').trim().toUpperCase(),
    date: data.date,
    time: data.time,
    service: data.service || '',
    status: data.status || '',
    notes: data.notes || '',
  };
}

function createAppointment(rawData) {
  const data = normalizeAppointmentInput(rawData);
  const info = db
    .prepare(
      `INSERT INTO appointments (client_id, walkin_name, walkin_phone, walkin_car, vin, date, time, service, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.client_id,
      data.walkin_name,
      data.walkin_phone,
      data.walkin_car,
      data.vin,
      data.date,
      data.time,
      data.service,
      data.status,
      data.notes
    );
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid);
}

function updateAppointment(id, rawData) {
  const data = normalizeAppointmentInput(rawData);
  db.prepare(
    `UPDATE appointments
     SET client_id=?, walkin_name=?, walkin_phone=?, walkin_car=?, vin=?, date=?, time=?, service=?, status=?, notes=?
     WHERE id=?`
  ).run(
    data.client_id,
    data.walkin_name,
    data.walkin_phone,
    data.walkin_car,
    data.vin,
    data.date,
    data.time,
    data.service,
    data.status,
    data.notes,
    id
  );
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}

function deleteAppointment(id) {
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
}

// ---------- Static files ----------
function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- Router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    // Auth
    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const phoneOk = normalizeRuPhoneDigits(body.phone) === normalizeRuPhoneDigits(OWNER_PHONE);
      const passOk = (body.password || '') === OWNER_PASSWORD;
      if (!phoneOk || !passOk) {
        return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
      }
      const token = crypto.randomUUID();
      sessions.add(token);
      db.prepare('INSERT INTO sessions (token, kind) VALUES (?, ?)').run(token, 'owner');
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) {
        sessions.delete(token);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      }
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      return sendJSON(res, 200, { authenticated: isAuthenticated(req) });
    }

    // Авторизация клиента по VIN — отдельная от владельца, со своим гейтом ниже.
    if (pathname === '/api/client-login' && req.method === 'POST') {
      const body = await readBody(req);
      const { identifier, known } = resolveClientLoginIdentifier(body);
      if (!identifier) return sendJSON(res, 400, { error: 'Введите VIN или телефон' });
      if (!known) {
        const password = (body.password || '').trim();
        if (!password) return sendJSON(res, 200, { ok: false, needPassword: true });
        if (password !== currentYearPassword()) {
          return sendJSON(res, 401, { error: 'Неверный пароль' });
        }
      }
      const token = crypto.randomUUID();
      clientSessions.set(token, identifier);
      db.prepare('INSERT INTO sessions (token, kind, vin) VALUES (?, ?, ?)').run(token, 'client', identifier);
      res.setHeader('Set-Cookie', `${CLIENT_SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/client-logout' && req.method === 'POST') {
      const token = parseCookies(req)[CLIENT_SESSION_COOKIE];
      if (token) {
        clientSessions.delete(token);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      }
      res.setHeader('Set-Cookie', `${CLIENT_SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/client-session' && req.method === 'GET') {
      return sendJSON(res, 200, { authenticated: !!getClientVin(req) });
    }

    // API кабинета клиента — доступ по клиентской сессии (VIN), не по владельческой.
    if (pathname === '/api/client/me' && req.method === 'GET') {
      const vin = getClientVin(req);
      if (!vin) return sendJSON(res, 401, { error: 'Требуется авторизация' });
      return sendJSON(res, 200, getClientProfile(vin));
    }
    if (pathname === '/api/client/car' && req.method === 'PUT') {
      const currentVin = getClientVin(req);
      if (!currentVin) return sendJSON(res, 401, { error: 'Требуется авторизация' });
      const body = await readBody(req);
      const newVin = normalizeVin(body.vin) || currentVin;
      if (!newVin) return sendJSON(res, 400, { error: 'Введите VIN' });
      // Клиент мог ошибиться при входе и теперь исправляет VIN прямо в анкете —
      // переносим сессию на исправленный VIN, старую анкету по опечатке чистим.
      if (newVin !== currentVin) {
        db.prepare('DELETE FROM client_car_profiles WHERE vin = ?').run(currentVin);
        const token = parseCookies(req)[CLIENT_SESSION_COOKIE];
        if (token) {
          clientSessions.set(token, newVin);
          db.prepare('UPDATE sessions SET vin = ? WHERE token = ?').run(newVin, token);
        }
      }
      // Если этого VIN ещё нет в базе клиентов — это регистрация нового
      // клиента (на фронтенде кнопка в этом случае так и называется:
      // "Добавить в базу"), а не правка существующей анкеты — заводим
      // заявку, чтобы админ увидел во вкладке «Заявки» и добавил карточку.
      const isNewClient = !db.prepare('SELECT 1 FROM clients WHERE UPPER(vin) = ? LIMIT 1').get(newVin);
      const savedProfile = saveClientCarProfile(newVin, body);
      if (isNewClient) {
        createClientRequest(newVin, {
          message: 'Новый клиент зарегистрировался в кабинете и указал свои данные — нужно завести карточку в базе.',
        });
      }
      return sendJSON(res, 200, savedProfile);
    }
    if (pathname === '/api/client/requests' && req.method === 'GET') {
      const vin = getClientVin(req);
      if (!vin) return sendJSON(res, 401, { error: 'Требуется авторизация' });
      return sendJSON(res, 200, listClientRequestsByVin(vin));
    }
    if (pathname === '/api/client/requests' && req.method === 'POST') {
      const vin = getClientVin(req);
      if (!vin) return sendJSON(res, 401, { error: 'Требуется авторизация' });
      const body = await readBody(req);
      if (!(body.message || '').trim() && !body.photo) {
        return sendJSON(res, 400, { error: 'Добавьте текст сообщения или фото' });
      }
      if (body.photo && body.photo.length > 3_000_000) {
        return sendJSON(res, 400, { error: 'Фото слишком большое' });
      }
      return sendJSON(res, 201, createClientRequest(vin, body));
    }

    // Всё остальное API — только для авторизованного владельца.
    if (pathname.startsWith('/api/') && !isAuthenticated(req)) {
      return sendJSON(res, 401, { error: 'Требуется авторизация' });
    }

    // Clients
    if (pathname === '/api/clients' && req.method === 'GET') {
      return sendJSON(res, 200, listClients());
    }
    if (pathname === '/api/clients' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Имя клиента обязательно' });
      return sendJSON(res, 201, createClient(body));
    }
    let m = pathname.match(/^\/api\/clients\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, updateClient(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteClient(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }
    m = pathname.match(/^\/api\/clients\/(\d+)\/repairs$/);
    if (m && req.method === 'GET') {
      return sendJSON(res, 200, listRepairRecords(Number(m[1])));
    }
    if (m && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 201, createRepairRecord(Number(m[1]), body));
    }
    m = pathname.match(/^\/api\/repairs\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, updateRepairRecord(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteRepairRecord(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // Заявки клиентов (входящие, видит только владелец)
    if (pathname === '/api/requests' && req.method === 'GET') {
      return sendJSON(res, 200, listClientRequestsForAdmin());
    }
    m = pathname.match(/^\/api\/requests\/(\d+)\/read$/);
    if (m && req.method === 'PUT') {
      markClientRequestRead(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }
    m = pathname.match(/^\/api\/requests\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      deleteClientRequest(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // Заметки владельца
    if (pathname === '/api/notes' && req.method === 'GET') {
      return sendJSON(res, 200, listStaffNotes());
    }
    if (pathname === '/api/notes' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.text || !body.text.trim()) return sendJSON(res, 400, { error: 'Текст заметки обязателен' });
      return sendJSON(res, 201, createStaffNote(body));
    }
    m = pathname.match(/^\/api\/notes\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.text || !body.text.trim()) return sendJSON(res, 400, { error: 'Текст заметки обязателен' });
      return sendJSON(res, 200, updateStaffNote(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteStaffNote(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // Queue
    if (pathname === '/api/queue' && req.method === 'GET') {
      return sendJSON(res, 200, listQueueEntries());
    }
    if (pathname === '/api/queue' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Имя обязательно' });
      return sendJSON(res, 201, createQueueEntry(body));
    }
    m = pathname.match(/^\/api\/queue\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, updateQueueEntry(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteQueueEntry(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // Список позиций у Профит-Лиги по тегу клиента/заказа (см. fetchProfitLigaOrders) —
    // конкретную запчасть фронтенд сверяет с этим списком по артикулу сам.
    if (pathname === '/api/profitliga/status' && req.method === 'GET') {
      if (!PROFITLIGA_API_KEY) return sendJSON(res, 200, {});
      const byTag = await fetchProfitLigaOrders();
      const out = {};
      for (const [key, products] of byTag) {
        out[key] = products.map((p) => ({ ...p, category: plStatusCategory(p.status_id) }));
      }
      return sendJSON(res, 200, out);
    }
    // Проверить все заказы в «Заказах» и автоматически отметить «на складе» те
    // позиции, у которых артикул совпал с доставленной позицией у Профит-Лиги
    // под тем же тегом — тег без совпадения по артикулу ничего не отмечает.
    if (pathname === '/api/profitliga/sync' && req.method === 'POST') {
      if (!PROFITLIGA_API_KEY) return sendJSON(res, 400, { error: 'Профит-Лига API не настроен' });
      const byTag = await fetchProfitLigaOrders();
      let updated = 0;
      for (const entry of listQueueEntries()) {
        const tag = (entry.tag || '').trim().toLowerCase();
        if (!tag) continue;
        const products = byTag.get(tag);
        if (!products || !products.length) continue;
        let changed = false;
        const parts = entry.parts.map((p) => {
          if (!p.name || !p.article || p.received) return p;
          const key = normalizeArticle(p.article);
          if (!key) return p;
          const match = products.find((prod) => normalizeArticle(prod.article) === key);
          if (match && PL_DELIVERED_STATUSES.has(match.status_id)) {
            changed = true;
            return { ...p, received: true };
          }
          return p;
        });
        if (!changed) continue;
        const partsWithName = parts.filter((p) => p.name);
        const status = partsWithName.length && partsWithName.every((p) => p.received) ? 'arrived' : entry.status;
        updateQueueEntry(entry.id, { ...entry, parts, status });
        updated++;
      }
      return sendJSON(res, 200, { updated });
    }

    // Consumables
    if (pathname === '/api/consumable-sections' && req.method === 'GET') {
      return sendJSON(res, 200, listConsumableSections());
    }
    if (pathname === '/api/consumable-sections' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 201, createConsumableSection(body));
    }
    m = pathname.match(/^\/api\/consumable-sections\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 200, updateConsumableSection(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteConsumableSection(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/consumable-categories' && req.method === 'GET') {
      return sendJSON(res, 200, listConsumableCategories());
    }
    if (pathname === '/api/consumable-categories' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 201, createConsumableCategory(body));
    }
    m = pathname.match(/^\/api\/consumable-categories\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 200, updateConsumableCategory(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteConsumableCategory(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/consumables' && req.method === 'GET') {
      return sendJSON(res, 200, listConsumables());
    }
    if (pathname === '/api/consumables' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 201, createConsumable(body));
    }
    m = pathname.match(/^\/api\/consumables\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: 'Название обязательно' });
      return sendJSON(res, 200, updateConsumable(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteConsumable(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // ТО — артикулы масла/фильтров по марке/модели авто
    if (pathname === '/api/to-articles' && req.method === 'GET') {
      return sendJSON(res, 200, listToArticles());
    }
    if (pathname === '/api/to-articles' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.car_make || !body.car_make.trim()) return sendJSON(res, 400, { error: 'Марка обязательна' });
      return sendJSON(res, 201, createToArticle(body));
    }
    m = pathname.match(/^\/api\/to-articles\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.car_make || !body.car_make.trim()) return sendJSON(res, 400, { error: 'Марка обязательна' });
      return sendJSON(res, 200, updateToArticle(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteToArticle(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    // Отчёт — выполненные работы по автомобилям за диапазон дат (неделя)
    if (pathname === '/api/reports' && req.method === 'GET') {
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if (!start || !end) return sendJSON(res, 400, { error: 'Нужны параметры start и end' });
      return sendJSON(res, 200, listRepairRecordsByDateRange(start, end));
    }
    // Отчёт — список мастеров для фильтра.
    if (pathname === '/api/reports/masters' && req.method === 'GET') {
      return sendJSON(res, 200, listReportMasters());
    }

    // Appointments
    if (pathname === '/api/appointments' && req.method === 'GET') {
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if (!start || !end) return sendJSON(res, 400, { error: 'Нужны параметры start и end' });
      return sendJSON(res, 200, listAppointments(start, end));
    }
    if (pathname === '/api/appointments' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.date || !body.time) {
        return sendJSON(res, 400, { error: 'Дата и время обязательны' });
      }
      if (!body.client_id && !(body.walkin_name || '').trim()) {
        return sendJSON(res, 400, { error: 'Укажите клиента из базы или имя разового клиента' });
      }
      return sendJSON(res, 201, createAppointment(body));
    }
    m = pathname.match(/^\/api\/appointments\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      return sendJSON(res, 200, updateAppointment(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteAppointment(Number(m[1]));
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Не найдено' });
    }

    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: 'Внутренняя ошибка сервера', details: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Автосервис запущен: http://localhost:${PORT}`);
});
