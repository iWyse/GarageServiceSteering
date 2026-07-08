const DAYS_IN_WEEK = 6; // рабочая неделя: Пн–Сб, воскресенье не показываем
const DOW_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const STATUS_LABEL = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Готово',
  cancelled: 'Отменено',
};

const state = {
  clients: [],
  weekStart: startOfWeek(new Date()),
  appointments: [],
};

// ---------- Utils ----------
function pad(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fmtDayLabel(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}
function fmtWeekRange(start) {
  const end = addDays(start, DAYS_IN_WEEK - 1); // суббота
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} ${start.getFullYear()} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') showLogin();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

// ---------- Авторизация ----------
// Один пользователь — владелец автосервиса. Пока сессии нет, всё API отдаёт
// 401 (см. server.js), поэтому просто прячем приложение и показываем форму входа.
const loginOverlay = document.getElementById('loginOverlay');
const appRoot = document.getElementById('appRoot');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

function showLogin() {
  appRoot.classList.add('hidden');
  loginOverlay.classList.remove('hidden');
}

function showApp() {
  loginOverlay.classList.add('hidden');
  appRoot.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify(data) });
    loginForm.reset();
    showApp();
    await bootApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (err) {
    // сессии всё равно больше нет смысла — показываем форму входа в любом случае
  }
  showLogin();
});

// ---------- Маска телефона ----------
// Клиенты — российские номера, поэтому номер, начинающийся на 7/8/9, приводим
// к виду +7 928 280 88 50 (8 и голый мобильный код 9XX считаем тем же +7).
// Всё остальное группируем по 2 цифры — простой паттерн для прочих номеров,
// не привязанный к длине конкретного кода страны.
function formatPhoneMask(raw) {
  let digits = raw.replace(/\D/g, '');

  if (/^[789]/.test(digits)) {
    digits = (digits[0] === '9' ? '7' + digits : '7' + digits.slice(1)).slice(0, 11);
    const parts = [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7, 9), digits.slice(9, 11)]
      .filter(Boolean);
    return '+' + parts.join(' ');
  }

  if (digits.length > 15) digits = digits.slice(0, 15);
  const hasPlus = raw.trim().startsWith('+');
  const groups = digits.match(/.{1,2}/g) || [];
  const joined = groups.join(' ');
  return hasPlus ? '+' + joined : joined;
}

function attachPhoneMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatPhoneMask(input.value);
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  });
}

attachPhoneMask(document.getElementById('clientPhoneInput'));
attachPhoneMask(document.getElementById('walkinPhoneInput'));
attachPhoneMask(document.getElementById('loginPhoneInput'));

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const target = btn.dataset.tab;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${target}`).classList.add('active');
  });
});

// ---------- Dialog helpers ----------
function openDialog(el) { el.classList.remove('hidden'); }
function closeDialog(el) { el.classList.add('hidden'); }
document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => closeDialog(btn.closest('.dialog-overlay')));
});
document.querySelectorAll('.dialog-overlay').forEach((ov) => {
  if (ov.id === 'loginOverlay') return; // форму входа нельзя закрыть кликом мимо
  ov.addEventListener('click', (e) => { if (e.target === ov) closeDialog(ov); });
});

// ================= CLIENTS =================
const clientDialog = document.getElementById('clientDialog');
const clientForm = document.getElementById('clientForm');
const deleteClientBtn = document.getElementById('deleteClientBtn');
let editingClientId = null;

async function loadClients() {
  state.clients = await api('/api/clients');
  renderClients();
  fillClientSelect();
}

function renderClients() {
  const q = document.getElementById('clientSearch').value.trim().toLowerCase();
  const body = document.getElementById('clientsBody');
  const filtered = state.clients.filter((c) => {
    if (!q) return true;
    return [c.name, c.phone, c.plate, c.car_make, c.car_model].join(' ').toLowerCase().includes(q);
  });
  body.innerHTML = '';
  document.getElementById('clientsEmpty').classList.toggle('hidden', state.clients.length !== 0);

  filtered.forEach((c) => {
    const tr = document.createElement('tr');
    const telHref = (c.phone || '').replace(/[^\d+]/g, '');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(c.name)}</td>
      <td>${c.phone ? `<a class="cell-phone" href="tel:${escapeHtml(telHref)}">${escapeHtml(c.phone)}</a>` : '—'}</td>
      <td>${escapeHtml([c.car_make, c.car_model].filter(Boolean).join(' ') || '—')}</td>
      <td class="cell-plate">${escapeHtml(c.plate || '—')}</td>
      <td class="cell-plate">${escapeHtml(c.vin || '—')}</td>
      <td class="cell-notes">${escapeHtml(c.notes || '')}</td>
      <td class="edit-hint">изменить →</td>
    `;
    const phoneLink = tr.querySelector('.cell-phone');
    if (phoneLink) phoneLink.addEventListener('click', (e) => e.stopPropagation());
    tr.addEventListener('click', () => openClientDialog(c));
    body.appendChild(tr);
  });
}

