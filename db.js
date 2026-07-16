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
    tag TEXT,
    vin TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE, -- NULL = разовый визит без базы
    walkin_name TEXT,   -- имя разового клиента (когда client_id пустой)
    walkin_phone TEXT,
    walkin_car TEXT,    -- марка/модель/номер разового клиента одной строкой
    vin TEXT,           -- VIN автомобиля на эту запись
    date TEXT NOT NULL,      -- YYYY-MM-DD
    time TEXT NOT NULL,      -- HH:MM
    service TEXT,
    status TEXT DEFAULT 'planned', -- planned | in_progress | done | cancelled
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repair_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    title TEXT,              -- заголовок записи, напр. "ТО-1" или "Ремонт рулевой рейки"
    date TEXT NOT NULL,     -- YYYY-MM-DD
    mileage INTEGER,         -- пробег авто на момент визита, км; пусто = не указан
    works TEXT NOT NULL DEFAULT '[]', -- JSON [{name, price}] — выполненные работы
    parts TEXT NOT NULL DEFAULT '[]', -- JSON [{name, brand, qty, price}] — запчасти
    parts_eta TEXT,          -- срок поставки запчастей
    advance REAL NOT NULL DEFAULT 0, -- аванс, вычитается из итоговой суммы; 0 = не используется
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS queue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    car_make TEXT,
    car_model TEXT,
    plate TEXT,
    vin TEXT,
    status TEXT NOT NULL DEFAULT 'waiting', -- waiting | arrived
    title TEXT,
    date TEXT,
    mileage INTEGER,
    works TEXT NOT NULL DEFAULT '[]',
    parts TEXT NOT NULL DEFAULT '[]',
    parts_eta TEXT,
    advance REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consumable_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consumable_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER REFERENCES consumable_sections(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consumables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES consumable_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    article TEXT,   -- артикул
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Данные о машине, которые клиент вносит сам в своём кабинете (вход по VIN).
  -- Хранится отдельно от clients — так правки клиента никогда не затирают
  -- карточку клиента, которую ведёт админ, а один и тот же VIN может встречаться
  -- у нескольких строк clients (см. память об импорте чек-листов).
  CREATE TABLE IF NOT EXISTS client_car_profiles (
    vin TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    car_make TEXT,
    car_model TEXT,
    plate TEXT,
    notes TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Заявки от клиентов из личного кабинета (текст + опционально фото), админ
  -- видит их во вкладке «Заявки».
  CREATE TABLE IF NOT EXISTS client_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vin TEXT NOT NULL,
    message TEXT,
    photo TEXT, -- base64 data URL, может отсутствовать
    is_read INTEGER NOT NULL DEFAULT 0,
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

// ---------- Миграция: добавление VIN в существующие базы ----------
function migrateVinColumn() {
  const columns = db.prepare(`PRAGMA table_info(appointments)`).all().map((c) => c.name);
  if (!columns.includes('vin')) {
    db.exec(`ALTER TABLE appointments ADD COLUMN vin TEXT`);
    console.log('База данных обновлена: добавлено поле VIN.');
  }
}
migrateVinColumn();

// ---------- Миграция: VIN у клиентов ----------
function migrateClientVinColumn() {
  const columns = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name);
  if (!columns.includes('vin')) {
    db.exec(`ALTER TABLE clients ADD COLUMN vin TEXT`);
    console.log('База данных обновлена: добавлено поле VIN у клиентов.');
  }
}
migrateClientVinColumn();

// ---------- Миграция: заголовок у записей ремонта ----------
function migrateRepairTitleColumn() {
  const columns = db.prepare(`PRAGMA table_info(repair_records)`).all().map((c) => c.name);
  if (columns.length && !columns.includes('title')) {
    db.exec(`ALTER TABLE repair_records ADD COLUMN title TEXT`);
    console.log('База данных обновлена: добавлен заголовок записи ремонта.');
  }
}
migrateRepairTitleColumn();

// ---------- Миграция: срок поставки запчастей и аванс ----------
function migrateRepairPartsEtaAndAdvance() {
  const columns = db.prepare(`PRAGMA table_info(repair_records)`).all().map((c) => c.name);
  if (!columns.length) return;
  if (!columns.includes('parts_eta')) {
    db.exec(`ALTER TABLE repair_records ADD COLUMN parts_eta TEXT`);
    console.log('База данных обновлена: добавлен срок поставки запчастей.');
  }
  if (!columns.includes('advance')) {
    db.exec(`ALTER TABLE repair_records ADD COLUMN advance REAL NOT NULL DEFAULT 0`);
    console.log('База данных обновлена: добавлен аванс.');
  }
}
migrateRepairPartsEtaAndAdvance();

// ---------- Миграция: тег у клиентов ----------
function migrateClientTagColumn() {
  const columns = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name);
  if (!columns.includes('tag')) {
    db.exec(`ALTER TABLE clients ADD COLUMN tag TEXT`);
    console.log('База данных обновлена: добавлен тег клиента.');
  }
}
migrateClientTagColumn();

// ---------- Миграция: пробег авто ----------
function migrateMileageColumn() {
  for (const table of ['repair_records', 'queue_entries']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (columns.length && !columns.includes('mileage')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN mileage INTEGER`);
      console.log(`База данных обновлена: добавлен пробег авто (${table}).`);
    }
  }
}
migrateMileageColumn();

// ---------- Миграция: раздел у категории расходников ----------
function migrateConsumableCategorySectionColumn() {
  const columns = db.prepare(`PRAGMA table_info(consumable_categories)`).all().map((c) => c.name);
  if (columns.length && !columns.includes('section_id')) {
    db.exec(`ALTER TABLE consumable_categories ADD COLUMN section_id INTEGER REFERENCES consumable_sections(id) ON DELETE SET NULL`);
    console.log('База данных обновлена: добавлен раздел у категории расходников.');
  }
}
migrateConsumableCategorySectionColumn();

// ---------- Миграция: телефон в анкете клиента (кабинет по VIN) ----------
function migrateClientCarProfilePhoneColumn() {
  const columns = db.prepare(`PRAGMA table_info(client_car_profiles)`).all().map((c) => c.name);
  if (columns.length && !columns.includes('phone')) {
    db.exec(`ALTER TABLE client_car_profiles ADD COLUMN phone TEXT`);
    console.log('База данных обновлена: добавлен телефон в анкету клиента.');
  }
}
migrateClientCarProfilePhoneColumn();

// ---------- Миграция: имя в анкете клиента (кабинет по VIN) ----------
function migrateClientCarProfileNameColumn() {
  const columns = db.prepare(`PRAGMA table_info(client_car_profiles)`).all().map((c) => c.name);
  if (columns.length && !columns.includes('name')) {
    db.exec(`ALTER TABLE client_car_profiles ADD COLUMN name TEXT`);
    console.log('База данных обновлена: добавлено имя в анкету клиента.');
  }
}
migrateClientCarProfileNameColumn();

export default db;
