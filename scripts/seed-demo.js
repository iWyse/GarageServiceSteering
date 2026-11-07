// Демо-данные для показа и проверки вёрстки: клиенты, записи на текущую неделю,
// история ремонта, отчёт, очередь заказов, расходники и заметки.
// Все имена, телефоны, номера и VIN вымышленные.
//
//   node scripts/seed-demo.js           — заполнить пустую базу
//   node scripts/seed-demo.js --force   — добавить демо к уже имеющимся данным
//
// По умолчанию скрипт ничего не делает, если в базе уже есть клиенты —
// чтобы случайно не смешать демо с реальными данными.

import db from '../db.js';

const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
if (existing > 0 && !force) {
  console.error(`В базе уже есть клиенты (${existing}). Демо-данные не добавлены.`);
  console.error('Чтобы добавить их поверх имеющихся, запустите с флагом --force.');
  process.exit(1);
}

// ---------- даты: понедельник текущей недели и предыдущей ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monday = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  return d;
})();
const day = (weekOffset, dayIndex) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + weekOffset * 7 + dayIndex);
  return iso(d);
};

// ---------- клиенты ----------
const clients = [
  { name: 'Алексей Громов', phone: '+7 999 000 11 01', car_make: 'Toyota', car_model: 'Camry', plate: 'А101АА 154', vin: 'DEMO0CAMRY0000101', tag: 'Камри Алексей', notes: 'Постоянный клиент, обслуживается с 2022 года.' },
  { name: 'Марина Ветрова', phone: '+7 999 000 11 02', car_make: 'Honda', car_model: 'Accord', plate: 'В202ВВ 154', vin: 'DEMO0ACCORD000202', tag: 'Аккорд Марина', notes: '' },
  { name: 'Игорь Седов', phone: '+7 999 000 11 03', car_make: 'Toyota', car_model: 'Land Cruiser 100', plate: 'С303СС 154', vin: 'DEMO0LC100000303', tag: 'Крузак Игорь', notes: 'Просит звонить перед началом работ.' },
  { name: 'Ольга Перова', phone: '+7 999 000 11 04', car_make: 'Kia', car_model: 'Rio', plate: 'Е404ЕЕ 154', vin: 'DEMO0KIARIO000404', tag: 'Рио Ольга', notes: '' },
  { name: 'Денис Лавров', phone: '+7 999 000 11 05', car_make: 'Subaru', car_model: 'Forester', plate: 'К505КК 154', vin: 'DEMO0FORESTER0505', tag: 'Форик Денис', notes: 'Машина на газу (ГБО).' },
  { name: 'Сергей Мирный', phone: '+7 999 000 11 06', car_make: 'Nissan', car_model: 'X-Trail', plate: 'М606ММ 154', vin: 'DEMO0XTRAIL000606', tag: 'Икстрейл Сергей', notes: '' },
];
const insClient = db.prepare(
  `INSERT INTO clients (name, phone, car_make, car_model, plate, tag, vin, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const clientIds = clients.map((c) =>
  Number(insClient.run(c.name, c.phone, c.car_make, c.car_model, c.plate, c.tag, c.vin, c.notes).lastInsertRowid)
);

// ---------- записи в расписании (Пн–Сб текущей недели) ----------
const insAppt = db.prepare(
  `INSERT INTO appointments (client_id, walkin_name, walkin_phone, walkin_car, vin, date, time, service, status, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const appts = [
  // [клиент (индекс) или null, разовый {имя, телефон, авто}, день, время, услуга, статус, заметка]
  [0, null, 0, '09:00', 'Замена масла и фильтров', 'done', ''],
  [1, null, 0, '11:30', 'Диагностика подвески', 'done', 'Стук спереди справа'],
  [null, { name: 'Андрей', phone: '+7 999 000 22 01', car: 'Lada Vesta' }, 0, '15:00', 'Шиномонтаж', 'done', ''],
  [2, null, 1, '10:00', 'Замена ремня ГРМ', 'in_progress', 'Запчасти на складе'],
  [3, null, 1, '14:00', 'Замена тормозных колодок', 'planned', ''],
  [4, null, 2, '09:30', 'Регулировка клапанов', 'planned', ''],
  [null, { name: 'Виктор', phone: '+7 999 000 22 02', car: 'Hyundai Solaris' }, 2, '13:00', 'Компьютерная диагностика', 'planned', ''],
  [5, null, 3, '10:30', 'Замена масла в АКПП', 'planned', 'Масло клиента'],
  [0, null, 3, '16:00', 'Развал-схождение', 'planned', ''],
  [1, null, 4, '12:00', 'Замена свечей', 'planned', ''],
  [null, { name: 'Наталья', phone: '+7 999 000 22 03', car: 'Mazda 3' }, 5, '10:00', 'Консультация по ремонту', 'planned', ''],
  [3, null, 5, '12:30', 'Замена амортизаторов', 'cancelled', 'Клиент перенёс'],
];
for (const [ci, walkin, d, time, service, status, notes] of appts) {
  insAppt.run(
    ci === null ? null : clientIds[ci],
    walkin ? walkin.name : '',
    walkin ? walkin.phone : '',
    walkin ? walkin.car : '',
    '',
    day(0, d),
    time,
    service,
    status,
    notes
  );
}

// ---------- история ремонта (часть записей — в отчёте) ----------
const insRepair = db.prepare(
  `INSERT INTO repair_records (client_id, title, date, mileage, works, parts, parts_eta, advance, notes, master, in_report)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const repairs = [
  { c: 0, title: 'ТО: масло и фильтры', date: day(0, 0), mileage: 182400, master: 'Павел', inReport: 1,
    works: [{ name: 'Замена масла и масляного фильтра', price: 1200 }, { name: 'Замена воздушного фильтра', price: 400 }],
    parts: [{ name: 'Масло 5W-30, 4 л', price: 3600, qty: 1, brand: 'Toyota', article: '08880-83716', supplier: 'АТС', received: true },
            { name: 'Масляный фильтр', price: 650, qty: 1, brand: 'Toyota', article: '90915-YZZD4', supplier: 'АТС', received: true },
            { name: 'Воздушный фильтр', price: 900, qty: 1, brand: 'Vic', article: 'A-1011', supplier: 'Микадо', received: true }] },
  { c: 1, title: 'Диагностика подвески', date: day(0, 0), mileage: 96300, master: 'Дмитрий', inReport: 1,
    works: [{ name: 'Диагностика ходовой части', price: 800 }, { name: 'Замена стойки стабилизатора (2 шт.)', price: 1500 }],
    parts: [{ name: 'Стойка стабилизатора', price: 2400, qty: 2, brand: 'Febest', article: '0323-ACV', supplier: 'emex', received: true }] },
  { c: 2, title: 'Замена ремня ГРМ', date: day(0, 1), mileage: 311000, master: 'Павел', inReport: 0,
    works: [{ name: 'Замена ремня ГРМ с роликами и помпой', price: 9500 }],
    parts: [{ name: 'Комплект ГРМ', price: 14800, qty: 1, brand: 'Gates', article: 'K015569XS', supplier: 'ПЛ', received: true },
            { name: 'Помпа', price: 5200, qty: 1, brand: 'Aisin', article: 'WPT-052', supplier: 'ПЛ', received: true },
            { name: 'Антифриз, 5 л', price: 1800, qty: 1, brand: 'Toyota', article: '00272-LLC01', supplier: 'АТС', received: true }], advance: 10000 },
  { c: 4, title: 'Замена свечей и фильтров', date: day(-1, 3), mileage: 144800, master: 'Дмитрий', inReport: 1,
    works: [{ name: 'Замена свечей зажигания (4 шт.)', price: 1600 }, { name: 'Замена топливного фильтра', price: 900 }],
    parts: [{ name: 'Свеча зажигания', price: 3200, qty: 4, brand: 'NGK', article: 'ILFR6B', supplier: 'Микадо', received: true },
            { name: 'Топливный фильтр', price: 1100, qty: 1, brand: 'Subaru', article: '42072-AA050', supplier: 'АТС', received: true }] },
  { c: 3, title: 'Замена колодок и дисков', date: day(-1, 4), mileage: 78200, master: 'Павел', inReport: 1,
    works: [{ name: 'Замена передних колодок и дисков', price: 2800 }, { name: 'Прокачка тормозной системы', price: 1000 }],
    parts: [{ name: 'Колодки передние', price: 2300, qty: 1, brand: 'Kashiyama', article: 'D1092', supplier: 'emex', received: true },
            { name: 'Диск тормозной', price: 4400, qty: 2, brand: 'Brembo', article: '09.A532.11', supplier: 'emex', received: true },
            { name: 'Тормозная жидкость', price: 450, qty: 1, brand: 'ATE', article: '03.9901-5802.2', supplier: 'Микадо', received: true }] },
  { c: 5, title: 'Замена масла в вариаторе', date: day(-2, 2), mileage: 121500, master: 'Дмитрий', inReport: 0,
    works: [{ name: 'Замена масла в вариаторе (частичная)', price: 3500 }],
    parts: [{ name: 'Масло CVT NS-3, 4 л', price: 6400, qty: 1, brand: 'Nissan', article: 'KE909-99933', supplier: 'АТС', received: true },
            { name: 'Фильтр вариатора', price: 2100, qty: 1, brand: 'Nissan', article: '31728-1XF00', supplier: 'АТС', received: true,
              analogGroup: 'cvt-filter', analogSelected: true },
            { name: 'Фильтр вариатора (аналог)', price: 1500, qty: 1, brand: 'Jatco', article: 'JF011E-F', supplier: 'emex', received: false,
              analogGroup: 'cvt-filter', analogSelected: false }] },
];
for (const r of repairs) {
  insRepair.run(
    clientIds[r.c], r.title, r.date, r.mileage,
    JSON.stringify(r.works), JSON.stringify(r.parts),
    '', r.advance || 0, '', r.master, r.inReport
  );
}

// ---------- очередь заказов (клиенты, которым заказаны запчасти) ----------
const insQueue = db.prepare(
  `INSERT INTO queue_entries (name, phone, car_make, car_model, plate, vin, tag, status, title, date, mileage, works, parts, parts_eta, advance, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
insQueue.run(
  'Роман Шилов', '+7 999 000 33 01', 'Mazda', 'CX-5', 'Н707НН 154', 'DEMO0CX5000000707', 'CX-5 Роман', 'waiting',
  'Замена передних амортизаторов', day(0, 4), 67800,
  JSON.stringify([{ name: 'Замена передних амортизаторов', price: 4500 }]),
  JSON.stringify([{ name: 'Амортизатор передний', price: 7800, qty: 2, brand: 'KYB', article: '334523', supplier: 'emex', received: false },
                  { name: 'Опорный подшипник', price: 1900, qty: 2, brand: 'Mazda', article: 'KD35-34-380', supplier: 'АТС', received: true }]),
  'через 3 дня', 5000, ''
);
insQueue.run(
  'Татьяна Орлова', '+7 999 000 33 02', 'Skoda', 'Octavia', 'О808ОО 154', 'DEMO0OCTAVIA000808', 'Октавия Татьяна', 'arrived',
  'Замена сцепления', day(0, 5), 154000,
  JSON.stringify([{ name: 'Замена комплекта сцепления', price: 12000 }]),
  JSON.stringify([{ name: 'Комплект сцепления', price: 18500, qty: 1, brand: 'Sachs', article: '3000 950 029', supplier: 'ПЛ', received: true }]),
  '', 8000, ''
);

// ---------- расходники ----------
const insSection = db.prepare('INSERT INTO consumable_sections (name) VALUES (?)');
const insCategory = db.prepare('INSERT INTO consumable_categories (section_id, name) VALUES (?, ?)');
const insConsumable = db.prepare('INSERT INTO consumables (category_id, name, article, notes) VALUES (?, ?, ?, ?)');
const sec = (name) => Number(insSection.run(name).lastInsertRowid);
const cat = (sectionId, name) => Number(insCategory.run(sectionId, name).lastInsertRowid);

const oils = sec('Масла и жидкости');
const engineOil = cat(oils, 'Моторное масло');
insConsumable.run(engineOil, 'Масло 5W-30 синтетика, 4 л', 'DEMO-5W30-4', 'Для большинства бензиновых двигателей');
insConsumable.run(engineOil, 'Масло 5W-40 синтетика, 4 л', 'DEMO-5W40-4', '');
const coolant = cat(oils, 'Антифриз');
insConsumable.run(coolant, 'Антифриз G12, 5 л', 'DEMO-G12-5', 'Красный');

const filters = sec('Фильтры');
const oilFilters = cat(filters, 'Масляные фильтры');
insConsumable.run(oilFilters, 'Масляный фильтр универсальный', 'DEMO-OF-001', '');
const airFilters = cat(filters, 'Воздушные фильтры');
insConsumable.run(airFilters, 'Воздушный фильтр универсальный', 'DEMO-AF-001', '');

// ---------- личные заметки владельца ----------
const insNote = db.prepare('INSERT INTO staff_notes (text, tag) VALUES (?, ?)');
insNote.run('Заказать масло 5W-30 — остаётся две канистры.', 'закупка');
insNote.run('Проверить подъёмник на втором посту, жалуются на скрип.', 'гараж');

const total = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log('Демо-данные добавлены:');
console.log(`  клиентов: ${total('clients')}, записей: ${total('appointments')}, ремонтов: ${total('repair_records')}, заказов в очереди: ${total('queue_entries')}`);
console.log(`  расходников: ${total('consumables')}, заметок: ${total('staff_notes')}`);
