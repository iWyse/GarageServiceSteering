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
  if (res.status === 401) {
    if (path === '/api/login' || path === '/api/client-login') {
      // Неверный логин/пароль — просто покажем ошибку в форме, экран входа не трогаем.
    } else if (path.startsWith('/api/client/')) {
      showLogin('client');
    } else {
      showLogin('owner');
    }
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

// ---------- Авторизация ----------
// Два независимых входа: владелец (телефон+пароль, видит всё приложение) и
// клиент (по VIN своей машины, видит только свой кабинет). Пока сессии нет,
// соответствующее API отдаёт 401 (см. server.js) — прячем приложение и
// показываем экран входа с нужной вкладкой.
const loginOverlay = document.getElementById('loginOverlay');
const appRoot = document.getElementById('appRoot');
const clientRoot = document.getElementById('clientRoot');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const clientLoginForm = document.getElementById('clientLoginForm');
const clientLoginError = document.getElementById('clientLoginError');
const clientPasswordLabel = document.getElementById('clientPasswordLabel');

function setLoginMode(mode) {
  document.querySelectorAll('.login-mode-btn').forEach((b) => {
    const active = b.dataset.loginMode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  loginForm.classList.toggle('hidden', mode !== 'owner');
  clientLoginForm.classList.toggle('hidden', mode !== 'client');
}

document.querySelectorAll('.login-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setLoginMode(btn.dataset.loginMode));
});

function showLogin(mode) {
  appRoot.classList.add('hidden');
  clientRoot.classList.add('hidden');
  loginOverlay.classList.remove('hidden');
  if (mode) setLoginMode(mode);
}

function showApp() {
  loginOverlay.classList.add('hidden');
  clientRoot.classList.add('hidden');
  appRoot.classList.remove('hidden');
}

function showClientApp() {
  loginOverlay.classList.add('hidden');
  appRoot.classList.add('hidden');
  clientRoot.classList.remove('hidden');
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

clientLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clientLoginError.classList.add('hidden');
  // Поле пароля лежит в DOM скрытым до первой попытки — браузер иногда всё
  // равно подставляет туда сохранённый пароль автозаполнением. Отправляем
  // пароль, только если шаг с паролем реально показан пользователю, иначе
  // невидимый автозаполненный мусор ломает вход даже по известному VIN.
  const passwordShown = !clientPasswordLabel.classList.contains('hidden');
  const data = {
    vin: document.getElementById('clientVinInput').value,
    password: passwordShown ? document.getElementById('clientPasswordInput').value : '',
  };
  try {
    const result = await api('/api/client-login', { method: 'POST', body: JSON.stringify(data) });
    if (result.needPassword) {
      clientPasswordLabel.classList.remove('hidden');
      document.getElementById('clientPasswordInput').focus();
      return;
    }
    clientLoginForm.reset();
    clientPasswordLabel.classList.add('hidden');
    showClientApp();
    await bootClientApp();
  } catch (err) {
    clientLoginError.textContent = err.message;
    clientLoginError.classList.remove('hidden');
  }
});

document.getElementById('clientLogoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/client-logout', { method: 'POST' });
  } catch (err) {
    // сессии всё равно больше нет смысла — показываем форму входа в любом случае
  }
  showLogin('client');
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (err) {
    // сессии всё равно больше нет смысла — показываем форму входа в любом случае
  }
  showLogin('owner');
});

// ---------- Маска телефона ----------
// Клиенты — российские номера. Строго цифры, без пробелов и разделителей,
// всегда с кодом +7 (8 и голый мобильный код 9XX приводим к тому же +7).
function formatPhoneMask(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits[0] === '8') digits = digits.slice(1);
  else if (digits[0] === '7') digits = digits.slice(1);
  digits = digits.slice(0, 10);
  return digits ? '+7' + digits : '';
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
attachPhoneMask(document.getElementById('queuePhoneInput'));
attachPhoneMask(document.getElementById('clientCarPhoneInput'));
// Логин — просто цифры без пробелов, без маски: так быстрее вводить и меньше шансов
// промахнуться курсором при наборе на телефоне.

// ---------- Маска марки/модели авто ----------
// Только английские буквы (плюс пробел/дефис для составных названий вроде
// "Land Rover", "Mercedes-Benz"), первая буква слова — заглавная, остальные
// строчные; всё остальное (кириллица, цифры, прочие символы) отбрасывается.
function formatCarWordMask(raw) {
  const cleaned = raw.replace(/[^a-zA-Z\s-]/g, '').toLowerCase();
  return cleaned.replace(/(^|[\s-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function attachCarWordMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatCarWordMask(input.value);
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  });
}

document.querySelectorAll('input[name="car_make"], input[name="car_model"]').forEach(attachCarWordMask);

// ---------- Маска гос. номера ----------
// Формат: буква-цифра-цифра-цифра-буква-буква-цифра-цифра-цифра (Л ДДД ЛЛ ДДД).
// Буквы — только из набора, разрешённого ГОСТом (визуально совпадают с
// латиницей на знаке): А В Е К М Н О Р С Т У Х. Латинские "двойники"
// (A B E K M H O P C T Y X) при вводе автоматически заменяются на кириллические.
// Каждый символ засчитывается только на "своей" позиции по порядку — так
// нельзя случайно вставить цифру туда, где должна быть буква, и наоборот.
const PLATE_LATIN_TO_CYRILLIC = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const PLATE_ALLOWED_LETTERS = 'АВЕКМНОРСТУХ';
const PLATE_PATTERN = ['letter', 'digit', 'digit', 'digit', 'letter', 'letter', 'digit', 'digit', 'digit'];

function formatPlateMask(raw) {
  let out = '';
  let pos = 0;
  for (const ch of raw.toUpperCase()) {
    if (pos >= PLATE_PATTERN.length) break;
    if (PLATE_PATTERN[pos] === 'digit') {
      if (/[0-9]/.test(ch)) { out += ch; pos++; }
    } else {
      const mapped = PLATE_LATIN_TO_CYRILLIC[ch] || ch;
      if (PLATE_ALLOWED_LETTERS.includes(mapped)) { out += mapped; pos++; }
    }
  }
  return out;
}

function attachPlateMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatPlateMask(input.value);
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  });
}

document.querySelectorAll('input[name="plate"]').forEach(attachPlateMask);

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const target = btn.dataset.tab;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${target}`).classList.add('active');
    if (target === 'requests') loadRequests();
  });
});

// ---------- Dialog helpers ----------
// Иначе на телефоне скролл внутри открытого диалога прокручивает сайт под
// ним, а не содержимое самого диалога. Класс снимаем только когда закрыт
// последний диалог — иначе confirm поверх другого окна преждевременно
// разблокирует прокрутку фона.
function openDialog(el) {
  el.classList.remove('hidden');
  document.body.classList.add('dialog-open');
}
function closeDialog(el) {
  el.classList.add('hidden');
  if (!document.querySelector('.dialog-overlay:not(.hidden)')) {
    document.body.classList.remove('dialog-open');
  }
}
document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => closeDialog(btn.closest('.dialog-overlay')));
});

// ---------- Confirm dialog (замена стандартного window.confirm — не вписывается
// в тёмную тему и не стилизуется браузером) ----------
const confirmDialog = document.getElementById('confirmDialog');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');

function showConfirm(message, { confirmLabel = 'Удалить', danger = true } = {}) {
  return new Promise((resolve) => {
    confirmMessageEl.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmOkBtn.className = danger ? 'btn-danger' : 'btn-primary';

    function cleanup(result) {
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      confirmDialog.removeEventListener('click', onBackdrop);
      closeDialog(confirmDialog);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === confirmDialog) cleanup(false); }

    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);
    confirmDialog.addEventListener('click', onBackdrop);
    openDialog(confirmDialog);
  });
}

document.querySelectorAll('.dialog-overlay').forEach((ov) => {
  if (ov.id === 'loginOverlay' || ov.id === 'confirmDialog') return; // форму входа нельзя закрыть кликом мимо, confirm управляет собой сам
  // Клик мимо часто случается случайно, а окна теперь большие (заказ, смета) —
  // подтверждаем, чтобы не терять несохранённые данные одним неловким кликом.
  ov.addEventListener('click', async (e) => {
    if (e.target !== ov) return;
    if (await showConfirm('Закрыть окно? Несохранённые изменения будут потеряны.', { confirmLabel: 'Закрыть', danger: false })) closeDialog(ov);
  });
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

const EDIT_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/>
  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

async function copyVinToClipboard(vin) {
  try {
    await navigator.clipboard.writeText(vin);
    showToast('VIN скопирован');
  } catch {
    showToast('Не удалось скопировать VIN', true);
  }
}

async function copyArticleToClipboard(article) {
  try {
    await navigator.clipboard.writeText(article);
    showToast('Артикул скопирован');
  } catch {
    showToast('Не удалось скопировать артикул', true);
  }
}

function renderClients() {
  const q = document.getElementById('clientSearch').value.trim().toLowerCase();
  const body = document.getElementById('clientsBody');
  const filtered = state.clients.filter((c) => {
    if (!q) return true;
    return [c.name, c.phone, c.plate, c.tag, c.car_make, c.car_model].join(' ').toLowerCase().includes(q);
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
      <td class="cell-tag">${escapeHtml(c.tag || '—')}</td>
      <td class="cell-plate">${c.vin ? `<span class="cell-vin">${escapeHtml(c.vin)}<button type="button" class="vin-copy-btn" title="Копировать VIN">${COPY_ICON_SVG}</button></span>` : '—'}</td>
      <td class="cell-notes">${escapeHtml(c.notes || '')}</td>
      <td class="edit-hint">${EDIT_ICON_SVG}</td>
    `;
    const phoneLink = tr.querySelector('.cell-phone');
    if (phoneLink) phoneLink.addEventListener('click', (e) => e.stopPropagation());
    const vinCopyBtn = tr.querySelector('.vin-copy-btn');
    if (vinCopyBtn) {
      vinCopyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyVinToClipboard(c.vin);
      });
    }
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
  autoResizeTextarea(clientForm.elements.notes);

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

