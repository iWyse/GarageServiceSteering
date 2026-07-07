import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'autoservice.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    car_make TEXT,
    car_model TEXT,
    plate TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE, -- NULL = разовый визит без базы
    walkin_name TEXT,   -- имя разового клиента (когда client_id пустой)
    walkin_phone TEXT,
    walkin_car TEXT,    -- марка/модель/номер разового клиента одной строкой
    date TEXT NOT NULL,      -- YYYY-MM-DD
    time TEXT NOT NULL,      -- HH:MM
    service TEXT,
    status TEXT DEFAULT 'planned', -- planned | in_progress | done | cancelled
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---------- Миграция старых баз (версия до "разовых визитов") ----------
// Если appointments была создана первой версией сервера, в ней ещё нет
// колонок walkin_* и client_id обязателен (NOT NULL). Пересобираем таблицу,
// сохраняя все существующие записи.
function migrateOldAppointmentsSchema() {
  const columns = db.prepare(`PRAGMA table_info(appointments)`).all().map((c) => c.name);
  const hasWalkinColumns = columns.includes('walkin_name');
  if (hasWalkinColumns) return; // уже актуальная схема

  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE appointments RENAME TO appointments_old_v1`);
    db.exec(`
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        walkin_name TEXT,
        walkin_phone TEXT,
        walkin_car TEXT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        service TEXT,
        status TEXT DEFAULT 'planned',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO appointments (id, client_id, date, time, service, status, notes, created_at)
      SELECT id, client_id, date, time, service, status, notes, created_at FROM appointments_old_v1;
    `);
    db.exec(`DROP TABLE appointments_old_v1`);
    db.exec('COMMIT');
    console.log('База данных обновлена до новой схемы (добавлена поддержка разовых визитов).');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrateOldAppointmentsSchema();

export default db;
