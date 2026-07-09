import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// ---------- Авторизация владельца ----------
// Единственный пользователь — владелец автосервиса. Сессии храним в памяти
// процесса: перезапуск сервера разлогинивает всех, что для локального
// однопользовательского инструмента приемлемо и не требует внешнего хранилища.
const OWNER_PHONE = '+7XXXXXXXXXX';
const OWNER_PASSWORD = 'REDACTED';
const SESSION_COOKIE = 'session';
const sessions = new Set();

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
  return db.prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all();
}

function createClient(data) {
  const stmt = db.prepare(
    `INSERT INTO clients (name, phone, car_make, car_model, plate, tag, vin, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
    `UPDATE clients SET name=?, phone=?, car_make=?, car_model=?, plate=?, tag=?, vin=?, notes=? WHERE id=?`
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

function createRepairRecord(clientId, data) {
  const info = db
    .prepare(
      'INSERT INTO repair_records (client_id, title, date, mileage, works, parts, parts_eta, advance, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      clientId,
      (data.title || '').trim(),
      data.date,
      data.mileage ? Number(data.mileage) : null,
      JSON.stringify(normalizeRepairItems(data.works)),
      JSON.stringify(normalizeRepairItems(data.parts)),
      data.parts_eta || '',
      Number(data.advance) || 0,
      data.notes || ''
    );
  return parseRepairRecord(db.prepare('SELECT * FROM repair_records WHERE id = ?').get(info.lastInsertRowid));
}

function updateRepairRecord(id, data) {
  db.prepare('UPDATE repair_records SET title=?, date=?, mileage=?, works=?, parts=?, parts_eta=?, advance=?, notes=? WHERE id=?').run(
    (data.title || '').trim(),
    data.date,
    data.mileage ? Number(data.mileage) : null,
    JSON.stringify(normalizeRepairItems(data.works)),
    JSON.stringify(normalizeRepairItems(data.parts)),
    data.parts_eta || '',
    Number(data.advance) || 0,
    data.notes || '',
    id
  );
  return parseRepairRecord(db.prepare('SELECT * FROM repair_records WHERE id = ?').get(id));
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
      `INSERT INTO queue_entries (name, phone, car_make, car_model, plate, vin, status, title, date, mileage, works, parts, parts_eta, advance, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (data.name || '').trim(),
      data.phone || '',
      data.car_make || '',
      data.car_model || '',
      data.plate || '',
      (data.vin || '').trim().toUpperCase(),
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
     SET name=?, phone=?, car_make=?, car_model=?, plate=?, vin=?, status=?, title=?, date=?, mileage=?, works=?, parts=?, parts_eta=?, advance=?, notes=?
     WHERE id=?`
  ).run(
    (data.name || '').trim(),
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    (data.vin || '').trim().toUpperCase(),
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

// ---------- Consumables (расходники) ----------
// Категории и сами расходники (артикулы) — пользователь заводит и то, и другое сам,
// никаких предустановленных категорий нет.
function listConsumableCategories() {
  return db.prepare('SELECT * FROM consumable_categories ORDER BY name COLLATE NOCASE').all();
}

function createConsumableCategory(data) {
  const info = db.prepare('INSERT INTO consumable_categories (name) VALUES (?)').run((data.name || '').trim());
  return db.prepare('SELECT * FROM consumable_categories WHERE id = ?').get(info.lastInsertRowid);
}

function updateConsumableCategory(id, data) {
  db.prepare('UPDATE consumable_categories SET name=? WHERE id=?').run((data.name || '').trim(), id);
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
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      return sendJSON(res, 200, { authenticated: isAuthenticated(req) });
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
      if (!body.date) return sendJSON(res, 400, { error: 'Дата обязательна' });
      return sendJSON(res, 201, createRepairRecord(Number(m[1]), body));
    }
    m = pathname.match(/^\/api\/repairs\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.date) return sendJSON(res, 400, { error: 'Дата обязательна' });
      return sendJSON(res, 200, updateRepairRecord(Number(m[1]), body));
    }
    if (m && req.method === 'DELETE') {
      deleteRepairRecord(Number(m[1]));
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

    // Consumables
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