// created_at из sqlite приходит как "YYYY-MM-DD HH:MM:SS" в UTC без указания зоны —
// добавляем T/Z, чтобы Date распознал её как UTC и показал в локальном времени клиента.
function fmtDateTime(sqliteStr) {
  const d = new Date(sqliteStr.replace(' ', 'T') + 'Z');
  return `${fmtFullDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMoney(n) {
  // Неразрывный пробел перед ₽ — иначе в узких строках (например, в объёмной
  // смете) значок рубля переносится на следующую строку от суммы.
  return `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

function fmtMileage(n) {
  return `${Number(n).toLocaleString('ru-RU')} км`;
}

function sumItems(items) {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
}

// Артикул/фирма/количество показываем только если заполнены — пустые поля
// не должны засорять ни карточку истории, ни заказ-наряд. includeArticle
// выключается в истории ремонта, где артикул выводится отдельно, со своей
// кнопкой копирования (см. renderRepairBlock).
function itemMeta(it, includeArticle = true) {
  const parts = [];
  if (includeArticle && it.article) parts.push(`арт. ${it.article}`);
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
      ${r.mileage ? `<div class="repair-list-sum"><span>Пробег</span><span>${fmtMileage(r.mileage)}</span></div>` : ''}
      ${renderRepairBlock('Работы', r.works, worksSum, 'Сумма работ:')}
      ${renderRepairBlock('Запчасти', r.parts, partsSum, 'Сумма запчастей')}
      ${r.parts_eta ? `<div class="repair-list-sum"><span>Срок поставки запчастей</span><span>${escapeHtml(r.parts_eta)}</span></div>` : ''}
      ${advance > 0 ? `<div class="repair-list-sum"><span>Аванс</span><span>− ${fmtMoney(advance)}</span></div>` : ''}
      ${r.notes ? `<div class="history-notes">${escapeHtml(r.notes)}</div>` : ''}
    `;
    item.querySelectorAll('.article-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyArticleToClipboard(btn.dataset.article);
      });
    });
    item.addEventListener('click', () => openRepairDialog(r));
    list.appendChild(item);
  });
}

function renderRepairBlock(label, items, sum, sumLabel) {
  if (!items.length) return '';
  const lines = items
    .map((it) => {
      const meta = itemMeta(it, false);
      const lineTotal = Number(it.price) || 0;
      const articleHtml = it.article
        ? `<div class="repair-list-article">арт. <span class="mono">${escapeHtml(it.article)}</span><button type="button" class="article-copy-btn" data-article="${escapeHtml(it.article)}" title="Копировать артикул">${COPY_ICON_SVG}</button></div>`
        : '';
      return `<div class="repair-list-line"><span>${escapeHtml(it.name)}${meta ? ` <span class="repair-list-meta">(${escapeHtml(meta)})</span>` : ''}</span><span>${fmtMoney(lineTotal)}</span></div>${articleHtml}`;
    })
    .join('');
  return `
    <div class="repair-list-block">
      <span class="repair-list-label">${label}</span>
      ${lines}
      <div class="repair-list-sum repair-list-sum-accent"><span>${sumLabel}</span><span>${fmtMoney(sum)}</span></div>
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
    await loadRequests();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteClientBtn.addEventListener('click', async () => {
  if (!editingClientId) return;
  if (!(await showConfirm('Удалить клиента? Связанные записи тоже будут удалены.'))) return;
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
    return sum + price;
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

// isPart добавляет поля "Артикул"/"Фирма"/"Кол-во" — они нужны только для запчастей,
// выполненные работы остаются простой парой название/цена. onChange даёт переиспользовать
// строки в другом диалоге (очередь) со своим пересчётом сумм. withReceived добавляет
// переключатель "пришла"/"нет" — нужен только в заказе (очередь на запчасти), чтобы
// отслеживать, что из заказа уже привезли, а что ещё в пути.
function createRepairRow(item, isPart, onChange = recomputeRepairSums, withReceived = false) {
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
  removeBtn.tabIndex = -1;
  removeBtn.textContent = '×';

  priceInput.addEventListener('input', onChange);
  removeBtn.addEventListener('click', () => { row.remove(); onChange(); });

  if (isPart) {
    const articleInput = document.createElement('input');
    articleInput.type = 'text';
    articleInput.className = 'row-article mono-input';
    articleInput.placeholder = 'Артикул';
    articleInput.tabIndex = -1;
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
    qtyInput.value = item?.qty ?? '';
    qtyInput.addEventListener('input', onChange);

    const line1 = document.createElement('div');
    line1.className = 'repair-row-line1';

    if (withReceived) {
      const receivedBtn = document.createElement('button');
      receivedBtn.type = 'button';
      receivedBtn.className = 'row-received-btn';
      const setReceivedState = (received) => {
        receivedBtn.classList.toggle('active', received);
        receivedBtn.textContent = received ? 'На складе ✓' : 'На складе?';
        receivedBtn.dataset.received = received ? '1' : '';
      };
      setReceivedState(!!item?.received);
      receivedBtn.addEventListener('click', () => setReceivedState(!receivedBtn.classList.contains('active')));
      line1.append(nameInput, receivedBtn, removeBtn);
    } else {
      line1.append(nameInput, removeBtn);
    }

    const line2 = document.createElement('div');
    line2.className = 'repair-row-line2';
    // Название уже в line1, дальше по порядку: цена, кол-во, фирма, артикул.
    line2.append(priceInput, qtyInput, brandInput, articleInput);

    // Поставщик — только для запчастей в заказе (см. withReceived), в смете/истории
    // ремонта эта информация не нужна и нигде больше не отображается.
    if (withReceived) {
      const supplierSelect = document.createElement('select');
      supplierSelect.className = 'row-supplier mono-input';
      supplierSelect.innerHTML = `
        <option value="">Поставщик</option>
        <option value="АТС">АТС</option>
        <option value="ПЛ">ПЛ</option>
        <option value="emex">emex</option>
        <option value="Микадо">Микадо</option>
      `;
      supplierSelect.value = item?.supplier || '';
      line2.append(supplierSelect);
    }

    row.append(line1, line2);
  } else {
    row.append(nameInput, priceInput, removeBtn);
  }

  return row;
}

function addRepairRow(container, item, isPart, onChange = recomputeRepairSums, withReceived = false) {
  container.appendChild(createRepairRow(item, isPart, onChange, withReceived));
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
      const receivedBtn = row.querySelector('.row-received-btn');
      const supplierSelect = row.querySelector('.row-supplier');
      if (articleInput) out.article = articleInput.value.trim();
      if (brandInput) out.brand = brandInput.value.trim();
      if (qtyInput) out.qty = Number(qtyInput.value) || 0;
      if (receivedBtn) out.received = receivedBtn.classList.contains('active');
      if (supplierSelect) out.supplier = supplierSelect.value;
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
  repairForm.elements.mileage.value = record && record.mileage ? record.mileage : '';
  repairForm.elements.parts_eta.value = record ? (record.parts_eta || '') : 'до 5 рабочих дней';
  repairForm.elements.notes.value = record ? (record.notes || '') : '';
  autoResizeTextarea(repairForm.elements.notes);

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
    mileage: repairForm.elements.mileage.value,
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
  if (!(await showConfirm('Удалить запись ремонта?'))) return;
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
    mileage: repairForm.elements.mileage.value,
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
      const lineTotal = Number(p.price) || 0;
      return `<div class="order-line"><span>${escapeHtml(p.name)}${meta ? ` <span class="order-line-meta">(${escapeHtml(meta)})</span>` : ''}</span><span>${fmtMoney(lineTotal)}</span></div>`;
    })
    .join('');

  return `
    <div class="order-brand">
      <div class="order-brand-name">ГУРсервис</div>
      <div class="order-brand-address">ул. Хворостянского 20, ГСК 75А</div>
    </div>
    <div class="order-meta">
      ${order.clientName ? `<div class="order-meta-row"><span>Клиент</span><strong>${escapeHtml(order.clientName)}</strong></div>` : ''}
      ${order.carLine ? `<div class="order-meta-row"><span>Автомобиль</span><strong>${escapeHtml(order.carLine)}</strong></div>` : ''}
      ${order.mileage ? `<div class="order-meta-row"><span>Пробег</span><strong>${fmtMileage(order.mileage)}</strong></div>` : ''}
    </div>
    <div class="order-sep"></div>
    ${order.title ? `<h3 class="order-title">${escapeHtml(order.title)}</h3>` : ''}
    ${order.date ? `<div class="order-date">${fmtFullDate(new Date(order.date + 'T00:00:00'))}</div>` : ''}
    ${order.works.length ? `<div class="order-block"><div class="order-block-title">Работы</div>${workLines}<div class="order-line order-line-sum"><span>Сумма работ</span><span>${fmtMoney(order.worksSum)}</span></div></div>` : ''}
    ${order.parts.length ? `<div class="order-block"><div class="order-block-title">Запчасти</div>${partLines}<div class="order-line order-line-sum"><span>Сумма запчастей</span><span>${fmtMoney(order.partsSum)}</span></div>${order.partsEta ? `<div class="order-meta-row"><span>Срок поставки запчастей</span><strong>${escapeHtml(order.partsEta)}</strong></div>` : ''}</div>` : ''}
    ${order.advance > 0 ? `<div class="order-line order-line-advance"><span>Аванс</span><span>− ${fmtMoney(order.advance)}</span></div>` : ''}
    <div class="order-total"><span>Итого к оплате</span><span>${fmtMoney(order.total)}</span></div>
    ${order.notes ? `<div class="order-block"><div class="order-block-title">Рекомендации</div>${order.notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<div class="order-line"><span>${escapeHtml(line)}</span></div>`)
      .join('')}</div>` : ''}
  `;
}

// Кнопка открывает предпросмотр заказ-наряда для скриншота — на мобильных
// он растягивается на весь экран (см. media-query в style.css). Плюс кнопка
// "Копировать картинку" ниже — рисует то же самое в PNG и кладёт в буфер
// обмена, чтобы сразу вставить в мессенджер, не полагаясь на системный скриншот.
let currentOrderData = null;

document.getElementById('sendToClientBtn').addEventListener('click', () => {
  const order = buildOrderData();
  currentOrderData = order;
  document.getElementById('orderContent').innerHTML = buildOrderHtml(order);
  openDialog(orderDialog);
});

// ---------- Скачать заказ-наряд как PNG ----------
// Рисуем сразу на <canvas> (без SVG/foreignObject): Chromium "пачкает" canvas
// при экспорте картинки, нарисованной через foreignObject, даже без внешних
// ресурсов — toDataURL/toBlob после этого падают с "Tainted canvases may not
// be exported". Прямая отрисовка текста/фигур такому ограничению не подвержена,
// и заодно позволяет использовать реальные шрифты сайта (fillText их видит).
const ORDER_IMG = {
  width: 600,
  pad: 28,
  colors: {
    bg: '#242220',
    surface2: '#2c2925',
    text: '#ede9e1',
    textMuted: '#a39c8e',
    accent: '#e8a33d',
    border: '#3b362e',
    danger: '#b4483f',
  },
  fontDisplay: 'Oswald, sans-serif',
  fontBody: 'Inter, sans-serif',
  fontMono: '"JetBrains Mono", monospace',
};

function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderOrderToCanvas() {
  const order = currentOrderData;
  if (!order) throw new Error('Нет данных заказ-наряда');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const { width, pad, colors: C } = ORDER_IMG;
  const contentW = width - pad * 2;
  const scale = 2; // рисуем крупнее, чтобы текст не был мыльным при пересылке
  const maxHeight = 4000;

  const draft = document.createElement('canvas');
  draft.width = width * scale;
  draft.height = maxHeight * scale;
  const ctx = draft.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, maxHeight);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, width, 4);

  let y = 4 + 26;

  function row(label, value, lead = 22) {
    ctx.font = `600 15px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.textMuted;
    ctx.textAlign = 'left';
    ctx.fillText(label, pad, y);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(value, width - pad, y);
    ctx.textAlign = 'left';
    y += lead;
  }
  function dashedDivider() {
    ctx.strokeStyle = C.border;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 18;
  }

  ctx.font = `600 21px ${ORDER_IMG.fontDisplay}`;
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.fillText('ГУРСЕРВИС', width / 2, y);
  y += 24;
  ctx.font = `14px ${ORDER_IMG.fontBody}`;
  ctx.fillStyle = C.textMuted;
  ctx.fillText('ул. Хворостянского 20, ГСК 75А', width / 2, y);
  ctx.textAlign = 'left';
  y += 22;

  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 24;

  if (order.clientName) row('Клиент', order.clientName);
  if (order.carLine) row('Автомобиль', order.carLine);
  if (order.mileage) row('Пробег', fmtMileage(order.mileage));
  y += 16;

  if (order.title) {
    ctx.font = `600 18px ${ORDER_IMG.fontDisplay}`;
    ctx.fillStyle = C.text;
    ctx.fillText(order.title.toUpperCase(), pad, y);
    y += 26;
  }
  if (order.date) {
    ctx.font = `14px ${ORDER_IMG.fontMono}`;
    ctx.fillStyle = C.accent;
    ctx.fillText(fmtFullDate(new Date(order.date + 'T00:00:00')), pad, y);
    y += 24;
  }

  function block(title, items, sumLabel) {
    if (!items.length) return;
    y += 20;
    ctx.font = `13px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText(title.toUpperCase(), pad, y);
    y += 26;

    let sum = 0;
    items.forEach((it) => {
      const meta = itemMeta(it);
      const lineTotal = Number(it.price) || 0;
      sum += lineTotal;
      const priceText = fmtMoney(lineTotal);

      ctx.font = `600 16px ${ORDER_IMG.fontBody}`;
      const priceW = ctx.measureText(priceText).width;
      const availW = contentW - priceW - 12;
      const nameW = ctx.measureText(it.name).width;
      const metaText = meta ? ` (${meta})` : '';
      ctx.font = `14px ${ORDER_IMG.fontBody}`;
      const metaW = meta ? ctx.measureText(metaText).width : 0;

      if (!meta || nameW + metaW <= availW) {
        // Помещается в одну строку целиком — рисуем название и мету рядом
        // (как в HTML-версии наряда), а не отдельной строкой ниже.
        ctx.font = `600 16px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = C.text;
        ctx.textAlign = 'left';
        ctx.fillText(it.name, pad, y);
        if (meta) {
          ctx.font = `14px ${ORDER_IMG.fontBody}`;
          ctx.fillStyle = C.textMuted;
          ctx.fillText(metaText, pad + nameW, y);
        }
        // Иначе цена наследует приглушённый цвет меты, нарисованной строчкой
        // выше, и запчасти с "(мета)" оказываются другого цвета, чем работы.
        ctx.font = `600 16px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = C.text;
        ctx.textAlign = 'right';
        ctx.fillText(priceText, width - pad, y);
        ctx.textAlign = 'left';
        y += 20;
      } else {
        // Не влезает целиком — переносим название, мету оставляем отдельной строкой.
        ctx.font = `600 16px ${ORDER_IMG.fontBody}`;
        const nameLines = wrapCanvasText(ctx, it.name, availW);
        ctx.fillStyle = C.text;
        ctx.textAlign = 'left';
        ctx.fillText(nameLines[0], pad, y);
        ctx.textAlign = 'right';
        ctx.fillText(priceText, width - pad, y);
        ctx.textAlign = 'left';
        y += 20;
        for (let i = 1; i < nameLines.length; i++) {
          ctx.fillText(nameLines[i], pad, y);
          y += 20;
        }
        ctx.font = `14px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = C.textMuted;
        ctx.fillText(meta, pad, y);
        y += 19;
      }
    });

    dashedDivider();
    ctx.font = `600 18px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'left';
    ctx.fillText(sumLabel, pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(sum), width - pad, y);
    ctx.textAlign = 'left';
    y += 24;
  }

  block('Работы', order.works, 'Сумма работ:');
  block('Запчасти', order.parts, 'Сумма запчастей');
  if (order.partsEta && order.parts.length) row('Срок поставки запчастей', order.partsEta);

  if (order.advance > 0) {
    ctx.font = `15px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.danger;
    ctx.textAlign = 'left';
    ctx.fillText('Аванс', pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(`− ${fmtMoney(order.advance)}`, width - pad, y);
    ctx.textAlign = 'left';
    y += 26;
  }

  y += 4;
  const totalBoxH = 42;
  ctx.fillStyle = C.surface2;
  roundRectPath(ctx, pad, y, contentW, totalBoxH, 4);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();
  ctx.font = `600 18px ${ORDER_IMG.fontDisplay}`;
  ctx.fillStyle = C.text;
  ctx.textAlign = 'left';
  ctx.fillText('ИТОГО К ОПЛАТЕ', pad + 14, y + totalBoxH / 2 + 6);
  ctx.textAlign = 'right';
  ctx.fillText(fmtMoney(order.total), width - pad - 14, y + totalBoxH / 2 + 6);
  ctx.textAlign = 'left';
  y += totalBoxH + 20;

  const recLines = order.notes
    ? order.notes.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  if (recLines.length) {
    y += 8;
    ctx.font = `13px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.textMuted;
    ctx.fillText('РЕКОМЕНДАЦИИ', pad, y);
    y += 20;
    ctx.font = `15px ${ORDER_IMG.fontBody}`;
    ctx.fillStyle = C.text;
    recLines.forEach((line) => {
      wrapCanvasText(ctx, line, contentW).forEach((wrapped) => {
        ctx.fillText(wrapped, pad, y);
        y += 20;
      });
    });
  }

  y += 20;

  const finalCanvas = document.createElement('canvas');
  const finalHeightPx = Math.ceil(y);
  finalCanvas.width = width * scale;
  finalCanvas.height = finalHeightPx * scale;
  const fctx = finalCanvas.getContext('2d');
  fctx.drawImage(draft, 0, 0, width * scale, finalHeightPx * scale, 0, 0, width * scale, finalHeightPx * scale);
  return finalCanvas;
}

function downloadOrderImage(blob) {
  const link = document.createElement('a');
  link.download = 'zakaz-naryad.png';
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

document.getElementById('orderDownloadBtn').addEventListener('click', async () => {
  try {
    const canvas = await renderOrderToCanvas();
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('Не удалось подготовить изображение', true);
        return;
      }
      // В буфер обмена — самый быстрый путь переслать заказ-наряд в мессенджер.
      // Если браузер не поддерживает копирование картинок (ClipboardItem недоступен
      // или страница не в защищённом контексте) — откатываемся на скачивание файла.
      if (window.ClipboardItem && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('Картинка скопирована в буфер обмена');
          return;
        } catch (err) {
          // падаем в скачивание ниже
        }
      }
      downloadOrderImage(blob);
      showToast('Буфер обмена недоступен — картинка сохранена файлом', true);
    }, 'image/png');
  } catch (err) {
    showToast('Не удалось подготовить изображение', true);
  }
});

// ================= QUEUE (клиенты в очереди на запчасти) =================
// Отдельная от "Клиенты" сущность: те же поля клиента + смета (работы/запчасти),
// пока запчасти не пришли и человек ещё не оформлен как настоящий клиент.
const queueDialog = document.getElementById('queueDialog');
const queueForm = document.getElementById('queueForm');
const deleteQueueBtn = document.getElementById('deleteQueueBtn');
const queueWorksRowsEl = document.getElementById('queueWorksRows');
const queuePartsRowsEl = document.getElementById('queuePartsRows');
let queueItems = [];
let editingQueueId = null;
let queueAdvanceEnabled = false;

async function loadQueue() {
  queueItems = await api('/api/queue');
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById('queueList');
  const empty = document.getElementById('queueEmpty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', queueItems.length !== 0);

  queueItems.forEach((q) => {
    const carLine = [q.car_make, q.car_model].filter(Boolean).join(' ');
    const partsWithName = (q.parts || []).filter((p) => p.name);
    // Пока в заказе есть хоть одна запчасть, статус считаем по отметкам "пришла" на них,
    // а не по ручному переключателю — так бейдж всегда отражает реальную картину.
    const autoStatus = partsWithName.length > 0;
    const allReceived = autoStatus && partsWithName.every((p) => p.received);
    const status = autoStatus ? (allReceived ? 'arrived' : 'waiting') : (q.status === 'arrived' ? 'arrived' : 'waiting');
    const formatPart = (p) => (p.supplier ? `${p.name} (${p.supplier})` : p.name);
    const receivedNames = partsWithName.filter((p) => p.received).map(formatPart);
    const pendingNames = partsWithName.filter((p) => !p.received).map(formatPart);
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.innerHTML = `
      <div class="queue-item-head">
        <span class="queue-item-name">${escapeHtml(q.name)}</span>
        <button type="button" class="queue-status-badge" data-status="${status}"${autoStatus ? ' disabled title="Определяется автоматически по отметкам «на складе» у запчастей"' : ''}>${status === 'arrived' ? 'Запчасти пришли' : 'В ожидании'}</button>
      </div>
      ${carLine ? `<div class="queue-item-car">${escapeHtml(carLine)}</div>` : ''}
      ${q.title ? `<div class="queue-item-title">${escapeHtml(q.title)}</div>` : ''}
      ${receivedNames.length ? `<div class="queue-parts-received">На складе: ${escapeHtml(receivedNames.join(', '))}</div>` : ''}
      ${pendingNames.length ? `<div class="queue-parts-pending">Ожидаем: ${escapeHtml(pendingNames.join(', '))}</div>` : ''}
    `;
    if (!autoStatus) {
      item.querySelector('.queue-status-badge').addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextStatus = status === 'arrived' ? 'waiting' : 'arrived';
        try {
          await api(`/api/queue/${q.id}`, { method: 'PUT', body: JSON.stringify({ ...q, status: nextStatus }) });
          await loadQueue();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
    item.addEventListener('click', () => openQueueDialog(q));
    list.appendChild(item);
  });
}

function recomputeQueueSums() {
  const worksSum = sumRowInputs(queueWorksRowsEl);
  const partsSum = sumRowInputs(queuePartsRowsEl);
  const advance = queueAdvanceEnabled ? (Number(document.getElementById('queueAdvanceAmountInput').value) || 0) : 0;
  document.getElementById('queueWorksSum').textContent = fmtMoney(worksSum);
  document.getElementById('queuePartsSum').textContent = fmtMoney(partsSum);
  document.getElementById('queueAdvanceRow').classList.toggle('hidden', advance <= 0);
  document.getElementById('queueAdvanceDisplay').textContent = '− ' + fmtMoney(advance);
  document.getElementById('queueRepairTotal').textContent = fmtMoney(Math.max(0, worksSum + partsSum - advance));
}

document.getElementById('queueAddWorkRowBtn').addEventListener('click', () => addRepairRow(queueWorksRowsEl, null, false, recomputeQueueSums));
document.getElementById('queueAddPartRowBtn').addEventListener('click', () => addRepairRow(queuePartsRowsEl, null, true, recomputeQueueSums, true));

document.getElementById('queueAdvanceToggleBtn').addEventListener('click', () => {
  queueAdvanceEnabled = !queueAdvanceEnabled;
  document.getElementById('queueAdvanceToggleBtn').classList.toggle('active', queueAdvanceEnabled);
  document.getElementById('queueAdvanceAmountWrap').classList.toggle('hidden', !queueAdvanceEnabled);
  if (!queueAdvanceEnabled) document.getElementById('queueAdvanceAmountInput').value = '';
  recomputeQueueSums();
});
document.getElementById('queueAdvanceAmountInput').addEventListener('input', recomputeQueueSums);

// Позволяет подтянуть данные уже существующего клиента вместо ручного ввода —
// заказ всё равно хранит свою копию полей (car_make/phone/...), клиент не привязывается по id.
function fillQueueClientSelect() {
  const sel = document.getElementById('queueClientSelect');
  const options = state.clients
    .map((c) => {
      const car = [c.car_make, c.car_model].filter(Boolean).join(' ');
      return `<option value="${c.id}">${escapeHtml(c.name)}${car ? ' — ' + escapeHtml(car) : ''}</option>`;
    })
    .join('');
  sel.innerHTML = `<option value="">— новый клиент (не из базы) —</option>${options}`;
}

document.getElementById('queueClientSelect').addEventListener('change', (e) => {
  const client = state.clients.find((c) => c.id === Number(e.target.value));
  if (!client) return;
  queueForm.elements.name.value = client.name || '';
  queueForm.elements.phone.value = client.phone || '';
  queueForm.elements.car_make.value = client.car_make || '';
  queueForm.elements.car_model.value = client.car_model || '';
  queueForm.elements.plate.value = client.plate || '';
  queueForm.elements.vin.value = client.vin || '';
});
enhanceClientSelect(document.getElementById('queueClientSelect'), '— новый клиент (не из базы) —');

function openQueueDialog(entry) {
  editingQueueId = entry ? entry.id : null;
  document.getElementById('queueDialogTitle').textContent = entry ? 'Заказ' : 'Новый заказ';
  deleteQueueBtn.classList.toggle('hidden', !entry);
  queueForm.reset();
  fillQueueClientSelect();

  if (entry) {
    for (const [k, v] of Object.entries(entry)) {
      if (queueForm.elements[k]) queueForm.elements[k].value = v || '';
    }
  } else {
    queueForm.elements.date.value = toISODate(new Date());
    queueForm.elements.parts_eta.value = 'до 5 рабочих дней';
  }
  autoResizeTextarea(queueForm.elements.notes);

  queueWorksRowsEl.innerHTML = '';
  queuePartsRowsEl.innerHTML = '';
  const works = entry?.works?.length ? entry.works : [null];
  const parts = entry?.parts?.length ? entry.parts : [null];
  works.forEach((w) => addRepairRow(queueWorksRowsEl, w, false, recomputeQueueSums));
  parts.forEach((p) => addRepairRow(queuePartsRowsEl, p, true, recomputeQueueSums, true));

  queueAdvanceEnabled = !!(entry && Number(entry.advance) > 0);
  document.getElementById('queueAdvanceToggleBtn').classList.toggle('active', queueAdvanceEnabled);
  document.getElementById('queueAdvanceAmountWrap').classList.toggle('hidden', !queueAdvanceEnabled);
  document.getElementById('queueAdvanceAmountInput').value = queueAdvanceEnabled ? entry.advance : '';

  recomputeQueueSums();
  openDialog(queueDialog);
}

document.getElementById('newQueueBtn').addEventListener('click', () => openQueueDialog(null));

queueForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(queueForm).entries());
  data.advance = queueAdvanceEnabled ? (Number(document.getElementById('queueAdvanceAmountInput').value) || 0) : 0;
  data.works = collectRepairRows(queueWorksRowsEl);
  data.parts = collectRepairRows(queuePartsRowsEl);
  const partsWithName = data.parts.filter((p) => p.name);
  if (partsWithName.length) {
    data.status = partsWithName.every((p) => p.received) ? 'arrived' : 'waiting';
  }
  try {
    if (editingQueueId) {
      await api(`/api/queue/${editingQueueId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Изменения сохранены');
    } else {
      await api('/api/queue', { method: 'POST', body: JSON.stringify(data) });
      showToast('Заказ добавлен');
    }
    closeDialog(queueDialog);
    await loadQueue();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteQueueBtn.addEventListener('click', async () => {
  if (!editingQueueId) return;
  if (!(await showConfirm('Удалить заказ?'))) return;
  try {
    await api(`/api/queue/${editingQueueId}`, { method: 'DELETE' });
    showToast('Заказ удалён');
    closeDialog(queueDialog);
    await loadQueue();
  } catch (err) {
    showToast(err.message, true);
  }
});

// "Добавить в список клиентов": заводим настоящего клиента и переносим смету
// (работы/запчасти) в его историю ремонта первой записью. Сама запись в очереди
// остаётся — её убирают вручную кнопкой "Удалить", когда она больше не нужна.
document.getElementById('promoteQueueBtn').addEventListener('click', async () => {
  const name = queueForm.elements.name.value.trim();
  if (!name) {
    showToast('Укажите имя клиента', true);
    return;
  }
  try {
    const newClient = await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name,
        phone: queueForm.elements.phone.value,
        car_make: queueForm.elements.car_make.value,
        car_model: queueForm.elements.car_model.value,
        plate: queueForm.elements.plate.value,
        vin: queueForm.elements.vin.value,
        notes: queueForm.elements.notes.value,
      }),
    });

    const works = collectRepairRows(queueWorksRowsEl);
    const parts = collectRepairRows(queuePartsRowsEl);
    const title = queueForm.elements.title.value;
    if (works.length || parts.length || title.trim()) {
      await api(`/api/clients/${newClient.id}/repairs`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          date: queueForm.elements.date.value || toISODate(new Date()),
          notes: queueForm.elements.notes.value,
          parts_eta: queueForm.elements.parts_eta.value,
          advance: queueAdvanceEnabled ? (Number(document.getElementById('queueAdvanceAmountInput').value) || 0) : 0,
          works,
          parts,
        }),
      });
    }

    showToast('Клиент добавлен в базу');
    closeDialog(queueDialog);
    await loadClients();
    await loadQueue();
  } catch (err) {
    showToast(err.message, true);
  }
});

