import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

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
    `INSERT INTO clients (name, phone, car_make, car_model, plate, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    data.name?.trim() || '',
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    data.notes || ''
  );
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
}

function updateClient(id, data) {
  db.prepare(
    `UPDATE clients SET name=?, phone=?, car_make=?, car_model=?, plate=?, notes=? WHERE id=?`
  ).run(
    data.name?.trim() || '',
    data.phone || '',
    data.car_make || '',
    data.car_model || '',
    data.plate || '',
    data.notes || '',
    id
  );
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function deleteClient(id) {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

// ---------- Appointments ----------
function listAppointments(start, end) {
  return db
    .prepare(
      `SELECT a.*,
              COALESCE(c.name, a.walkin_name) as client_name,
              COALESCE(c.phone, a.walkin_phone) as client_phone,
              c.car_make, c.car_model, c.plate,
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
    date: data.date,
    time: data.time,
    service: data.service || '',
    status: data.status || 'planned',
    notes: data.notes || '',
  };
}

function createAppointment(rawData) {
  const data = normalizeAppointmentInput(rawData);
  const info = db
    .prepare(
      `INSERT INTO appointments (client_id, walkin_name, walkin_phone, walkin_car, date, time, service, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.client_id,
      data.walkin_name,
      data.walkin_phone,
      data.walkin_car,
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
     SET client_id=?, walkin_name=?, walkin_phone=?, walkin_car=?, date=?, time=?, service=?, status=?, notes=?
     WHERE id=?`
  ).run(
    data.client_id,
    data.walkin_name,
    data.walkin_phone,
    data.walkin_car,
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