function openClientDialog(client) {
  editingClientId = client ? client.id : null;
  document.getElementById('clientDialogTitle').textContent = client ? 'Клиент' : 'Новый клиент';
  deleteClientBtn.classList.toggle('hidden', !client);

  const callLink = document.getElementById('clientCallLink');
  const phone = client ? (client.phone || '') : '';
  if (phone) {
    callLink.href = 'tel:' + phone.replace(/[^\d+]/g, '');
    callLink.classList.remove('hidden');
  } else {
    callLink.classList.add('hidden');
  }

  clientForm.reset();
  if (client) {
    for (const [k, v] of Object.entries(client)) {
      if (clientForm.elements[k]) clientForm.elements[k].value = v || '';
    }
  }

  // Вкладка с историей ремонта имеет смысл только для клиента, который уже есть в базе —
  // у нового клиента (ещё не сохранён) истории по определению нет.
  setClientTab('info');
  document.getElementById('clientDialogTabs').classList.toggle('hidden', !client);
  historyClientId = client ? client.id : null;
  if (client) loadClientHistory(client.id);

  openDialog(clientDialog);
}

function setClientTab(tab) {
  document.querySelectorAll('#clientDialogTabs .ctab').forEach((b) => {
    b.classList.toggle('active', b.dataset.ctab === tab);
  });
  clientForm.classList.toggle('hidden', tab !== 'info');
  document.getElementById('clientHistoryPanel').classList.toggle('hidden', tab !== 'history');
}

document.querySelectorAll('#clientDialogTabs .ctab').forEach((btn) => {
  btn.addEventListener('click', () => setClientTab(btn.dataset.ctab));
});

function fmtFullDate(d) {
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtMoney(n) {
  return `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

function sumItems(items) {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
}

// Артикул/фирма/количество показываем только если заполнены — пустые поля
// не должны засорять ни карточку истории, ни заказ-наряд.
function itemMeta(it) {
  const parts = [];
  if (it.article) parts.push(`арт. ${it.article}`);
  if (it.brand) parts.push(it.brand);
  if (it.qty && it.qty !== 1) parts.push(`×${it.qty}`);
  return parts.join(', ');
}

async function loadClientHistory(clientId) {
  historyClientId = clientId;
  const list = document.getElementById('clientHistoryList');
  const empty = document.getElementById('clientHistoryEmpty');
  list.innerHTML = '';
  let records;
  try {
    records = await api(`/api/clients/${clientId}/repairs`);
  } catch (err) {
    showToast('Не удалось загрузить историю: ' + err.message, true);
    return;
  }
  empty.classList.toggle('hidden', records.length !== 0);
  records.forEach((r) => {
    const worksSum = sumItems(r.works);
    const partsSum = sumItems(r.parts);
    const advance = Number(r.advance) || 0;
    const total = Math.max(0, worksSum + partsSum - advance);
    const dateObj = new Date(r.date + 'T00:00:00');
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head">
        <span class="${r.title ? 'history-title' : 'history-date'}">${r.title ? escapeHtml(r.title) : fmtFullDate(dateObj)}</span>
        <strong class="history-total">${fmtMoney(total)}</strong>
      </div>
      ${r.title ? `<span class="history-date">${fmtFullDate(dateObj)}</span>` : ''}
      ${renderRepairBlock('Работы', r.works, worksSum)}
      ${renderRepairBlock('Запчасти', r.parts, partsSum)}
      ${r.parts_eta ? `<div class="repair-list-sum"><span>Срок поставки запчастей</span><span>${escapeHtml(r.parts_eta)}</span></div>` : ''}
      ${advance > 0 ? `<div class="repair-list-sum"><span>Аванс</span><span>− ${fmtMoney(advance)}</span></div>` : ''}
      ${r.notes ? `<div class="history-notes">${escapeHtml(r.notes)}</div>` : ''}
    `;
    item.addEventListener('click', () => openRepairDialog(r));
    list.appendChild(item);
  });
}