function buildQueueOrderData() {
  const works = collectRepairRows(queueWorksRowsEl);
  const parts = collectRepairRows(queuePartsRowsEl);
  const worksSum = sumItems(works);
  const partsSum = sumItems(parts);
  const advance = queueAdvanceEnabled ? (Number(document.getElementById('queueAdvanceAmountInput').value) || 0) : 0;
  return {
    clientName: queueForm.elements.name.value,
    carLine: [queueForm.elements.car_make.value, queueForm.elements.car_model.value].filter(Boolean).join(' '),
    mileage: queueForm.elements.mileage.value,
    partsEta: queueForm.elements.parts_eta.value,
    title: queueForm.elements.title.value,
    date: queueForm.elements.date.value,
    notes: queueForm.elements.notes.value,
    works,
    parts,
    worksSum,
    partsSum,
    advance,
    total: Math.max(0, worksSum + partsSum - advance),
  };
}

document.getElementById('queueOrderBtn').addEventListener('click', () => {
  const order = buildQueueOrderData();
  currentOrderData = order;
  document.getElementById('orderContent').innerHTML = buildOrderHtml(order);
  openDialog(orderDialog);
});

// ================= CONSUMABLES (расходники) =================
// Разделы, категории и сами расходники (с артикулами) заводит владелец сам —
// никакого предустановленного списка нет. Иерархия: раздел → категория → расходник.
const consumableSectionDialog = document.getElementById('consumableSectionDialog');
const consumableSectionForm = document.getElementById('consumableSectionForm');
const deleteConsumableSectionBtn = document.getElementById('deleteConsumableSectionBtn');
const consumableCategoryDialog = document.getElementById('consumableCategoryDialog');
const consumableCategoryForm = document.getElementById('consumableCategoryForm');
const deleteConsumableCategoryBtn = document.getElementById('deleteConsumableCategoryBtn');
const consumableDialog = document.getElementById('consumableDialog');
const consumableForm = document.getElementById('consumableForm');
const deleteConsumableBtn = document.getElementById('deleteConsumableBtn');
let consumableSections = [];
let consumableCategories = [];
let consumables = [];
let editingConsumableSectionId = null;
let editingConsumableCategoryId = null;
let editingConsumableId = null;

