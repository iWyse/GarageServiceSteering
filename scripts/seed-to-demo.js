// Тестовые карточки для вкладки «ТО»: 8 вымышленных марок/моделей с названием и
// объёмом масла, артикулами фильтров и дополнительными расходниками.
// Все артикулы придуманы — для проверки вёрстки, поиска и быстрого заказ-наряда.
//
//   node scripts/seed-to-demo.js            — добавить тестовые карточки
//   node scripts/seed-to-demo.js --remove   — удалить только их (по пометке «[ТЕСТ]»)
//
// Реальные карточки скрипт не трогает: тестовые узнаются по пометке в примечании.
// Повторный запуск без --remove не создаёт дубликатов.

import db from '../db.js';

const MARK = '[ТЕСТ]';

if (process.argv.includes('--remove')) {
  const r = db.prepare(`DELETE FROM to_articles WHERE notes LIKE ?`).run(`${MARK}%`);
  console.log(`Удалено тестовых карточек ТО: ${r.changes}`);
  process.exit(0);
}

const extra = (...items) => JSON.stringify(items.map(([name, brand, article]) => ({ name, brand, article })));

const rows = [
  { make: 'Toyota', model: 'Camry XV70', tag: 'частая', oil: 'Mobil 1 ESP 5W-30', vol: '4,3 л', oilArt: 'DEMO-152558',
    of: ['Toyota', 'DEMO-90915-YZZE1'], af: ['Toyota', 'DEMO-17801-0V020'], cf: ['Toyota', 'DEMO-87139-YZZ10'],
    extra: extra(['Колодки передние', 'Brembo', 'DEMO-P83145']) },
  { make: 'Toyota', model: 'RAV4 XA50', tag: '', oil: 'Toyota 0W-20', vol: '4,4 л', oilArt: 'DEMO-08880-83885',
    of: ['Toyota', 'DEMO-04152-YZZA1'], af: ['Toyota', 'DEMO-17801-38051'], cf: ['Toyota', 'DEMO-87139-42030'], extra: '[]' },
  { make: 'Honda', model: 'CR-V RE', tag: '', oil: 'Honda Ultra 0W-20', vol: '4,2 л', oilArt: 'DEMO-08232-P99',
    of: ['Honda', 'DEMO-15400-PLM-A02'], af: ['Honda', 'DEMO-17220-RZA-Y00'], cf: ['Honda', 'DEMO-80292-SDG-W01'],
    extra: extra(['Свечи зажигания', 'NGK', 'DEMO-ZFR6K']) },
  { make: 'Nissan', model: 'X-Trail T32', tag: 'такси', oil: 'Castrol Edge 5W-40', vol: '5,0 л', oilArt: 'DEMO-15669E',
    of: ['Nissan', 'DEMO-15208-65F0E'], af: ['Nissan', 'DEMO-16546-4BA1A'], cf: ['Nissan', 'DEMO-27277-4CE0A'], extra: '[]' },
  { make: 'Kia', model: 'Rio QB', tag: '', oil: 'Shell Helix HX8 5W-30', vol: '3,6 л', oilArt: 'DEMO-550046358',
    of: ['Hyundai/Kia', 'DEMO-26300-35503'], af: ['Hyundai/Kia', 'DEMO-28113-1R100'], cf: ['Hyundai/Kia', 'DEMO-97133-1R000'],
    extra: extra(['Колодки задние', 'Sangsin', 'DEMO-SP1405'], ['Тормозная жидкость', 'Liqui Moly', 'DEMO-8832']) },
  { make: 'Volkswagen', model: 'Polo Sedan', tag: '', oil: 'Liqui Moly Leichtlauf 5W-40', vol: '3,8 л', oilArt: 'DEMO-2332',
    of: ['Mann', 'DEMO-W712/94'], af: ['Mann', 'DEMO-C2433'], cf: ['Mann', 'DEMO-CU2243'], extra: '[]' },
  { make: 'Mazda', model: '6 GJ', tag: 'частая', oil: 'Mazda Original 0W-20', vol: '4,5 л', oilArt: 'DEMO-0000-77-1801',
    of: ['Mazda', 'DEMO-PE01-14-302'], af: ['Mazda', 'DEMO-PE07-13-Z40'], cf: ['Mazda', 'DEMO-KD45-61-J6X'],
    extra: extra(['Свечи зажигания', 'Denso', 'DEMO-SK20HR11']) },
  { make: 'Lada', model: 'Vesta', tag: '', oil: 'Лукойл Genesis 5W-40', vol: '3,5 л', oilArt: 'DEMO-3148675',
    of: ['Lada', 'DEMO-8450100227'], af: ['Lada', 'DEMO-8450100226'], cf: ['Lada', 'DEMO-8450100228'], extra: '[]' },
];

const find = db.prepare(`SELECT 1 FROM to_articles WHERE notes LIKE ? AND car_make = ? AND car_model = ?`);
const insert = db.prepare(
  `INSERT INTO to_articles
     (car_make, car_model, tag, oil_spec, oil_volume, oil_article,
      oil_filter_brand, oil_filter_article, air_filter_brand, air_filter_article,
      cabin_filter_brand, cabin_filter_article, extra_items, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let added = 0;
for (const r of rows) {
  if (find.get(`${MARK}%`, r.make, r.model)) continue;
  insert.run(r.make, r.model, r.tag, r.oil, r.vol, r.oilArt, r.of[0], r.of[1], r.af[0], r.af[1], r.cf[0], r.cf[1],
    r.extra, `${MARK} Тестовая карточка, артикулы выдуманные. Удалить все тестовые: npm run seed:to -- --remove`);
  added++;
}
console.log(`Добавлено тестовых карточек ТО: ${added} (всего тестовых: ${rows.length}).`);