function renderRepairBlock(label, items, sum) {
  if (!items.length) return '';
  const lines = items
    .map((it) => {
      const meta = itemMeta(it);
      const lineTotal = (Number(it.price) || 0) * (Number(it.qty) || 1);
      return `<div class="repair-list-line"><span>${escapeHtml(it.name)}${meta ? ` <span class="repair-list-meta">(${escapeHtml(meta)})</span>` : ''}</span><span>${fmtMoney(lineTotal)}</span></div>`;
    })
    .join('');
  return `
    <div class="repair-list-block">
      <span class="repair-list-label">${label}</span>
      ${lines}
      <div class="repair-list-sum"><span>Сумма: ${label.toLowerCase()}</span><span>${fmtMoney(sum)}</span></div>
    </div>
  `;
}

document.getElementById('newRepairBtn').addEventListener('click', () => openRepairDialog(null));

document.getElementById('newClientBtn').addEventListener('click', () => openClientDialog(null));
document.getElementById('clientSearch').addEventListener('input', renderClients);

clientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(clientForm).entries());
  try {
    if (editingClientId) {
      await api(`/api/clients/${editingClientId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Клиент обновлён');
    } else {
      await api('/api/clients', { method: 'POST', body: JSON.stringify(data) });
      showToast('Клиент добавлен');
    }
    closeDialog(clientDialog);
    await loadClients();
    await loadWeek();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteClientBtn.addEventListener('click', async () => {
  if (!editingClientId) return;
  if (!confirm('Удалить клиента? Связанные записи тоже будут удалены.')) return;
  try {
    await api(`/api/clients/${editingClientId}`, { method: 'DELETE' });
    showToast('Клиент удалён');
    closeDialog(clientDialog);
    await loadClients();
    await loadWeek();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ================= REPAIR HISTORY =================
const repairDialog = document.getElementById('repairDialog');
const repairForm = document.getElementById('repairForm');
const deleteRepairBtn = document.getElementById('deleteRepairBtn');
const worksRowsEl = document.getElementById('worksRows');
const partsRowsEl = document.getElementById('partsRows');
const estimatePickerDialog = document.getElementById('estimatePickerDialog');
const orderDialog = document.getElementById('orderDialog');
let editingRepairId = null;
let historyClientId = null;
let pendingApptForRepair = null; // смета создаётся из записи расписания, а не из карточки клиента
let advanceEnabled = false;

function sumRowInputs(container) {
  return Array.from(container.querySelectorAll('.repair-row')).reduce((sum, row) => {
    const price = Number(row.querySelector('.row-price')?.value) || 0;
    const qtyInput = row.querySelector('.row-qty');
    const qty = qtyInput ? (Number(qtyInput.value) || 0) : 1;
    return sum + price * qty;
  }, 0);
}

function recomputeRepairSums() {
  const worksSum = sumRowInputs(worksRowsEl);
  const partsSum = sumRowInputs(partsRowsEl);
  const advance = advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0;
  document.getElementById('worksSum').textContent = fmtMoney(worksSum);
  document.getElementById('partsSum').textContent = fmtMoney(partsSum);
  document.getElementById('advanceRow').classList.toggle('hidden', advance <= 0);
  document.getElementById('advanceDisplay').textContent = '− ' + fmtMoney(advance);
  document.getElementById('repairTotal').textContent = fmtMoney(Math.max(0, worksSum + partsSum - advance));
}

// isPart добавляет поля "Фирма" и "Кол-во" — они нужны только для запчастей,
// выполненные работы остаются простой парой название/цена.
function createRepairRow(item, isPart) {
  const row = document.createElement('div');
  row.className = 'repair-row' + (isPart ? ' repair-row-part' : '');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'row-name';
  nameInput.placeholder = 'Название';
  nameInput.value = item?.name || '';

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.className = 'row-price mono-input';
  priceInput.placeholder = 'Цена';
  priceInput.min = '0';
  priceInput.step = '0.01';
  priceInput.value = item?.price ?? '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'row-remove';
  removeBtn.setAttribute('aria-label', 'Удалить строку');
  removeBtn.textContent = '×';

  priceInput.addEventListener('input', recomputeRepairSums);
  removeBtn.addEventListener('click', () => { row.remove(); recomputeRepairSums(); });

  if (isPart) {
    const articleInput = document.createElement('input');
    articleInput.type = 'text';
    articleInput.className = 'row-article mono-input';
    articleInput.placeholder = 'Артикул';
    articleInput.value = item?.article || '';

    const brandInput = document.createElement('input');
    brandInput.type = 'text';
    brandInput.className = 'row-brand';
    brandInput.placeholder = 'Фирма';
    brandInput.value = item?.brand || '';

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'row-qty mono-input';
    qtyInput.placeholder = 'Кол-во';
    qtyInput.min = '0';
    qtyInput.step = '1';
    qtyInput.value = item?.qty ?? 1;
    qtyInput.addEventListener('input', recomputeRepairSums);

    const line1 = document.createElement('div');
    line1.className = 'repair-row-line1';
    line1.append(nameInput, removeBtn);

    const line2 = document.createElement('div');
    line2.className = 'repair-row-line2';
    line2.append(articleInput, brandInput, qtyInput, priceInput);

    row.append(line1, line2);
  } else {
    row.append(nameInput, priceInput, removeBtn);
  }

  return row;
}

function addRepairRow(container, item, isPart) {
  container.appendChild(createRepairRow(item, isPart));
}

function collectRepairRows(container) {
  return Array.from(container.querySelectorAll('.repair-row'))
    .map((row) => {
      const out = {
        name: row.querySelector('.row-name').value.trim(),
        price: Number(row.querySelector('.row-price').value) || 0,
      };
      const articleInput = row.querySelector('.row-article');
      const brandInput = row.querySelector('.row-brand');
      const qtyInput = row.querySelector('.row-qty');
      if (articleInput) out.article = articleInput.value.trim();
      if (brandInput) out.brand = brandInput.value.trim();
      if (qtyInput) out.qty = Number(qtyInput.value) || 0;
      return out;
    })
    .filter((it) => it.name || it.price);
}

document.getElementById('addWorkRowBtn').addEventListener('click', () => addRepairRow(worksRowsEl, null));
document.getElementById('addPartRowBtn').addEventListener('click', () => addRepairRow(partsRowsEl, null, true));

document.getElementById('advanceToggleBtn').addEventListener('click', () => {
  advanceEnabled = !advanceEnabled;
  document.getElementById('advanceToggleBtn').classList.toggle('active', advanceEnabled);
  document.getElementById('advanceAmountWrap').classList.toggle('hidden', !advanceEnabled);
  if (!advanceEnabled) document.getElementById('advanceAmountInput').value = '';
  recomputeRepairSums();
});
document.getElementById('advanceAmountInput').addEventListener('input', recomputeRepairSums);

function openRepairDialog(record) {
  editingRepairId = record ? record.id : null;
  pendingApptForRepair = null; // по умолчанию — обычный поток из карточки клиента
  document.getElementById('repairDialogTitle').textContent = record ? 'Запись ремонта' : 'Новая запись ремонта';
  deleteRepairBtn.classList.toggle('hidden', !record);
  repairForm.reset();

  worksRowsEl.innerHTML = '';
  partsRowsEl.innerHTML = '';
  const works = record?.works?.length ? record.works : [null];
  const parts = record?.parts?.length ? record.parts : [null];
  works.forEach((w) => addRepairRow(worksRowsEl, w));
  parts.forEach((p) => addRepairRow(partsRowsEl, p, true));

  repairForm.elements.title.value = record ? (record.title || '') : '';
  repairForm.elements.date.value = record ? record.date : toISODate(new Date());
  repairForm.elements.parts_eta.value = record ? (record.parts_eta || '') : '';
  repairForm.elements.notes.value = record ? (record.notes || '') : '';

  advanceEnabled = !!(record && Number(record.advance) > 0);
  document.getElementById('advanceToggleBtn').classList.toggle('active', advanceEnabled);
  document.getElementById('advanceAmountWrap').classList.toggle('hidden', !advanceEnabled);
  document.getElementById('advanceAmountInput').value = advanceEnabled ? record.advance : '';

  recomputeRepairSums();
  openDialog(repairDialog);
}

// Смета, открытая из карточки записи в расписании: клиент по этой записи может
// как быть в базе, так и быть разовым визитом — во втором случае клиента
// придётся создать автоматически при сохранении сметы (см. resolveClientForAppt).
// clientId передаём, если клиент уже найден по имени (см. openEstimatePicker) —
// тогда при сохранении просто привяжем запись к нему, а не создадим нового.
// record — если владелец выбрал существующий ремонт из пикера, чтобы дополнить его.
function openEstimateDialogFromAppt(appt, clientId, record) {
  openRepairDialog(record || null);
  pendingApptForRepair = { appt, clientId: clientId || null };
  if (!record) {
    document.getElementById('repairDialogTitle').textContent = 'Смета';
    repairForm.elements.title.value = appt.service || '';
  }
}

// Клик на кнопку "Смета": ищем клиента по имени записи — если он уже в базе
// и у него есть история ремонта, предлагаем дополнить один из существующих
// ремонтов вместо того, чтобы вслепую создавать новую запись.
async function openEstimatePicker(appt) {
  const name = (appt.client_name || '').trim().toLowerCase();
  const match = name ? state.clients.find((c) => c.name.trim().toLowerCase() === name) : null;

  if (!match) {
    openEstimateDialogFromAppt(appt, null);
    return;
  }

  let repairs = [];
  try {
    repairs = await api(`/api/clients/${match.id}/repairs`);
  } catch (err) {
    repairs = [];
  }

  if (!repairs.length) {
    openEstimateDialogFromAppt(appt, match.id);
    return;
  }

  document.getElementById('estimatePickerHint').textContent =
    `Клиент «${match.name}» уже есть в базе. Выберите ремонт, чтобы дополнить его, или создайте новый.`;
  const list = document.getElementById('estimatePickerList');
  list.innerHTML = '';
  repairs.forEach((r) => {
    const total = sumItems(r.works) + sumItems(r.parts);
    const dateObj = new Date(r.date + 'T00:00:00');
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head">
        <span class="${r.title ? 'history-title' : 'history-date'}">${r.title ? escapeHtml(r.title) : fmtFullDate(dateObj)}</span>
        <strong class="history-total">${fmtMoney(total)}</strong>
      </div>
      ${r.title ? `<span class="history-date">${fmtFullDate(dateObj)}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      closeDialog(estimatePickerDialog);
      openEstimateDialogFromAppt(appt, match.id, r);
    });
    list.appendChild(item);
  });

  document.getElementById('estimatePickerNewBtn').onclick = () => {
    closeDialog(estimatePickerDialog);
    openEstimateDialogFromAppt(appt, match.id);
  };

  openDialog(estimatePickerDialog);
}