async function loadConsumables() {
  [consumableSections, consumableCategories, consumables] = await Promise.all([
    api('/api/consumable-sections'),
    api('/api/consumable-categories'),
    api('/api/consumables'),
  ]);
  renderConsumables();
}

function renderConsumableItems(container, items) {
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'consumable-items-empty';
    empty.textContent = 'Пока нет расходников в этой категории.';
    container.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'consumable-item';
    row.innerHTML = `
      <span class="consumable-item-name">${escapeHtml(it.name)}</span>
      ${it.article ? `<span class="consumable-item-article">${escapeHtml(it.article)}<button type="button" class="article-copy-btn" title="Копировать артикул">${COPY_ICON_SVG}</button></span>` : ''}
    `;
    const copyBtn = row.querySelector('.article-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyArticleToClipboard(it.article);
      });
    }
    row.addEventListener('click', () => openConsumableDialog(it));
    container.appendChild(row);
  });
}

// Категорийный блок переиспользуется и внутри разделов, и в блоке "Без раздела".
function renderConsumableCategoryBlock(cat) {
  const items = consumables.filter((c) => c.category_id === cat.id);
  const block = document.createElement('div');
  block.className = 'consumable-category';
  block.innerHTML = `
    <div class="consumable-category-head">
      <span class="consumable-category-name">${escapeHtml(cat.name)}</span>
      <div class="consumable-category-actions">
        <button type="button" class="btn-link" data-action="add-item">+ расходник</button>
        <button type="button" class="btn-link" data-action="edit-category">изменить</button>
      </div>
    </div>
    <div class="consumable-items"></div>
  `;
  renderConsumableItems(block.querySelector('.consumable-items'), items);
  block.querySelector('[data-action="add-item"]').addEventListener('click', () => openConsumableDialog(null, cat.id));
  block.querySelector('[data-action="edit-category"]').addEventListener('click', () => openConsumableCategoryDialog(cat));
  return block;
}

function renderConsumableSectionBlock(section, categories, isOrphan) {
  const block = document.createElement('div');
  block.className = 'consumable-section';
  block.innerHTML = `
    <div class="consumable-section-head">
      <span class="consumable-section-name">${escapeHtml(section ? section.name : 'Без раздела')}</span>
      ${section ? `
        <div class="consumable-section-actions">
          <button type="button" class="btn-link" data-action="add-category">+ категория</button>
          <button type="button" class="btn-link" data-action="edit-section">изменить</button>
        </div>
      ` : ''}
    </div>
    <div class="consumable-section-categories"></div>
  `;
  const catsContainer = block.querySelector('.consumable-section-categories');
  if (categories.length) {
    categories.forEach((cat) => catsContainer.appendChild(renderConsumableCategoryBlock(cat)));
  } else {
    const emptyP = document.createElement('p');
    emptyP.className = 'consumable-items-empty';
    emptyP.textContent = 'Пока нет категорий в этом разделе.';
    catsContainer.appendChild(emptyP);
  }
  if (section) {
    block.querySelector('[data-action="add-category"]').addEventListener('click', () => openConsumableCategoryDialog(null, section.id));
    block.querySelector('[data-action="edit-section"]').addEventListener('click', () => openConsumableSectionDialog(section));
  }
  if (isOrphan) block.classList.add('consumable-section-orphan');
  return block;
}