async function resolveClientForAppt(pending) {
  const { appt, clientId } = pending;
  if (clientId) {
    if (appt.client_id !== clientId) {
      await api(`/api/appointments/${appt.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...appt, client_id: clientId }),
      });
      await loadClients();
    }
    return clientId;
  }

  const newClient = await api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({
      name: appt.walkin_name || 'Клиент без имени',
      phone: appt.walkin_phone || '',
      car_make: appt.walkin_car || '', // в разовом визите марка/модель одной строкой, не разбираем на части
      vin: appt.vin || '',
      notes: 'Добавлено автоматически из записи в расписании.',
    }),
  });

  // Привязываем запись расписания к новому клиенту, чтобы она перестала быть "разовой".
  await api(`/api/appointments/${appt.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...appt, client_id: newClient.id }),
  });
  await loadClients();
  return newClient.id;
}

repairForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    title: repairForm.elements.title.value,
    date: repairForm.elements.date.value,
    notes: repairForm.elements.notes.value,
    parts_eta: repairForm.elements.parts_eta.value,
    advance: advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0,
    works: collectRepairRows(worksRowsEl),
    parts: collectRepairRows(partsRowsEl),
  };
  try {
    if (editingRepairId) {
      await api(`/api/repairs/${editingRepairId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Запись ремонта обновлена');
      closeDialog(repairDialog);
      if (pendingApptForRepair) {
        await resolveClientForAppt(pendingApptForRepair);
        pendingApptForRepair = null;
        closeDialog(apptDialog);
        await loadWeek();
      } else {
        await loadClientHistory(historyClientId);
      }
    } else if (pendingApptForRepair) {
      const clientId = await resolveClientForAppt(pendingApptForRepair);
      await api(`/api/clients/${clientId}/repairs`, { method: 'POST', body: JSON.stringify(data) });
      pendingApptForRepair = null;
      showToast('Смета добавлена в историю ремонта');
      closeDialog(repairDialog);
      closeDialog(apptDialog);
      await loadWeek();
    } else {
      await api(`/api/clients/${historyClientId}/repairs`, { method: 'POST', body: JSON.stringify(data) });
      showToast('Запись ремонта добавлена');
      closeDialog(repairDialog);
      await loadClientHistory(historyClientId);
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteRepairBtn.addEventListener('click', async () => {
  if (!editingRepairId) return;
  if (!confirm('Удалить запись ремонта?')) return;
  try {
    await api(`/api/repairs/${editingRepairId}`, { method: 'DELETE' });
    showToast('Запись ремонта удалена');
    closeDialog(repairDialog);
    await loadClientHistory(historyClientId);
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Заказ-наряд (предпросмотр и отправка клиенту) ----------
// pendingApptForRepair приоритетнее historyClientId: если смета открыта из
// расписания, historyClientId может остаться от предыдущего открытия карточки клиента.
function getRepairOrderContext() {
  if (pendingApptForRepair) {
    const appt = pendingApptForRepair.appt;
    const carLine = appt.client_id
      ? [appt.car_make, appt.car_model].filter(Boolean).join(' ')
      : (appt.walkin_car || '');
    return { clientName: appt.client_name || '', carLine };
  }
  if (historyClientId) {
    const client = state.clients.find((c) => c.id === historyClientId);
    if (client) return { clientName: client.name, carLine: [client.car_make, client.car_model].filter(Boolean).join(' ') };
  }
  return { clientName: '', carLine: '' };
}

function buildOrderData() {
  const ctx = getRepairOrderContext();
  const works = collectRepairRows(worksRowsEl);
  const parts = collectRepairRows(partsRowsEl);
  const worksSum = sumItems(works);
  const partsSum = sumItems(parts);
  const advance = advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0;
  return {
    clientName: ctx.clientName,
    carLine: ctx.carLine,
    partsEta: repairForm.elements.parts_eta.value,
    title: repairForm.elements.title.value,
    date: repairForm.elements.date.value,
    notes: repairForm.elements.notes.value,
    works,
    parts,
    worksSum,
    partsSum,
    advance,
    total: Math.max(0, worksSum + partsSum - advance),
  };
}

function buildOrderHtml(order) {
  const workLines = order.works
    .map((w) => `<div class="order-line"><span>${escapeHtml(w.name)}</span><span>${fmtMoney(w.price)}</span></div>`)
    .join('');
  const partLines = order.parts
    .map((p) => {
      const meta = itemMeta(p);
      const lineTotal = (Number(p.price) || 0) * (Number(p.qty) || 1);
      return `<div class="order-line"><span>${escapeHtml(p.name)}${meta ? ` <span class="order-line-meta">(${escapeHtml(meta)})</span>` : ''}</span><span>${fmtMoney(lineTotal)}</span></div>`;
    })
    .join('');

  return `
    <div class="order-meta">
      ${order.clientName ? `<div class="order-meta-row"><span>Клиент</span><strong>${escapeHtml(order.clientName)}</strong></div>` : ''}
      ${order.carLine ? `<div class="order-meta-row"><span>Марка автомобиля</span><strong>${escapeHtml(order.carLine)}</strong></div>` : ''}
      ${order.partsEta ? `<div class="order-meta-row"><span>Срок поставки запчастей</span><strong>${escapeHtml(order.partsEta)}</strong></div>` : ''}
    </div>
    <div class="order-sep"></div>
    ${order.title ? `<h3 class="order-title">${escapeHtml(order.title)}</h3>` : ''}
    ${order.date ? `<div class="order-date">${fmtFullDate(new Date(order.date + 'T00:00:00'))}</div>` : ''}
    ${order.works.length ? `<div class="order-block"><div class="order-block-title">Работы</div>${workLines}<div class="order-line order-line-sum"><span>Сумма работ</span><span>${fmtMoney(order.worksSum)}</span></div></div>` : ''}
    ${order.parts.length ? `<div class="order-block"><div class="order-block-title">Запчасти</div>${partLines}<div class="order-line order-line-sum"><span>Сумма запчастей</span><span>${fmtMoney(order.partsSum)}</span></div></div>` : ''}
    ${order.advance > 0 ? `<div class="order-line order-line-advance"><span>Аванс</span><span>− ${fmtMoney(order.advance)}</span></div>` : ''}
    <div class="order-total"><span>Итого к оплате</span><span>${fmtMoney(order.total)}</span></div>
    ${order.notes ? `<div class="order-notes">${escapeHtml(order.notes)}</div>` : ''}
  `;
}

// Кнопка открывает предпросмотр заказ-наряда для скриншота — на мобильных
// он растягивается на весь экран (см. media-query в style.css), отправки
// из приложения нет: снимок отправляют клиенту вручную, чем удобно.
document.getElementById('sendToClientBtn').addEventListener('click', () => {
  const order = buildOrderData();
  document.getElementById('orderContent').innerHTML = buildOrderHtml(order);
  openDialog(orderDialog);
});

function fillClientSelect() {
  const sel = document.getElementById('apptClientSelect');
  const options = state.clients
    .map((c) => {
      const car = [c.car_make, c.car_model].filter(Boolean).join(' ');
      return `<option value="${c.id}">${escapeHtml(c.name)}${car ? ' — ' + escapeHtml(car) : ''}</option>`;
    })
    .join('');
  sel.innerHTML = `<option value="">— Разовый визит (без базы) —</option>${options}`;
}

function toggleWalkinFields() {
  const sel = document.getElementById('apptClientSelect');
  const walkinBlock = document.getElementById('walkinFields');
  const isWalkin = sel.value === '';
  walkinBlock.classList.toggle('hidden', !isWalkin);
  apptForm.elements.walkin_name.required = isWalkin;
}
document.getElementById('apptClientSelect').addEventListener('change', toggleWalkinFields);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ================= SCHEDULE =================
const apptDialog = document.getElementById('apptDialog');
const apptForm = document.getElementById('apptForm');
const deleteApptBtn = document.getElementById('deleteApptBtn');
const apptEstimateBtn = document.getElementById('apptEstimateBtn');
let editingApptId = null;
let currentApptRecord = null;

let weekRequestSeq = 0;

async function loadWeek() {
  const mySeq = ++weekRequestSeq;
  const weekStart = state.weekStart; // фиксируем неделю, на которую отправлен запрос
  const start = toISODate(weekStart);
  const end = toISODate(addDays(weekStart, DAYS_IN_WEEK - 1));

  let appts;
  try {
    appts = await api(`/api/appointments?start=${start}&end=${end}`);
  } catch (err) {
    if (mySeq === weekRequestSeq) showToast('Не удалось загрузить записи: ' + err.message, true);
    return;
  }

  // Пока запрос летел, пользователь мог кликнуть "вперёд/назад" ещё раз —
  // тогда этот ответ уже устарел, и применять его нельзя (иначе заголовок
  // и колонки недели рассинхронизируются).
  if (mySeq !== weekRequestSeq) return;

  state.appointments = appts;
  document.getElementById('weekRange').textContent = fmtWeekRange(weekStart);
  renderWeek(weekStart);
}

function renderWeek(weekStart) {
  const grid = document.getElementById('weekGrid');
  grid.innerHTML = '';
  const todayISO = toISODate(new Date());

  for (let i = 0; i < DAYS_IN_WEEK; i++) {
    const day = addDays(weekStart, i);
    const iso = toISODate(day);
    const col = document.createElement('div');
    col.className = 'day-col' + (iso === todayISO ? ' is-today' : '');

    const head = document.createElement('div');
    head.className = 'day-head';
    head.innerHTML = `<span class="dow">${DOW_ORDER[i]}</span><span class="dnum">${fmtDayLabel(day)}</span>`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'day-body';
    body.dataset.date = iso;

    const dayAppts = state.appointments.filter((a) => a.date === iso).sort((a, b) => a.time.localeCompare(b.time));
    dayAppts.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'appt-card';
      card.dataset.status = a.status;
      card.draggable = true;
      // для клиента из базы показываем марку/модель авто, для разового визита — то, что вписали вручную
      const carLine = a.client_id
        ? [a.car_make, a.car_model].filter(Boolean).join(' ')
        : (a.walkin_car || '');
      const vin = a.vin || '';
      const statusOrService = a.service || (a.status ? STATUS_LABEL[a.status] : '');
      const phone = a.client_phone || '';
      const telHref = phone.replace(/[^\d+]/g, '');
      card.innerHTML = `
        <div class="appt-time">${a.time}</div>
        <div class="appt-client">${escapeHtml(a.client_name)}</div>
        ${phone ? `<a class="appt-phone" href="tel:${escapeHtml(telHref)}">${escapeHtml(phone)}</a>` : ''}
        ${statusOrService ? `<div class="appt-service">${escapeHtml(statusOrService)}</div>` : ''}
        ${carLine ? `<span class="appt-plate">${escapeHtml(carLine)}</span>` : ''}
        ${vin ? `<div class="appt-vin">VIN ${escapeHtml(vin)}</div>` : ''}
      `;
      const phoneLink = card.querySelector('.appt-phone');
      if (phoneLink) phoneLink.addEventListener('click', (e) => e.stopPropagation());
      card.addEventListener('click', () => openApptDialog(a, iso));
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(a.id));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      body.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-appt-btn';
    addBtn.textContent = '+ запись';
    addBtn.addEventListener('click', () => openApptDialog(null, iso));
    body.appendChild(addBtn);

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const apptId = Number(e.dataTransfer.getData('text/plain'));
      const appt = state.appointments.find((a) => a.id === apptId);
      if (!appt || appt.date === iso) return;
      await moveAppointment(appt, iso);
    });

    col.appendChild(body);
    grid.appendChild(col);
  }
}

async function moveAppointment(appt, newDate) {
  try {
    await api(`/api/appointments/${appt.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...appt, date: newDate }),
    });
    showToast('Запись перенесена на ' + fmtDayLabel(new Date(newDate + 'T00:00:00')));
    await loadWeek();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openApptDialog(appt, defaultDate) {
  editingApptId = appt ? appt.id : null;
  currentApptRecord = appt;
  document.getElementById('apptDialogTitle').textContent = appt ? 'Запись' : 'Новая запись';
  deleteApptBtn.classList.toggle('hidden', !appt);
  apptEstimateBtn.classList.toggle('hidden', !appt);

  const callLink = document.getElementById('apptCallLink');
  const phone = appt ? (appt.client_phone || '') : '';
  if (phone) {
    callLink.href = 'tel:' + phone.replace(/[^\d+]/g, '');
    callLink.classList.remove('hidden');
  } else {
    callLink.classList.add('hidden');
  }

  apptForm.reset();
  fillClientSelect();
  if (appt) {
    for (const [k, v] of Object.entries(appt)) {
      if (apptForm.elements[k]) apptForm.elements[k].value = v || '';
    }
    apptForm.elements.client_id.value = appt.client_id || '';
  } else {
    apptForm.elements.date.value = defaultDate;
    apptForm.elements.time.value = '09:00';
  }
  toggleWalkinFields();

  // Для уже существующей записи прячем поля даты/времени/VIN/услуги/статуса/заметок
  // за кнопкой "Редактировать", чтобы окно не пугало кучей полей при простом просмотре.
  const detailsFields = document.getElementById('apptDetailsFields');
  const summary = document.getElementById('apptSummary');
  if (appt) {
    fillApptSummary(appt);
    summary.classList.remove('hidden');
    detailsFields.classList.add('hidden');
  } else {
    summary.classList.add('hidden');
    detailsFields.classList.remove('hidden');
  }

  openDialog(apptDialog);
}