function renderConsumables() {
  const list = document.getElementById('consumablesList');
  const empty = document.getElementById('consumablesEmpty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', consumableSections.length !== 0 || consumableCategories.length !== 0);

  consumableSections.forEach((sec) => {
    const cats = consumableCategories.filter((c) => c.section_id === sec.id);
    list.appendChild(renderConsumableSectionBlock(sec, cats, false));
  });

  // Категории, у которых раздел был удалён, всё равно должны быть видны и доступны для правки.
  const orphanCats = consumableCategories.filter((c) => !consumableSections.some((sec) => sec.id === c.section_id));
  if (orphanCats.length) {
    list.appendChild(renderConsumableSectionBlock(null, orphanCats, true));
  }

  // Расходники, у которых категория была удалена, всё равно должны быть видны и доступны для правки.
  const orphanItems = consumables.filter((c) => !consumableCategories.some((cat) => cat.id === c.category_id));
  if (orphanItems.length) {
    const block = document.createElement('div');
    block.className = 'consumable-category';
    block.innerHTML = '<div class="consumable-category-head"><span class="consumable-category-name">Без категории</span></div><div class="consumable-items"></div>';
    renderConsumableItems(block.querySelector('.consumable-items'), orphanItems);
    list.appendChild(block);
  }
}

function fillConsumableCategorySelect(selectedId) {
  const sel = document.getElementById('consumableCategorySelect');
  sel.innerHTML = consumableCategories
    .map((cat) => {
      const section = consumableSections.find((sec) => sec.id === cat.section_id);
      const label = section ? `${section.name} / ${cat.name}` : cat.name;
      return `<option value="${cat.id}">${escapeHtml(label)}</option>`;
    })
    .join('');
  if (selectedId) sel.value = selectedId;
}

function fillConsumableCategorySectionSelect(selectedId) {
  const sel = document.getElementById('consumableCategorySectionSelect');
  const options = consumableSections.map((sec) => `<option value="${sec.id}">${escapeHtml(sec.name)}</option>`).join('');
  sel.innerHTML = `<option value="">— без раздела —</option>${options}`;
  sel.value = selectedId || '';
}

function openConsumableSectionDialog(section) {
  editingConsumableSectionId = section ? section.id : null;
  document.getElementById('consumableSectionDialogTitle').textContent = section ? 'Раздел' : 'Новый раздел';
  deleteConsumableSectionBtn.classList.toggle('hidden', !section);
  consumableSectionForm.reset();
  if (section) consumableSectionForm.elements.name.value = section.name;
  openDialog(consumableSectionDialog);
}

document.getElementById('newConsumableSectionBtn').addEventListener('click', () => openConsumableSectionDialog(null));

consumableSectionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(consumableSectionForm).entries());
  try {
    if (editingConsumableSectionId) {
      await api(`/api/consumable-sections/${editingConsumableSectionId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Раздел обновлён');
    } else {
      await api('/api/consumable-sections', { method: 'POST', body: JSON.stringify(data) });
      showToast('Раздел добавлен');
    }
    closeDialog(consumableSectionDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteConsumableSectionBtn.addEventListener('click', async () => {
  if (!editingConsumableSectionId) return;
  if (!(await showConfirm('Удалить раздел? Категории и расходники в нём тоже будут удалены.'))) return;
  try {
    await api(`/api/consumable-sections/${editingConsumableSectionId}`, { method: 'DELETE' });
    showToast('Раздел удалён');
    closeDialog(consumableSectionDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
});

function openConsumableCategoryDialog(category, defaultSectionId) {
  editingConsumableCategoryId = category ? category.id : null;
  document.getElementById('consumableCategoryDialogTitle').textContent = category ? 'Категория' : 'Новая категория';
  deleteConsumableCategoryBtn.classList.toggle('hidden', !category);
  consumableCategoryForm.reset();
  fillConsumableCategorySectionSelect(category ? category.section_id : defaultSectionId);
  if (category) consumableCategoryForm.elements.name.value = category.name;
  openDialog(consumableCategoryDialog);
}

document.getElementById('newConsumableCategoryBtn').addEventListener('click', () => openConsumableCategoryDialog(null));

consumableCategoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(consumableCategoryForm).entries());
  try {
    if (editingConsumableCategoryId) {
      await api(`/api/consumable-categories/${editingConsumableCategoryId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Категория обновлена');
    } else {
      await api('/api/consumable-categories', { method: 'POST', body: JSON.stringify(data) });
      showToast('Категория добавлена');
    }
    closeDialog(consumableCategoryDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteConsumableCategoryBtn.addEventListener('click', async () => {
  if (!editingConsumableCategoryId) return;
  if (!(await showConfirm('Удалить категорию? Расходники в ней тоже будут удалены.'))) return;
  try {
    await api(`/api/consumable-categories/${editingConsumableCategoryId}`, { method: 'DELETE' });
    showToast('Категория удалена');
    closeDialog(consumableCategoryDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
});

function openConsumableDialog(item, defaultCategoryId) {
  editingConsumableId = item ? item.id : null;
  document.getElementById('consumableDialogTitle').textContent = item ? 'Расходник' : 'Новый расходник';
  deleteConsumableBtn.classList.toggle('hidden', !item);
  consumableForm.reset();
  fillConsumableCategorySelect(item ? item.category_id : defaultCategoryId);
  if (item) {
    consumableForm.elements.name.value = item.name || '';
    consumableForm.elements.article.value = item.article || '';
    consumableForm.elements.notes.value = item.notes || '';
  }
  autoResizeTextarea(consumableForm.elements.notes);
  openDialog(consumableDialog);
}

document.getElementById('newConsumableBtn').addEventListener('click', () => {
  if (!consumableCategories.length) {
    showToast('Сначала добавьте категорию', true);
    return;
  }
  openConsumableDialog(null);
});

consumableForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(consumableForm).entries());
  try {
    if (editingConsumableId) {
      await api(`/api/consumables/${editingConsumableId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Расходник обновлён');
    } else {
      await api('/api/consumables', { method: 'POST', body: JSON.stringify(data) });
      showToast('Расходник добавлен');
    }
    closeDialog(consumableDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteConsumableBtn.addEventListener('click', async () => {
  if (!editingConsumableId) return;
  if (!(await showConfirm('Удалить расходник?'))) return;
  try {
    await api(`/api/consumables/${editingConsumableId}`, { method: 'DELETE' });
    showToast('Расходник удалён');
    closeDialog(consumableDialog);
    await loadConsumables();
  } catch (err) {
    showToast(err.message, true);
  }
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
enhanceClientSelect(document.getElementById('apptClientSelect'), '— Разовый визит (без базы) —');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// "Рекомендации" растёт по высоте под текст вместо фиксированных 2 строк
// с внутренней прокруткой.
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
document.querySelectorAll('.notes-textarea').forEach((el) => {
  el.addEventListener('input', () => autoResizeTextarea(el));
});

// Обычный <select> с 1000+ клиентами на телефоне неюзабелен — нет поиска,
// системный пикер занимает весь экран одним столбцом текста. Прячем select
// (он остаётся источником правды: value читают fillClientSelect/FormData/
// toggleWalkinFields без изменений) и рисуем поверх текстовое поле с
// выпадающим списком, который фильтруется по вводу.
function enhanceClientSelect(selectEl, emptyLabel) {
  const wrapper = document.createElement('div');
  wrapper.className = 'client-picker';
  selectEl.before(wrapper);
  wrapper.appendChild(selectEl);
  selectEl.classList.add('client-picker-native');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'client-picker-input';
  input.placeholder = emptyLabel;
  input.autocomplete = 'off';
  wrapper.insertBefore(input, selectEl);

  const list = document.createElement('div');
  list.className = 'client-picker-list hidden';
  wrapper.appendChild(list);

  function syncInputFromSelect() {
    const opt = selectEl.options[selectEl.selectedIndex];
    input.value = opt && opt.value ? opt.textContent : '';
  }

  function closeList() { list.classList.add('hidden'); }

  function renderList(filterText) {
    const q = filterText.trim().toLowerCase();
    const options = Array.from(selectEl.options).filter((o) => o.value); // без "— не из базы —"
    const matches = q ? options.filter((o) => o.textContent.toLowerCase().includes(q)) : options;
    const shown = matches.slice(0, 100);
    list.innerHTML = '';

    const emptyItem = document.createElement('div');
    emptyItem.className = 'client-picker-item client-picker-item-empty';
    emptyItem.textContent = emptyLabel;
    emptyItem.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectEl.value = '';
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = '';
      closeList();
    });
    list.appendChild(emptyItem);

    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'client-picker-empty';
      empty.textContent = 'Ничего не найдено';
      list.appendChild(empty);
    }
    shown.forEach((o) => {
      const item = document.createElement('div');
      item.className = 'client-picker-item';
      item.textContent = o.textContent;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // иначе blur инпута срабатывает раньше клика по пункту
        selectEl.value = o.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        syncInputFromSelect();
        closeList();
      });
      list.appendChild(item);
    });
    if (matches.length > shown.length) {
      const hint = document.createElement('div');
      hint.className = 'client-picker-empty';
      hint.textContent = `Показаны первые ${shown.length} из ${matches.length} — уточните запрос`;
      list.appendChild(hint);
    }
  }

  input.addEventListener('focus', () => { renderList(''); list.classList.remove('hidden'); });
  input.addEventListener('input', () => { renderList(input.value); list.classList.remove('hidden'); });
  input.addEventListener('blur', () => {
    setTimeout(() => { syncInputFromSelect(); closeList(); }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { syncInputFromSelect(); closeList(); input.blur(); }
  });

  // childList — на случай fillClientSelect()/fillQueueClientSelect() (пересобирают
  // <option>); change — на случай, когда код где-то ещё выставляет .value напрямую
  // и явно рассылает событие (программная установка .value событие не создаёт).
  new MutationObserver(syncInputFromSelect).observe(selectEl, { childList: true });
  selectEl.addEventListener('change', syncInputFromSelect);
  syncInputFromSelect();
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
    apptForm.elements.client_id.dispatchEvent(new Event('change'));
  } else {
    apptForm.elements.date.value = defaultDate;
    apptForm.elements.time.value = '09:00';
  }
  // Для уже существующей записи прячем поля даты/времени/VIN/услуги/статуса/заметок
  // за кнопкой "Редактировать", чтобы окно не пугало кучей полей при простом просмотре.
  // Поля разового визита (имя/телефон/авто) — туда же, за кнопку: иначе они лезли
  // поверх сводки, хотя та же информация уже показана в рамке апптSummary.
  const detailsFields = document.getElementById('apptDetailsFields');
  const summary = document.getElementById('apptSummary');
  if (appt) {
    fillApptSummary(appt);
    summary.classList.remove('hidden');
    detailsFields.classList.add('hidden');
    document.getElementById('walkinFields').classList.add('hidden');
  } else {
    summary.classList.add('hidden');
    detailsFields.classList.remove('hidden');
    toggleWalkinFields();
    autoResizeTextarea(apptForm.elements.notes); // при hidden-родителе scrollHeight не посчитать
  }

  openDialog(apptDialog);
}

function fillApptSummary(appt) {
  document.getElementById('summaryName').textContent = appt.client_name || '';

  const phoneRow = document.getElementById('summaryPhoneRow');
  if (appt.client_phone) {
    document.getElementById('summaryPhone').textContent = appt.client_phone;
    phoneRow.classList.remove('hidden');
  } else {
    phoneRow.classList.add('hidden');
  }

  const carRow = document.getElementById('summaryCarRow');
  const carLine = appt.client_id
    ? [appt.car_make, appt.car_model].filter(Boolean).join(' ')
    : (appt.walkin_car || '');
  if (carLine) {
    document.getElementById('summaryCar').textContent = carLine;
    carRow.classList.remove('hidden');
  } else {
    carRow.classList.add('hidden');
  }

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
  toggleWalkinFields();
  autoResizeTextarea(apptForm.elements.notes);
});

apptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(apptForm).entries());
  const wasEditing = !!editingApptId;
  try {
    if (editingApptId) {
      await api(`/api/appointments/${editingApptId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Запись обновлена');
    } else {
      await api('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
      showToast('Запись создана');
    }
    await loadWeek();
    // При редактировании окно не закрываем — возвращаемся к сводке с уже
    // сохранёнными данными, а не выкидываем в расписание. Закрываем только
    // при создании новой записи, и если после сохранения запись почему-то
    // не нашлась в текущей неделе (например, дату перенесли на другую неделю).
    const updated = wasEditing ? state.appointments.find((a) => a.id === editingApptId) : null;
    if (wasEditing && updated) {
      currentApptRecord = updated;
      fillApptSummary(updated);
      document.getElementById('apptSummary').classList.remove('hidden');
      document.getElementById('apptDetailsFields').classList.add('hidden');
      document.getElementById('walkinFields').classList.add('hidden');
    } else {
      closeDialog(apptDialog);
    }
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
  if (!(await showConfirm('Удалить запись?'))) return;
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

// ---------- Заявки клиентов (вкладка админа) ----------
async function loadRequests() {
  const list = document.getElementById('requestsList');
  const empty = document.getElementById('requestsEmpty');
  const badge = document.getElementById('requestsBadge');
  let items;
  try {
    items = await api('/api/requests');
  } catch (err) {
    showToast('Не удалось загрузить заявки: ' + err.message, true);
    return;
  }
  list.innerHTML = '';
  empty.classList.toggle('hidden', items.length !== 0);
  const unreadCount = items.filter((r) => !r.is_read).length;
  badge.textContent = String(unreadCount);
  badge.classList.toggle('hidden', unreadCount === 0);

  items.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'request-item' + (r.is_read ? '' : ' unread');
    const senderName = r.client_name ? escapeHtml(r.client_name) : 'Клиент не найден в базе';
    const telHref = r.client_phone ? r.client_phone.replace(/[^\d+]/g, '') : '';
    item.innerHTML = `
      <div class="request-item-head">
        <span><span class="request-item-name">${senderName}</span> <span class="request-item-vin">VIN: ${escapeHtml(r.vin)}</span></span>
        <span class="request-item-date">${fmtDateTime(r.created_at)}</span>
      </div>
      ${r.message ? `<p class="request-item-message">${escapeHtml(r.message)}</p>` : ''}
      ${r.photo ? `<img src="${r.photo}" class="request-item-photo" alt="Фото от клиента">` : ''}
      <div class="request-item-actions">
        ${!r.client_name ? `<button type="button" class="btn-primary request-add-client-btn">Добавить клиента</button>` : ''}
        ${telHref ? `<a href="tel:${escapeHtml(telHref)}" class="btn-ghost">Позвонить</a>` : ''}
        <button type="button" class="btn-danger request-delete-btn">Удалить</button>
      </div>
    `;
    const photoImg = item.querySelector('.request-item-photo');
    if (photoImg) photoImg.addEventListener('click', (e) => { e.stopPropagation(); window.open(r.photo, '_blank'); });
    const telLink = item.querySelector('.request-item-actions a');
    if (telLink) telLink.addEventListener('click', (e) => e.stopPropagation());
    const addClientBtn = item.querySelector('.request-add-client-btn');
    if (addClientBtn) {
      addClientBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openClientDialog(null);
        clientForm.elements.vin.value = r.vin;
        // Если клиент уже сам заполнил анкету в своём кабинете (телефон,
        // машина) — подтягиваем её, чтобы админ не вбивал всё заново.
        const p = r.client_profile;
        if (p) {
          if (p.phone) clientForm.elements.phone.value = p.phone;
          if (p.car_make) clientForm.elements.car_make.value = p.car_make;
          if (p.car_model) clientForm.elements.car_model.value = p.car_model;
          if (p.plate) clientForm.elements.plate.value = p.plate;
          if (p.notes) clientForm.elements.notes.value = p.notes;
          autoResizeTextarea(clientForm.elements.notes);
        }
      });
    }
    item.querySelector('.request-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await showConfirm('Удалить заявку?'))) return;
      try {
        await api(`/api/requests/${r.id}`, { method: 'DELETE' });
        await loadRequests();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    if (!r.is_read) {
      item.addEventListener('click', async () => {
        try {
          await api(`/api/requests/${r.id}/read`, { method: 'PUT' });
          await loadRequests();
        } catch (err) {
          // бейдж просто останется прежним — не критично
        }
      });
    }
    list.appendChild(item);
  });
}

// ---------- Кабинет клиента (вход по VIN) ----------
const clientCarForm = document.getElementById('clientCarForm');
const clientRequestForm = document.getElementById('clientRequestForm');
const clientRequestPhotoInput = document.getElementById('clientRequestPhotoInput');
const clientRequestPhotoPreview = document.getElementById('clientRequestPhotoPreview');
const clientRequestPhotoImg = document.getElementById('clientRequestPhotoImg');
const clientRequestError = document.getElementById('clientRequestError');
let clientRequestPhotoData = null;

async function loadClientProfile() {
  const profile = await api('/api/client/me');
  document.getElementById('clientVinBadge').textContent = profile.vin;
  clientCarForm.elements.phone.value = profile.car.phone || '';
  clientCarForm.elements.car_make.value = profile.car.car_make || '';
  clientCarForm.elements.car_model.value = profile.car.car_model || '';
  clientCarForm.elements.plate.value = profile.car.plate || '';
  clientCarForm.elements.notes.value = profile.car.notes || '';
  autoResizeTextarea(clientCarForm.elements.notes);
  renderClientRepairs(profile.repairs);
}

function renderClientRepairs(records) {
  const list = document.getElementById('clientRepairsList');
  const empty = document.getElementById('clientRepairsEmpty');
  list.innerHTML = '';
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
      ${r.mileage ? `<div class="repair-list-sum"><span>Пробег</span><span>${fmtMileage(r.mileage)}</span></div>` : ''}
      ${renderRepairBlock('Работы', r.works, worksSum, 'Сумма работ:')}
      ${renderRepairBlock('Запчасти', r.parts, partsSum, 'Сумма запчастей')}
      ${r.parts_eta ? `<div class="repair-list-sum"><span>Срок поставки запчастей</span><span>${escapeHtml(r.parts_eta)}</span></div>` : ''}
      ${advance > 0 ? `<div class="repair-list-sum"><span>Аванс</span><span>− ${fmtMoney(advance)}</span></div>` : ''}
      ${r.notes ? `<div class="history-notes">${escapeHtml(r.notes)}</div>` : ''}
    `;
    item.querySelectorAll('.article-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyArticleToClipboard(btn.dataset.article);
      });
    });
    list.appendChild(item);
  });
}

clientCarForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(clientCarForm).entries());
  try {
    await api('/api/client/car', { method: 'PUT', body: JSON.stringify(data) });
    showToast('Сохранено');
  } catch (err) {
    showToast(err.message, true);
  }
});

// Фото ужимаем на канвасе перед отправкой — иначе снимок с телефона (несколько
// мегабайт) раздувает JSON-запрос и base64 в базе; 1280px по длинной стороне
// с лёгким сжатием JPEG достаточно, чтобы админ разглядел, что прислали.
function compressImageFile(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

clientRequestPhotoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    clientRequestPhotoData = await compressImageFile(file);
    clientRequestPhotoImg.src = clientRequestPhotoData;
    clientRequestPhotoPreview.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('clientRequestPhotoRemove').addEventListener('click', () => {
  clientRequestPhotoData = null;
  clientRequestPhotoInput.value = '';
  clientRequestPhotoPreview.classList.add('hidden');
});

clientRequestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clientRequestError.classList.add('hidden');
  const message = clientRequestForm.elements.message.value.trim();
  if (!message && !clientRequestPhotoData) {
    clientRequestError.textContent = 'Добавьте текст сообщения или фото';
    clientRequestError.classList.remove('hidden');
    return;
  }
  try {
    await api('/api/client/requests', { method: 'POST', body: JSON.stringify({ message, photo: clientRequestPhotoData }) });
    clientRequestForm.reset();
    clientRequestPhotoData = null;
    clientRequestPhotoPreview.classList.add('hidden');
    showToast('Заявка отправлена');
    await loadClientRequests();
  } catch (err) {
    clientRequestError.textContent = err.message;
    clientRequestError.classList.remove('hidden');
  }
});

async function loadClientRequests() {
  const list = document.getElementById('clientRequestsList');
  let items;
  try {
    items = await api('/api/client/requests');
  } catch (err) {
    return;
  }
  list.innerHTML = '';
  items.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head"><span class="history-date">${fmtDateTime(r.created_at)}</span></div>
      ${r.message ? `<div class="history-notes">${escapeHtml(r.message)}</div>` : ''}
      ${r.photo ? `<img src="${r.photo}" alt="Фото к заявке" style="max-width:160px;height:auto;border-radius:3px;margin-top:6px;display:block;">` : ''}
    `;
    list.appendChild(item);
  });
}

async function bootClientApp() {
  try {
    await loadClientProfile();
    await loadClientRequests();
  } catch (err) {
    showToast('Не удалось загрузить данные: ' + err.message, true);
  }
}

// ---------- Init ----------
async function bootApp() {
  try {
    await loadClients();
    await loadWeek();
    await loadQueue();
    await loadConsumables();
    await loadRequests();
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
      return;
    }
  } catch (err) {
    // не авторизован как владелец — проверим клиентскую сессию ниже
  }
  try {
    const { authenticated } = await api('/api/client-session');
    if (authenticated) {
      showClientApp();
      await bootClientApp();
      return;
    }
  } catch (err) {
    // не авторизован и как клиент — покажем экран входа
  }
  showLogin('owner');
})();