function fillApptSummary(appt) {
  const dateObj = new Date(appt.date + 'T00:00:00');
  document.getElementById('summaryDateTime').textContent = `${fmtDayLabel(dateObj)} в ${appt.time}`;

  const serviceRow = document.getElementById('summaryServiceRow');
  if (appt.service) {
    document.getElementById('summaryService').textContent = appt.service;
    serviceRow.classList.remove('hidden');
  } else {
    serviceRow.classList.add('hidden');
  }

  const statusRow = document.getElementById('summaryStatusRow');
  if (appt.status) {
    document.getElementById('summaryStatus').textContent = STATUS_LABEL[appt.status] || appt.status;
    statusRow.classList.remove('hidden');
  } else {
    statusRow.classList.add('hidden');
  }

  const vinRow = document.getElementById('summaryVinRow');
  if (appt.vin) {
    document.getElementById('summaryVin').textContent = appt.vin;
    vinRow.classList.remove('hidden');
  } else {
    vinRow.classList.add('hidden');
  }

  const notesRow = document.getElementById('summaryNotesRow');
  if (appt.notes) {
    document.getElementById('summaryNotes').textContent = appt.notes;
    notesRow.classList.remove('hidden');
  } else {
    notesRow.classList.add('hidden');
  }
}

document.getElementById('editApptDetailsBtn').addEventListener('click', () => {
  document.getElementById('apptSummary').classList.add('hidden');
  document.getElementById('apptDetailsFields').classList.remove('hidden');
});

apptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(apptForm).entries());
  try {
    if (editingApptId) {
      await api(`/api/appointments/${editingApptId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Запись обновлена');
    } else {
      await api('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
      showToast('Запись создана');
    }
    closeDialog(apptDialog);
    await loadWeek();
  } catch (err) {
    showToast(err.message, true);
  }
});

apptEstimateBtn.addEventListener('click', () => {
  if (!currentApptRecord) return;
  openEstimatePicker(currentApptRecord);
});

deleteApptBtn.addEventListener('click', async () => {
  if (!editingApptId) return;
  if (!confirm('Удалить запись?')) return;
  try {
    await api(`/api/appointments/${editingApptId}`, { method: 'DELETE' });
    showToast('Запись удалена');
    closeDialog(apptDialog);
    await loadWeek();
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('prevWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); loadWeek(); });
document.getElementById('nextWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); loadWeek(); });
document.getElementById('todayBtn').addEventListener('click', () => { state.weekStart = startOfWeek(new Date()); loadWeek(); });

// ---------- Init ----------
async function bootApp() {
  try {
    await loadClients();
    await loadWeek();
  } catch (err) {
    showToast('Не удалось загрузить данные: ' + err.message, true);
  }
}

(async function initAuth() {
  try {
    const { authenticated } = await api('/api/session');
    if (authenticated) {
      showApp();
      await bootApp();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
})();
