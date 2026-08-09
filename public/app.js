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
  reportWeekStart: startOfWeek(new Date()),
  reportMasterFilter: '',
};

// Дата ремонта (смета/заказ) и дата переноса записи в отчёт — не раньше начала
// текущего года: слишком старая дата почти всегда результат опечатки, а не
// реальная историческая запись. Год не хардкодим — считаем от текущей даты,
// иначе ограничение "сломается" с наступлением следующего года.
const MIN_REPAIR_DATE = `${new Date().getFullYear()}-01-01`;
document.getElementById('orderReportDateInput').min = MIN_REPAIR_DATE;

// min на поле даты нельзя вешать одним и тем же значением раз и навсегда —
// иначе открыть и сохранить СУЩЕСТВОВАВШУЮ запись за прошлый год (ничего не
// меняя в самой дате) стало бы невозможно: браузер считает поле невалидным
// и молча блокирует отправку формы целиком, даже если правится другое поле.
// Поэтому порог считаем заново при каждом открытии диалога — раньше даты
// самой записи (если она старше начала года) граница не поднимается.
function setDateMin(input, existingDate) {
  input.min = existingDate && existingDate < MIN_REPAIR_DATE ? existingDate : MIN_REPAIR_DATE;
}
setDateMin(document.getElementById('repairForm').elements.date, null);
setDateMin(document.getElementById('queueForm').elements.date, null);
setDateMin(document.getElementById('apptForm').elements.date, null);

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
  document.querySelectorAll('.login-submit-btn').forEach((b) => {
    b.classList.toggle('hidden', b.dataset.loginSubmit !== mode);
  });
}

document.querySelectorAll('.login-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setLoginMode(btn.dataset.loginMode));
});

function showLogin(mode) {
  appRoot.classList.add('hidden');
  clientRoot.classList.add('hidden');
  loginOverlay.classList.remove('hidden');
  if (mode) setLoginMode(mode);
  if (mode === 'client') setClientLoginMethod('vin');
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

// Вход клиента — по VIN или по телефону (переключатель над полями). Если
// телефон найден среди клиентов — вход сразу, как и по известному VIN; если
// не найден — тот же шаг с паролем-годом, что и для незнакомого VIN (см. server.js).
let clientLoginMethod = 'vin';
const clientVinFieldLabel = document.getElementById('clientVinFieldLabel');
const clientPhoneFieldLabel = document.getElementById('clientPhoneFieldLabel');
const clientPhoneLoginInput = document.getElementById('clientPhoneLoginInput');
attachPhoneMask(clientPhoneLoginInput);

function setClientLoginMethod(method) {
  clientLoginMethod = method;
  document.querySelectorAll('.client-login-method-btn').forEach((b) => {
    const active = b.dataset.clientLoginMethod === method;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  clientVinFieldLabel.classList.toggle('hidden', method !== 'vin');
  clientPhoneFieldLabel.classList.toggle('hidden', method !== 'phone');
  // required переключаем явно, а не полагаемся на то, что скрытое поле само
  // выпадает из валидации формы — так надёжнее независимо от браузера.
  document.getElementById('clientVinInput').required = method === 'vin';
  clientPhoneLoginInput.required = method === 'phone';
  // Смена способа входа — как смена машины: шаг с паролем и его значение
  // должны начаться заново, а не подхватить пароль от предыдущей попытки.
  clientPasswordLabel.classList.add('hidden');
  document.getElementById('clientPasswordInput').value = '';
  clientLoginError.classList.add('hidden');
}

document.querySelectorAll('.client-login-method-btn').forEach((btn) => {
  btn.addEventListener('click', () => setClientLoginMethod(btn.dataset.clientLoginMethod));
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
    vin: clientLoginMethod === 'vin' ? document.getElementById('clientVinInput').value : '',
    phone: clientLoginMethod === 'phone' ? clientPhoneLoginInput.value : '',
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
// промахнуться курсором при наборе на телефоне. "+7" только подставляется
// как заготовка, чтобы не печатать его вручную, и убирается обратно при
// уходе с поля, если так и осталось не заполнено. Вешаем сразу на несколько
// событий (touchstart/mousedown раньше focus, plus сам focus как фолбэк) —
// на части мобильных браузеров событие focus после программной подстановки
// значения ведёт себя иначе, чем на десктопе.
const loginPhoneInput = document.getElementById('loginPhoneInput');
function prefillLoginPhone() {
  if (!loginPhoneInput.value) loginPhoneInput.value = '+7';
}
loginPhoneInput.addEventListener('touchstart', prefillLoginPhone, { passive: true });
loginPhoneInput.addEventListener('mousedown', prefillLoginPhone);
loginPhoneInput.addEventListener('focus', prefillLoginPhone);
// Браузер сам расставляет курсор по месту тапа/клика — на мобильных это
// происходит с непредсказуемой задержкой относительно touchstart/focus
// (после анимации появления клавиатуры), поэтому фиксированный setTimeout
// после этих событий срабатывал слишком рано и не помогал. Вместо этого
// слушаем сам selectionchange: пока в поле ровно "+7" (пользователь ещё
// ничего не напечатал), любая попытка браузера передвинуть курсор не в
// конец тут же откатывается обратно — как только начат реальный ввод,
// проверка перестаёт срабатывать и курсор ведёт себя как обычно.
document.addEventListener('selectionchange', () => {
  if (document.activeElement !== loginPhoneInput) return;
  if (loginPhoneInput.value !== '+7') return;
  if (loginPhoneInput.selectionStart !== 2 || loginPhoneInput.selectionEnd !== 2) {
    loginPhoneInput.setSelectionRange(2, 2);
  }
});
loginPhoneInput.addEventListener('blur', () => {
  if (loginPhoneInput.value === '+7') loginPhoneInput.value = '';
});

// ---------- Маска марки/модели авто ----------
// Английские буквы и цифры (плюс пробел/дефис для составных названий вроде
// "Land Rover", "Mercedes-Benz", и моделей вроде "CX-5", "X5", "308") — всё
// целиком в верхнем регистре, как во всей остальной базе; кириллица и
// прочие символы отбрасываются.
function formatCarWordMask(raw) {
  return raw.replace(/[^a-zA-Z0-9\s-]/g, '').toUpperCase();
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
document.querySelectorAll('input[name="oil_filter_brand"], input[name="air_filter_brand"], input[name="cabin_filter_brand"]').forEach(attachBrandMask);

// ---------- Маска "Фирмы" (бренда запчасти) ----------
// В отличие от марки/модели авто выше — тут кириллица разрешена (и в любом
// регистре, как набрал), а латиница всё равно приводится к верхнему регистру.
function formatBrandMask(raw) {
  return raw.replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s-]/g, '').replace(/[a-z]/g, (c) => c.toUpperCase());
}

function attachBrandMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatBrandMask(input.value);
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  });
}

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

// ---------- Маска VIN (окно авторизации клиента) ----------
// Английские буквы, цифры и дефис, в верхнем регистре. Дефис разрешён,
// потому что в базе VIN хранится ровно так, как его когда-то ввёл админ —
// у части клиентов это не настоящий 17-значный VIN, а свой идентификатор
// с дефисом (например "JZZ-2JZ"), и без дефиса в маске такой клиент не
// смог бы ввести собственный логин. Кириллические "двойники" (А, В, Е, К,
// М, Н, О, Р, С, Т, У, Х), которые легко напечатать по ошибке при русской
// раскладке, автоматически заменяются на латиницу.
const VIN_CYRILLIC_TO_LATIN = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

function formatVinMask(raw) {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    const mapped = VIN_CYRILLIC_TO_LATIN[ch] || ch;
    if (/[A-Z0-9-]/.test(mapped)) out += mapped;
  }
  return out;
}

function attachVinMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatVinMask(input.value);
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  });
}

attachVinMask(document.getElementById('clientVinInput'));

// ---------- Tabs ----------
const tabsNav = document.querySelector('.tabs');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');

// Блокирует скролл страницы под открытым диалогом ИЛИ мобильным меню вкладок
// (при большом числе вкладок список сам скроллится внутри себя — см. CSS
// .tabs { overflow-y: auto } в мобильной медиа-выборке, а не сайт под ним).
function syncBodyScrollLock() {
  const anyDialogOpen = !!document.querySelector('.dialog-overlay:not(.hidden)');
  const menuOpen = tabsNav.classList.contains('mobile-open');
  document.body.classList.toggle('dialog-open', anyDialogOpen || menuOpen);
}

// Пока меню открыто, кнопка — единственное, что остаётся поверх него, поэтому
// иконка меняется с гамбургера на крестик: иначе непонятно, чем его закрыть.
const MOBILE_MENU_ICON_OPEN = '<line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const MOBILE_MENU_ICON_CLOSE = '<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const mobileMenuBtnIcon = mobileMenuBtn.querySelector('svg');

// Без анимации открытия/закрытия — пробовали (opacity + JS-задержка на
// display:none), но у полноэкранного оверлея это иногда давало лишний кадр
// без фона и воспринималось как "прыжок". Мгновенное переключение надёжнее.
function setMobileMenuState(open) {
  tabsNav.classList.toggle('mobile-open', open);
  mobileMenuBtn.setAttribute('aria-expanded', String(open));
  mobileMenuBtn.title = open ? 'Закрыть меню' : 'Меню';
  mobileMenuBtn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Меню');
  mobileMenuBtnIcon.innerHTML = open ? MOBILE_MENU_ICON_CLOSE : MOBILE_MENU_ICON_OPEN;
  syncBodyScrollLock();
}

function closeMobileMenu() {
  setMobileMenuState(false);
}

mobileMenuBtn.addEventListener('click', () => {
  setMobileMenuState(!tabsNav.classList.contains('mobile-open'));
});

// Клик мимо открытого мобильного меню закрывает его — иначе оно остаётся
// висеть поверх страницы, пока не ткнёшь по вкладке.
document.addEventListener('click', (e) => {
  if (!tabsNav.classList.contains('mobile-open')) return;
  if (tabsNav.contains(e.target) || mobileMenuBtn.contains(e.target)) return;
  closeMobileMenu();
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const target = btn.dataset.tab;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${target}`).classList.add('active');
    if (target === 'requests') loadRequests();
    if (target === 'notes') loadNotes();
    if (target === 'report') { loadReportWeek(); loadReportMasters(); }
    // Поиск клиентов очищается при каждом заходе на вкладку — иначе список
    // остаётся отфильтрованным с прошлого раза, и непонятно, куда делись
    // остальные клиенты.
    if (target === 'clients') {
      document.getElementById('clientSearch').value = '';
      renderClients();
    }
    closeMobileMenu();
  });
});

// ---------- Dialog helpers ----------
// Иначе на телефоне скролл внутри открытого диалога прокручивает сайт под
// ним, а не содержимое самого диалога. Класс снимаем только когда закрыт
// последний диалог — иначе confirm поверх другого окна преждевременно
// разблокирует прокрутку фона.
function openDialog(el) {
  el.classList.remove('hidden');
  syncBodyScrollLock();
}
function closeDialog(el) {
  el.classList.add('hidden');
  syncBodyScrollLock();
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

// Клик мимо окна (по затемнённому фону) намеренно ничего не делает — раньше
// он предлагал закрыть окно с подтверждением, но случайный клик мимо во
// время работы с большой формой (заказ, смета) оказался слишком лёгким
// способом случайно потерять фокус/начать закрывать её. Явное закрытие —
// крестик, Отмена/Сохранить или Escape (см. ниже).

// Escape — нажатие осознанное (в отличие от случайного клика мимо), поэтому
// закрывает окно сразу, без подтверждения: сначала самое верхнее открытое
// диалоговое окно (форму входа так не закрыть), иначе — мобильное меню.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!confirmDialog.classList.contains('hidden')) {
    confirmCancelBtn.click();
    return;
  }
  const openDialogs = Array.from(document.querySelectorAll('.dialog-overlay:not(.hidden)'))
    .filter((ov) => ov.id !== 'loginOverlay' && ov.id !== 'confirmDialog');
  const topDialog = openDialogs[openDialogs.length - 1];
  if (topDialog) {
    closeDialog(topDialog);
    return;
  }
  if (tabsNav.classList.contains('mobile-open')) closeMobileMenu();
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

const REPORT_DELETE_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

// По имени/по алфавиту машин — обычная сортировка A-Я, без даты — новее сверху
// (первым видно, что правили недавно). Пустые значения уходят в конец списка,
// а не перемешиваются с заполненными по правилам localeCompare.
function sortClients(list, sortBy) {
  const arr = list.slice();
  if (sortBy === 'car') {
    arr.sort((a, b) => {
      const carA = [a.car_make, a.car_model].filter(Boolean).join(' ');
      const carB = [b.car_make, b.car_model].filter(Boolean).join(' ');
      if (!carA && !carB) return 0;
      if (!carA) return 1;
      if (!carB) return -1;
      return carA.localeCompare(carB, 'ru');
    });
  } else if (sortBy === 'updated_desc') {
    arr.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  } else if (sortBy === 'updated_asc') {
    arr.sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
  } else {
    arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  }
  return arr;
}

function renderClients() {
  const q = document.getElementById('clientSearch').value.trim().toLowerCase();
  const sortBy = document.getElementById('clientSortSelect').value;
  const body = document.getElementById('clientsBody');
  const filtered = sortClients(
    state.clients.filter((c) => {
      if (!q) return true;
      return [c.name, c.phone, c.plate, c.tag, c.car_make, c.car_model, c.vin].join(' ').toLowerCase().includes(q);
    }),
    sortBy
  );
  body.innerHTML = '';
  document.getElementById('clientsEmpty').classList.toggle('hidden', state.clients.length !== 0);

  filtered.forEach((c) => {
    const tr = document.createElement('tr');
    // Телефон, гос. номер и заметки убраны из таблицы — вся эта информация
    // всё равно есть внутри карточки клиента (строка кликабельна и её
    // открывает), в списке остаются только опознавательные колонки.
    tr.innerHTML = `
      <td class="cell-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
      <td class="cell-car" title="${escapeHtml([c.car_make, c.car_model].filter(Boolean).join(' '))}">${escapeHtml([c.car_make, c.car_model].filter(Boolean).join(' ') || '—')}</td>
      <td class="cell-tag" title="${escapeHtml(c.tag || '')}">${escapeHtml(c.tag || '—')}</td>
      <td class="cell-plate cell-vin-td" title="${escapeHtml(c.vin || '')}">${c.vin ? `<span class="cell-vin"><span class="vin-text">${escapeHtml(c.vin)}</span><button type="button" class="vin-copy-btn" title="Копировать VIN">${COPY_ICON_SVG}</button></span>` : '—'}</td>
      <td class="cell-updated" title="${c.updated_at ? escapeHtml(fmtFullDate(new Date(c.updated_at.replace(' ', 'T') + 'Z'))) : ''}">${c.updated_at ? fmtFullDate(new Date(c.updated_at.replace(' ', 'T') + 'Z')) : '—'}</td>
      <td class="edit-hint">${EDIT_ICON_SVG}</td>
    `;
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

  // Заметка, которую клиент сам оставил в своём кабинете (не смешана с
  // заметкой админа выше — это отдельное поле, только для чтения здесь).
  const clientNotesText = client?.client_notes || '';
  document.getElementById('clientAddedNotes').classList.toggle('hidden', !clientNotesText);
  document.getElementById('clientAddedNotesText').textContent = clientNotesText;

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

// Аналоги (несколько вариантов запчасти на выбор) не считаются в сумме, пока
// не отмечены основным — иначе сумма задваивалась бы на альтернативы клиента.
function sumItems(items) {
  return items.reduce((sum, it) => {
    if (it.analogGroup && !it.analogSelected) return sum;
    if (it.included === false) return sum;
    return sum + (Number(it.price) || 0);
  }, 0);
}

// Артикул/фирма/количество показываем только если заполнены — пустые поля
// не должны засорять ни карточку истории, ни заказ-наряд. includeArticle
// выключается в истории ремонта, где артикул выводится отдельно, со своей
// кнопкой копирования (см. renderRepairBlock). Поставщик сюда не входит —
// он рендерится отдельно, цветным span-ом (см. renderPartLine в buildOrderHtml).
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
    const dateObj = r.date ? new Date(r.date + 'T00:00:00') : null;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head">
        <span class="${r.title ? 'history-title' : 'history-date'}">${r.title ? escapeHtml(r.title) : (dateObj ? fmtFullDate(dateObj) : 'Без даты')}</span>
        <strong class="history-total">${fmtMoney(total)}</strong>
      </div>
      ${r.title && dateObj ? `<span class="history-date">${fmtFullDate(dateObj)}</span>` : ''}
      ${r.mileage ? `<div class="repair-list-sum"><span>Пробег</span><span>${fmtMileage(r.mileage)}</span></div>` : ''}
      ${renderRepairBlock('Запчасти', r.parts, partsSum, 'Сумма запчастей')}
      ${renderRepairBlock('Работы', r.works, worksSum, 'Сумма работ:')}
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
  // Позиции, которые клиент решил не делать, в истории (как и в
  // заказ-наряде) не показываем — они остаются только в редакторе сметы.
  const visibleItems = items.filter((it) => it.included !== false);
  if (!visibleItems.length) return '';
  const lines = visibleItems
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
document.getElementById('clientSortSelect').addEventListener('change', renderClients);
// На мобильных клавиатура иначе нечем закрыть: тапнуть "мимо" часто некуда —
// под полем сразу кнопка и таблица. Клавиша "Готово"/Enter явно снимает фокус.
document.getElementById('clientSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});

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
// Сырая запись, как её вернул сервер, — repairForm не показывает поле
// "поставщик" у запчасти (оно есть только в заказе, см. withReceived), поэтому
// collectRepairRows() не может его вернуть. Храним оригинал, чтобы "Добавить
// в отчёт" не стирало это поле при пересборке данных из формы.
let currentEditingRepairRecord = null;

function sumRowInputs(container) {
  return Array.from(container.querySelectorAll('.repair-row')).reduce((sum, row) => {
    if (row.dataset.analogGroup && row.dataset.analogSelected !== '1') return sum;
    const includeInput = row.querySelector('.row-include');
    if (includeInput && !includeInput.checked) return sum;
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

// Аналоги запчасти (несколько вариантов на выбор — например 3 амортизатора
// разных фирм) — только в заказах (withReceived). Строки одной группы делят
// dataset.analogGroup; ровно одна из них — dataset.analogSelected="1" —
// считается в сумме заказа, остальные показаны для сравнения, но не в счёте.
function refreshAnalogRow(row) {
  const groupId = row.dataset.analogGroup;
  let bar = row.querySelector('.repair-row-analog-bar');
  if (!groupId) {
    row.classList.remove('repair-row-analog');
    if (bar) bar.remove();
    return;
  }
  row.classList.add('repair-row-analog');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'repair-row-analog-bar';
    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'row-analog-main-btn';
    mainBtn.tabIndex = -1;
    const ungroupBtn = document.createElement('button');
    ungroupBtn.type = 'button';
    ungroupBtn.className = 'row-analog-ungroup-btn';
    ungroupBtn.tabIndex = -1;
    ungroupBtn.textContent = 'Убрать из аналогов';
    bar.append(mainBtn, ungroupBtn);
    row.appendChild(bar);
  }
  const mainBtn = bar.querySelector('.row-analog-main-btn');
  const selected = row.dataset.analogSelected === '1';
  mainBtn.classList.toggle('active', selected);
  mainBtn.textContent = selected ? 'Основной вариант ✓' : 'Сделать основным';
}

// После удаления строки или "разгруппировки" в группе может остаться одна
// строка — тогда группа теряет смысл, снимаем её (строка снова считается
// в сумме сама по себе), и если основной была именно удалённая строка,
// отмечаем основной первую оставшуюся.
function cleanupAnalogGroup(container, groupId, onChange) {
  if (!groupId) return;
  const members = Array.from(container.querySelectorAll(`.repair-row[data-analog-group="${groupId}"]`));
  if (members.length === 0) return;
  if (members.length === 1) {
    delete members[0].dataset.analogGroup;
    delete members[0].dataset.analogSelected;
    refreshAnalogRow(members[0]);
  } else if (!members.some((m) => m.dataset.analogSelected === '1')) {
    members[0].dataset.analogSelected = '1';
    members.forEach(refreshAnalogRow);
  }
  onChange();
}

function addAnalogToRow(row, onChange) {
  if (!row.dataset.analogGroup) {
    row.dataset.analogGroup = `ag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    row.dataset.analogSelected = '1';
    refreshAnalogRow(row);
  }
  const newRow = createRepairRow(null, true, onChange, true);
  newRow.dataset.analogGroup = row.dataset.analogGroup;
  newRow.dataset.analogSelected = '';
  refreshAnalogRow(newRow);
  row.insertAdjacentElement('afterend', newRow);
  newRow.querySelector('.row-name').focus();
  onChange();
}

// isPart добавляет поля "Артикул"/"Фирма"/"Кол-во" — они нужны только для запчастей,
// выполненные работы остаются простой парой название/цена. onChange даёт переиспользовать
// строки в другом диалоге (очередь) со своим пересчётом сумм. withReceived добавляет
// переключатель "пришла"/"нет" и аналоги — нужны только в заказе (очередь на
// запчасти): там же отслеживают, что из заказа уже привезли, а что ещё в пути.
// withMaster — только у работ в истории ремонта (не в очереди, там мастера
// нет вообще): переопределение мастера конкретной работы и исключение её из
// суммы отчёта, см. renderReport.
function createRepairRow(item, isPart, onChange = recomputeRepairSums, withReceived = false, withMaster = false) {
  const row = document.createElement('div');
  row.className = 'repair-row' + (isPart ? ' repair-row-part' : '') + (withMaster ? ' repair-row-withmaster' : '');
  if (withReceived && item?.analogGroup) {
    row.dataset.analogGroup = item.analogGroup;
    row.dataset.analogSelected = item.analogSelected ? '1' : '';
  }

  // Позицию можно исключить из заказ-наряда и суммы, не удаляя её из записи —
  // например, клиент из всего списка решил отремонтировать не всё. По
  // умолчанию включена; отсутствие item.included в сохранённых данных тоже
  // считается "включено" (см. normalizeRepairItems на сервере).
  const includeInput = document.createElement('input');
  includeInput.type = 'checkbox';
  includeInput.className = 'row-include';
  includeInput.title = 'Включить в заказ-наряд и сумму';
  includeInput.tabIndex = -1; // как и артикул/поставщик/крестик — отмечается кликом, не по Tab
  includeInput.checked = item?.included !== false;
  const syncExcludedState = () => row.classList.toggle('repair-row-excluded', !includeInput.checked);
  syncExcludedState();
  includeInput.addEventListener('change', () => { syncExcludedState(); onChange(); });

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
  // Сохранённая позиция без цены хранится как 0 (см. normalizeRepairItems на
  // сервере) — при заходе в поле его проще сразу очистить, чем каждый раз
  // стирать "0" вручную перед вводом настоящей цены.
  priceInput.addEventListener('focus', () => {
    if (priceInput.value === '0') priceInput.value = '';
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'row-remove';
  removeBtn.setAttribute('aria-label', 'Удалить строку');
  removeBtn.tabIndex = -1;
  removeBtn.textContent = '×';

  priceInput.addEventListener('input', onChange);
  removeBtn.addEventListener('click', () => {
    const groupId = row.dataset.analogGroup;
    const container = row.parentElement;
    row.remove();
    if (groupId && container) cleanupAnalogGroup(container, groupId, onChange);
    onChange();
  });

  if (isPart) {
    const articleInput = document.createElement('input');
    articleInput.type = 'text';
    articleInput.className = 'row-article mono-input';
    articleInput.placeholder = 'Артикул';
    articleInput.tabIndex = -1;
    articleInput.value = item?.article || '';
    attachCarWordMask(articleInput);

    // Обёртка нужна только чтобы поверх поля показать бейдж статуса из
    // Профит-Лиги (см. refreshProfitLigaStatuses) — сама не участвует в
    // раскладке колонок, просто задаёт точку отсчёта для position:absolute.
    const articleWrap = document.createElement('div');
    articleWrap.className = 'row-article-wrap';
    const plBadge = document.createElement('span');
    plBadge.className = 'pl-status-badge hidden';
    articleWrap.append(articleInput, plBadge);

    const brandInput = document.createElement('input');
    brandInput.type = 'text';
    brandInput.className = 'row-brand';
    brandInput.placeholder = 'Фирма';
    brandInput.value = item?.brand || '';
    attachBrandMask(brandInput);

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'row-qty mono-input';
    qtyInput.placeholder = 'Кол-во';
    qtyInput.min = '0';
    qtyInput.step = '1';
    qtyInput.value = item?.qty ?? '';
    qtyInput.addEventListener('input', onChange);
    // Как и цена ниже — сохранённая позиция без кол-ва хранится как 0.
    qtyInput.addEventListener('focus', () => {
      if (qtyInput.value === '0') qtyInput.value = '';
    });

    // Поставщик — есть у любой запчасти (и в смете, и в заказе), сразу после
    // артикула. Не участвует в табуляции (Tab) — выбирается кликом/тапом,
    // как и сам артикул выше, а не последовательным набором по Tab. Пустой
    // плейсхолдер без текста — колонка уже подписана "Поставщик" в шапке
    // таблицы (см. .repair-rows-header в index.html).
    const supplierSelect = document.createElement('select');
    supplierSelect.className = 'row-supplier mono-input';
    supplierSelect.tabIndex = -1;
    supplierSelect.innerHTML = `
      <option value=""></option>
      <option value="АТС">АТС</option>
      <option value="ПЛ">ПЛ</option>
      <option value="emex">emex</option>
      <option value="Микадо">Микадо</option>
      <option value="Пилот">Пилот</option>
    `;
    supplierSelect.value = item?.supplier || '';

    // Всё — в одну строку-таблицу: галочка, название, цена, кол-во, фирма,
    // артикул, поставщик, (в заказе — ещё на складе/аналог), крестик (порядок
    // колонок задаёт .repair-row-line1 в CSS, одинаковый для каждой строки,
    // поэтому колонки выравниваются как в таблице).
    const line1 = document.createElement('div');
    line1.className = 'repair-row-line1' + (withReceived ? ' repair-row-line1-supply' : '');
    line1.append(includeInput, nameInput, priceInput, qtyInput, brandInput, articleWrap, supplierSelect);

    // "На складе"/"+ аналог" — только для запчастей в заказе (см. withReceived).
    if (withReceived) {
      const receivedBtn = document.createElement('button');
      receivedBtn.type = 'button';
      receivedBtn.className = 'row-received-btn';
      receivedBtn.tabIndex = -1;
      const setReceivedState = (received) => {
        receivedBtn.classList.toggle('active', received);
        receivedBtn.textContent = received ? 'На складе ✓' : 'На складе?';
        receivedBtn.dataset.received = received ? '1' : '';
      };
      setReceivedState(!!item?.received);
      receivedBtn.addEventListener('click', () => setReceivedState(!receivedBtn.classList.contains('active')));

      const analogBtn = document.createElement('button');
      analogBtn.type = 'button';
      analogBtn.className = 'row-analog-add-btn';
      analogBtn.tabIndex = -1;
      analogBtn.title = 'Добавить аналог — ещё один вариант этой запчасти на выбор';
      analogBtn.textContent = '+ аналог';
      analogBtn.addEventListener('click', () => addAnalogToRow(row, onChange));

      line1.append(receivedBtn, analogBtn);
    }

    line1.append(removeBtn);
    row.append(line1);

    if (withReceived && row.dataset.analogGroup) refreshAnalogRow(row);
    if (withReceived) {
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('row-analog-main-btn')) {
          const groupId = row.dataset.analogGroup;
          if (!groupId) return;
          row.parentElement.querySelectorAll(`.repair-row[data-analog-group="${groupId}"]`).forEach((m) => {
            m.dataset.analogSelected = m === row ? '1' : '';
            refreshAnalogRow(m);
          });
          onChange();
        } else if (e.target.classList.contains('row-analog-ungroup-btn')) {
          const groupId = row.dataset.analogGroup;
          delete row.dataset.analogGroup;
          delete row.dataset.analogSelected;
          refreshAnalogRow(row);
          cleanupAnalogGroup(row.parentElement, groupId, onChange);
          onChange();
        }
      });
    }
  } else if (withMaster) {
    const masterInput = document.createElement('input');
    masterInput.type = 'text';
    masterInput.className = 'row-master';
    masterInput.placeholder = 'Мастер (если другой)';
    masterInput.tabIndex = -1;
    masterInput.autocomplete = 'off';
    masterInput.setAttribute('list', 'mastersDatalist');
    masterInput.value = item?.master || '';

    // Кнопка-переключатель, а не чекбокс — так же, как "На складе?" у запчасти
    // в заказе: понятнее с одного взгляда, что именно означает состояние.
    const reportExcludedBtn = document.createElement('button');
    reportExcludedBtn.type = 'button';
    reportExcludedBtn.className = 'row-report-excluded-btn';
    reportExcludedBtn.tabIndex = -1;
    reportExcludedBtn.title = 'Не учитывать эту работу в сумме отчёта — в истории и заказ-наряде клиента останется как есть';
    const setExcludedState = (excluded) => {
      reportExcludedBtn.classList.toggle('active', excluded);
      reportExcludedBtn.textContent = excluded ? 'Не в отчёте' : 'В отчёте';
    };
    setExcludedState(!!item?.reportExcluded);
    reportExcludedBtn.addEventListener('click', () => { setExcludedState(!reportExcludedBtn.classList.contains('active')); onChange(); });

    row.append(includeInput, nameInput, priceInput, masterInput, reportExcludedBtn, removeBtn);
  } else {
    row.append(includeInput, nameInput, priceInput, removeBtn);
  }

  return row;
}

function addRepairRow(container, item, isPart, onChange = recomputeRepairSums, withReceived = false, withMaster = false) {
  container.appendChild(createRepairRow(item, isPart, onChange, withReceived, withMaster));
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
      const masterInput = row.querySelector('.row-master');
      const reportExcludedBtn = row.querySelector('.row-report-excluded-btn');
      if (articleInput) out.article = articleInput.value.trim();
      if (brandInput) out.brand = brandInput.value.trim();
      if (qtyInput) out.qty = Number(qtyInput.value) || 0;
      if (receivedBtn) out.received = receivedBtn.classList.contains('active');
      if (row.dataset.analogGroup) {
        out.analogGroup = row.dataset.analogGroup;
        out.analogSelected = row.dataset.analogSelected === '1';
      }
      if (supplierSelect) out.supplier = supplierSelect.value;
      if (masterInput) out.master = masterInput.value.trim();
      if (reportExcludedBtn) out.reportExcluded = reportExcludedBtn.classList.contains('active');
      const includeInput = row.querySelector('.row-include');
      if (includeInput && !includeInput.checked) out.included = false;
      return out;
    })
    .filter((it) => it.name || it.price);
}

// repairForm рендерит строки запчастей без поля "поставщик" (оно есть только
// в заказе — см. withReceived в createRepairRow), поэтому collectRepairRows()
// не может его вернуть, даже если оно было сохранено раньше (например, запись
// пришла из заказа через "Добавить в список клиентов"). Восстанавливаем
// supplier/received из исходной записи по индексу строки — упорядочение и
// количество строк совпадают, пока позиции не добавляли/не удаляли в этом
// открытии диалога.
function restoreUnexposedPartFields(parts, rawParts) {
  if (!Array.isArray(rawParts) || rawParts.length !== parts.length) return parts;
  return parts.map((p, i) => {
    const raw = rawParts[i];
    if (!raw) return p;
    const merged = { ...p };
    if (raw.supplier && merged.supplier === undefined) merged.supplier = raw.supplier;
    if (raw.received !== undefined && merged.received === undefined) merged.received = raw.received;
    return merged;
  });
}

document.getElementById('addWorkRowBtn').addEventListener('click', () => addRepairRow(worksRowsEl, null, false, recomputeRepairSums, false, true));
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
  currentEditingRepairRecord = record || null;
  pendingApptForRepair = null; // по умолчанию — обычный поток из карточки клиента
  document.getElementById('repairDialogTitle').textContent = record ? 'Запись ремонта' : 'Новая запись ремонта';
  deleteRepairBtn.classList.toggle('hidden', !record);
  document.getElementById('moveRepairToQueueBtn').classList.toggle('hidden', !record);
  repairForm.reset();
  loadMastersDatalist();

  worksRowsEl.innerHTML = '';
  partsRowsEl.innerHTML = '';
  const works = record?.works?.length ? record.works : [null];
  const parts = record?.parts?.length ? record.parts : [null];
  works.forEach((w) => addRepairRow(worksRowsEl, w, false, recomputeRepairSums, false, true));
  parts.forEach((p) => addRepairRow(partsRowsEl, p, true));

  repairForm.elements.title.value = record ? (record.title || '') : '';
  repairForm.elements.date.value = record ? (record.date || '') : '';
  setDateMin(repairForm.elements.date, record?.date);
  repairForm.elements.mileage.value = record && record.mileage ? record.mileage : '';
  repairForm.elements.notes.value = record ? (record.notes || '') : '';
  repairForm.elements.master.value = record ? (record.master || '') : '';
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
    const dateObj = r.date ? new Date(r.date + 'T00:00:00') : null;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head">
        <span class="${r.title ? 'history-title' : 'history-date'}">${r.title ? escapeHtml(r.title) : (dateObj ? fmtFullDate(dateObj) : 'Без даты')}</span>
        <strong class="history-total">${fmtMoney(total)}</strong>
      </div>
      ${r.title && dateObj ? `<span class="history-date">${fmtFullDate(dateObj)}</span>` : ''}
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
    // Поля в форме нет (срок поставки актуален только для заказов, см. queueForm) —
    // сохраняем как было в записи, а не затираем пустым, если запись пришла из заказа.
    parts_eta: currentEditingRepairRecord?.parts_eta || '',
    advance: advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0,
    works: collectRepairRows(worksRowsEl),
    parts: collectRepairRows(partsRowsEl),
    master: repairForm.elements.master.value,
    // Поля в форме нет (убирается отдельной кнопкой в списке отчёта) —
    // сохраняем как было, а не сбрасываем при обычном редактировании записи.
    report_hidden: currentEditingRepairRecord?.report_hidden || false,
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

// Перенос записи ремонта в «Заказы» — обратное действие к "Добавить в список
// клиентов" у заказа. Заводит заказ с теми же позициями; сама запись в
// истории ремонта остаётся как была (это копия, не перемещение) — так
// удобнее, если позиции нужно и дальше отслеживать как заказ (на складе/
// поставщик), и не терять сам факт ремонта в истории клиента. Мастер не
// переносится — у заказов нет такого поля (см. миграцию master в
// repair_records — она только там).
document.getElementById('moveRepairToQueueBtn').addEventListener('click', async () => {
  if (!editingRepairId || !currentEditingRepairRecord) return;
  const client = state.clients.find((c) => c.id === currentEditingRepairRecord.client_id);
  if (!client) {
    showToast('Не удалось определить клиента записи', true);
    return;
  }
  if (!(await showConfirm('Перенести запись в «Заказы»? В истории ремонта она тоже останется.', { confirmLabel: 'Перенести', danger: false }))) return;
  try {
    await api('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        name: client.name,
        phone: client.phone,
        car_make: client.car_make,
        car_model: client.car_model,
        plate: client.plate,
        vin: client.vin,
        title: repairForm.elements.title.value,
        date: repairForm.elements.date.value,
        mileage: repairForm.elements.mileage.value,
        notes: repairForm.elements.notes.value,
        advance: advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0,
        works: collectRepairRows(worksRowsEl),
        parts: collectRepairRows(partsRowsEl),
      }),
    });
    showToast('Запись перенесена в «Заказы»');
    closeDialog(repairDialog);
    await loadQueue();
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
  // Позиции, снятые галочкой "включить", в заказ-наряд не попадают вовсе —
  // они остаются в сохранённой смете, но клиент их в документе не увидит.
  const works = collectRepairRows(worksRowsEl).filter((it) => it.included !== false);
  const parts = collectRepairRows(partsRowsEl).filter((it) => it.included !== false);
  const worksSum = sumItems(works);
  const partsSum = sumItems(parts);
  const advance = advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0;
  return {
    clientName: ctx.clientName,
    carLine: ctx.carLine,
    mileage: repairForm.elements.mileage.value,
    // Поля в форме нет (см. removed parts_eta input) — если запись пришла
    // из заказа, там уже мог быть указан срок, показываем как есть.
    partsEta: currentEditingRepairRecord?.parts_eta || '',
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

// Фирменные цвета поставщиков — берутся с их официальных сайтов (логотип/акцентный
// цвет), чтобы поставщика можно было узнать по цвету с одного взгляда в отчёте.
// Только для заказ-наряда, открытого из вкладки «Отчёт» (см. showSupplier ниже).
const SUPPLIER_COLORS = {
  'ПЛ': '#009747', // pr-lg.ru — зелёный из SVG-логотипа
  emex: '#FBAF33', // emex.ru — оранжевый из логотипа (сам сайт блокирует автозапросы)
  'АТС': '#FF111A', // ats-auto.ru — красный из их логотипа
  'Микадо': '#32A5EB', // mikado-parts.ru — акцентный синий (кнопки/ссылки на сайте)
};

// showSupplier — включается только для заказ-наряда, открытого из вкладки
// «Отчёт» (см. renderReport); в обычной смете/заказе поставщик клиенту не показывается.
function buildOrderHtml(order, { showSupplier = false } = {}) {
  // Мастер у конкретной работы (переопределяет мастера всей записи) виден
  // только в отчёте, как и поставщик у запчасти ниже — клиенту эта разбивка
  // не показывается. Не в отчёте — тоже только справочная пометка тут же.
  const workLines = order.works
    .map((w) => {
      const masterTag = showSupplier && w.master ? ` <span class="order-line-meta">(${escapeHtml(w.master)})</span>` : '';
      const excludedTag = showSupplier && w.reportExcluded ? ' <span class="order-line-alt-tag">не в отчёте</span>' : '';
      return `<div class="order-line"><span>${escapeHtml(w.name)}${masterTag}${excludedTag}</span><span>${fmtMoney(w.price)}</span></div>`;
    })
    .join('');
  // Аналоги (несколько вариантов одной запчасти на выбор) рисуем рамкой с
  // отступом вокруг всей группы — не выбранный вариант приглушён и подписан
  // "аналог", чтобы не спутать с отдельной позицией в счёте.
  const renderPartLine = (p, isAlt) => {
    // Артикул/фирма/кол-во — обычный экранированный текст; поставщик — отдельный
    // цветной span поверх, поэтому собираем HTML-фрагменты, а не одну строку.
    const meta = itemMeta(p);
    const metaHtml = meta ? escapeHtml(meta) : '';
    const supplierColor = p.supplier && SUPPLIER_COLORS[p.supplier];
    const supplierHtml = showSupplier && p.supplier
      ? `<span class="order-line-supplier"${supplierColor ? ` style="color:${supplierColor}"` : ''}>${escapeHtml(p.supplier)}</span>`
      : '';
    const metaFragments = [metaHtml, supplierHtml].filter(Boolean);
    const metaBlock = metaFragments.length ? ` <span class="order-line-meta">(${metaFragments.join(', ')})</span>` : '';
    const lineTotal = Number(p.price) || 0;
    return `<div class="order-line${isAlt ? ' order-line-alt' : ''}"><span>${escapeHtml(p.name)}${metaBlock}${isAlt ? ' <span class="order-line-alt-tag">аналог</span>' : ''}</span><span>${fmtMoney(lineTotal)}</span></div>`;
  };
  const seenParts = new Set();
  const partLines = order.parts
    .map((p, i) => {
      if (seenParts.has(i)) return '';
      if (p.analogGroup) {
        const members = order.parts.map((m, mi) => ({ ...m, __i: mi })).filter((m) => m.analogGroup === p.analogGroup);
        members.forEach((m) => seenParts.add(m.__i));
        return `<div class="order-analog-group">${members.map((m) => renderPartLine(m, !m.analogSelected)).join('')}</div>`;
      }
      return renderPartLine(p, false);
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
      ${showSupplier && order.master ? `<div class="order-meta-row"><span>Мастер</span><strong>${escapeHtml(order.master)}</strong></div>` : ''}
    </div>
    <div class="order-sep"></div>
    ${order.title ? `<h3 class="order-title">${escapeHtml(order.title)}</h3>` : ''}
    ${order.date ? `<div class="order-date">Дата ремонта: ${fmtFullDate(new Date(order.date + 'T00:00:00'))}</div>` : ''}
    ${order.parts.length ? `<div class="order-block"><div class="order-block-title">Стоимость запчастей</div>${partLines}<div class="order-line order-line-sum"><span>Сумма запчастей</span><span>${fmtMoney(order.partsSum)}</span></div>${order.partsEta && !showSupplier ? `<div class="order-meta-row"><span>Срок поставки запчастей</span><strong>${escapeHtml(order.partsEta)}</strong></div>` : ''}</div>` : ''}
    ${order.works.length ? `<div class="order-block"><div class="order-block-title">Стоимость работ</div>${workLines}<div class="order-line order-line-sum"><span>Сумма работ</span><span>${fmtMoney(order.worksSum)}</span></div></div>` : ''}
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
// Откуда открыт текущий заказ-наряд — 'repair' (смета клиента/отчёт) или
// 'queue' (заказ в очереди); нужно кнопке "Добавить в отчёт" ниже, чтобы
// понять, куда и как сохранять запись.
let currentOrderContext = null;
// true — заказ-наряд открыт из вкладки «Отчёт» (см. renderReport и
// buildOrderHtml/showSupplier). renderOrderToCanvas ниже не получает опций,
// поэтому дублируем флаг сюда — иначе картинка (Копировать/Скачать) не знала
// бы, что срок поставки запчастей в этом случае показывать не нужно.
let currentOrderIsReportView = false;
// Полные (нефильтрованные) данные текущего заказ-наряда — то, что реально
// уйдёт в repair_records при "Добавить в отчёт". В отличие от currentOrderData
// (который для показа клиенту прячет невыбранные аналоги и снятые галочкой
// позиции), здесь сохраняем всё как есть, чтобы такие позиции не терялись
// из истории при перезаписи даты.
let currentOrderRecordData = null;

document.getElementById('sendToClientBtn').addEventListener('click', () => {
  const order = buildOrderData();
  currentOrderData = order;
  currentOrderContext = 'repair';
  currentOrderIsReportView = false;
  currentOrderRecordData = {
    title: repairForm.elements.title.value,
    mileage: repairForm.elements.mileage.value,
    notes: repairForm.elements.notes.value,
    parts_eta: currentEditingRepairRecord?.parts_eta || '',
    advance: advanceEnabled ? (Number(document.getElementById('advanceAmountInput').value) || 0) : 0,
    works: collectRepairRows(worksRowsEl),
    parts: restoreUnexposedPartFields(collectRepairRows(partsRowsEl), currentEditingRepairRecord?.parts),
    master: repairForm.elements.master.value,
  };
  document.getElementById('orderAddToReportBtn').classList.remove('hidden');
  document.getElementById('orderAddToHistoryBtn').classList.add('hidden');
  document.getElementById('orderAddToHistoryPanel').classList.add('hidden');
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
  const scale = 3; // рисуем крупнее, чтобы текст не был мыльным при пересылке
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
    ctx.fillText(`Дата ремонта: ${fmtFullDate(new Date(order.date + 'T00:00:00'))}`, pad, y);
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

    // indent сдвигает строку внутрь (для аналогов — рамка вокруг группы,
    // muted приглушает не выбранный вариант, чтобы не путать со строкой,
    // которая реально входит в счёт.
    function drawItemLine(it, indent, muted) {
      const meta = itemMeta(it);
      const lineTotal = Number(it.price) || 0;
      const priceText = fmtMoney(lineTotal);
      const leftX = pad + indent;
      const rightX = width - pad - indent;
      const lineW = contentW - indent * 2;
      const nameColor = muted ? C.textMuted : C.text;
      // Не выбранный вариант аналога подписываем прямо в строке — иначе на
      // картинке, отправленной клиенту, приглушённый цвет мог остаться
      // незамеченным и цену приняли бы за отдельную позицию в счёте.
      const suffix = [meta, muted ? 'аналог' : ''].filter(Boolean).join(' · ');
      const hasSuffix = !!suffix;

      ctx.font = `16px ${ORDER_IMG.fontBody}`;
      const priceW = ctx.measureText(priceText).width;
      const availW = lineW - priceW - 12;
      const nameW = ctx.measureText(it.name).width;
      const metaText = hasSuffix ? ` (${suffix})` : '';
      ctx.font = `14px ${ORDER_IMG.fontBody}`;
      const metaW = hasSuffix ? ctx.measureText(metaText).width : 0;

      if (!hasSuffix || nameW + metaW <= availW) {
        // Помещается в одну строку целиком — рисуем название и мету рядом
        // (как в HTML-версии наряда), а не отдельной строкой ниже.
        ctx.font = `16px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = nameColor;
        ctx.textAlign = 'left';
        ctx.fillText(it.name, leftX, y);
        if (hasSuffix) {
          ctx.font = `14px ${ORDER_IMG.fontBody}`;
          ctx.fillStyle = C.textMuted;
          ctx.fillText(metaText, leftX + nameW, y);
        }
        // Иначе цена наследует приглушённый цвет меты, нарисованной строчкой
        // выше, и запчасти с "(мета)" оказываются другого цвета, чем работы.
        ctx.font = `16px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = nameColor;
        ctx.textAlign = 'right';
        ctx.fillText(priceText, rightX, y);
        ctx.textAlign = 'left';
        y += 20;
      } else {
        // Не влезает целиком — переносим название, мету оставляем отдельной строкой.
        ctx.font = `16px ${ORDER_IMG.fontBody}`;
        const nameLines = wrapCanvasText(ctx, it.name, availW);
        ctx.fillStyle = nameColor;
        ctx.textAlign = 'left';
        ctx.fillText(nameLines[0], leftX, y);
        ctx.textAlign = 'right';
        ctx.fillText(priceText, rightX, y);
        ctx.textAlign = 'left';
        y += 20;
        for (let i = 1; i < nameLines.length; i++) {
          ctx.fillText(nameLines[i], leftX, y);
          y += 20;
        }
        ctx.font = `14px ${ORDER_IMG.fontBody}`;
        ctx.fillStyle = C.textMuted;
        ctx.fillText(suffix, leftX, y);
        y += 19;
      }
    }

    // Аналоги (несколько вариантов одной запчасти на выбор) рисуем в общей
    // рамке с отступом; в сумму блока идёт только отмеченный "основным" —
    // остальные показаны для сравнения цены, но не задваивают итог.
    const seenAnalog = new Set();
    items.forEach((it, idx) => {
      if (seenAnalog.has(idx)) return;
      if (it.analogGroup) {
        const members = items.map((m, mi) => ({ ...m, __i: mi })).filter((m) => m.analogGroup === it.analogGroup);
        members.forEach((m) => seenAnalog.add(m.__i));
        const boxTop = y - 16;
        members.forEach((m) => {
          drawItemLine(m, 10, !m.analogSelected);
          if (m.analogSelected) sum += Number(m.price) || 0;
        });
        const boxBottom = y - 4;
        ctx.strokeStyle = C.border;
        ctx.setLineDash([3, 3]);
        roundRectPath(ctx, pad - 4, boxTop, contentW + 8, boxBottom - boxTop, 4);
        ctx.stroke();
        ctx.setLineDash([]);
        y += 6;
      } else {
        drawItemLine(it, 0, false);
        sum += Number(it.price) || 0;
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

  block('Стоимость запчастей', order.parts, 'Сумма запчастей');
  if (order.partsEta && order.parts.length && !currentOrderIsReportView) row('Срок поставки запчастей', order.partsEta);
  block('Стоимость работ', order.works, 'Сумма работ:');

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

// В мессенджерах (WhatsApp/Telegram и т.п.) картинка, вставленная из буфера
// обмена или отправленная как "фото", обычно пережимается — если отправить
// тем же файлом как документ/файл, сжатия не будет. Кнопка ниже сразу
// скачивает файл, без попытки скопировать в буфер.
document.getElementById('orderDownloadFileBtn').addEventListener('click', async () => {
  try {
    const canvas = await renderOrderToCanvas();
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Не удалось подготовить изображение', true);
        return;
      }
      downloadOrderImage(blob);
      showToast('Картинка сохранена файлом');
    }, 'image/png');
  } catch (err) {
    showToast('Не удалось подготовить изображение', true);
  }
});

// ---------- Печать заказ-наряда как A4 (PDF через системный диалог печати) ----------
// Без внешних PDF-библиотек: копируем уже готовый HTML в отдельный блок —
// прямой ребёнок body (см. #printArea) — и печатаем его через @media print
// в style.css. Пользователь сохраняет как PDF через "Сохранить как PDF" в
// диалоге печати браузера — работает на любом устройстве без скачивания приложений.
document.getElementById('orderPrintBtn').addEventListener('click', () => {
  const printArea = document.getElementById('printArea');
  printArea.className = 'order-doc';
  printArea.innerHTML = document.getElementById('orderContent').innerHTML;
  // Заголовок вкладки — единственная часть браузерного колонтитула печати,
  // которую можно убрать со страницы; адрес и дату печати браузер добавляет
  // сам, веб-страница на это повлиять не может (убираются целиком галочкой
  // "Верхние и нижние колонтитулы" в диалоге печати, в "Ещё настройках").
  const originalTitle = document.title;
  document.title = ' ';
  window.print();
  document.title = originalTitle;
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
// Тег(в нижнем регистре) → список позиций у Профит-Лиги (см. /api/profitliga/status).
// Заполняется в фоне отдельно от loadQueue, чтобы список заказов не ждал их API —
// после загрузки список перерисовывается уже со статусом "Отказ" по артикулу.
let plStatusMap = {};

async function loadQueue() {
  queueItems = await api('/api/queue');
  renderQueue();
  api('/api/profitliga/status')
    .then((map) => { plStatusMap = map; renderQueue(); })
    .catch(() => {});
}

function renderQueue() {
  const list = document.getElementById('queueList');
  const empty = document.getElementById('queueEmpty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', queueItems.length !== 0);

  const queueBadge = document.getElementById('queueBadge');
  queueBadge.textContent = String(queueItems.length);
  queueBadge.classList.toggle('hidden', queueItems.length === 0);

  queueItems.forEach((q) => {
    const carLine = [q.car_make, q.car_model].filter(Boolean).join(' ');
    const partsWithName = (q.parts || []).filter((p) => p.name);
    // Пока в заказе есть хоть одна запчасть, статус считаем по отметкам "пришла" на них,
    // а не по ручному переключателю — так бейдж всегда отражает реальную картину.
    const autoStatus = partsWithName.length > 0;
    const allReceived = autoStatus && partsWithName.every((p) => p.received);
    const status = autoStatus ? (allReceived ? 'arrived' : 'waiting') : (q.status === 'arrived' ? 'arrived' : 'waiting');
    const formatPart = (p) => (p.supplier ? `${p.name} (${p.supplier})` : p.name);
    // "Отказ" — по совпадению артикула с проблемной позицией у ПЛ под тегом
    // заказа (та же логика, что и бейдж в открытом заказе, см.
    // refreshProfitLigaStatuses) — считается только для ещё не полученных.
    const tag = (q.tag || '').trim().toLowerCase();
    const plProducts = tag ? plStatusMap[tag] : null;
    const isProblem = (p) => {
      if (!plProducts || !p.article) return false;
      const key = normalizePlArticle(p.article);
      if (!key) return false;
      const match = plProducts.find((prod) => normalizePlArticle(prod.article) === key);
      return match?.category === 'problem';
    };
    const receivedNames = partsWithName.filter((p) => p.received).map(formatPart);
    const problemNames = partsWithName.filter((p) => !p.received && isProblem(p)).map(formatPart);
    const pendingNames = partsWithName.filter((p) => !p.received && !isProblem(p)).map(formatPart);
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
      ${problemNames.length ? `<div class="queue-parts-problem">Отказ: ${escapeHtml(problemNames.join(', '))}</div>` : ''}
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

// ---------- Аккордеон "Данные клиента и автомобиля" ----------
const queueClientFields = document.getElementById('queueClientFields');
const queueClientFieldsToggleBtn = document.getElementById('queueClientFieldsToggleBtn');
function setQueueClientFieldsOpen(open) {
  queueClientFields.classList.toggle('hidden', !open);
  queueClientFieldsToggleBtn.setAttribute('aria-expanded', String(open));
  queueClientFieldsToggleBtn.classList.toggle('accordion-open', open);
}
queueClientFieldsToggleBtn.addEventListener('click', () => {
  setQueueClientFieldsOpen(queueClientFields.classList.contains('hidden'));
});
// Пока аккордеон свёрнут, обязательные поля внутри (Имя, Дата) невидимы и не
// проходят браузерную валидацию при попытке отправить форму — раскрываем
// аккордеон, чтобы пользователь увидел, что именно не заполнено.
queueClientFields.querySelectorAll('[required]').forEach((el) => {
  el.addEventListener('invalid', () => setQueueClientFieldsOpen(true));
});

// Позволяет подтянуть данные уже существующего клиента вместо ручного ввода —
// заказ всё равно хранит свою копию полей (car_make/phone/...), клиент не привязывается по id.
function fillQueueClientSelect() {
  const sel = document.getElementById('queueClientSelect');
  const options = state.clients
    .map((c) => {
      const car = [c.car_make, c.car_model].filter(Boolean).join(' ');
      // data-tag — тег не показываем в самом пункте списка (не захламляем),
      // но поиск в client-picker (см. enhanceClientSelect) должен его находить.
      return `<option value="${c.id}" data-tag="${escapeHtml(c.tag || '')}">${escapeHtml(c.name)}${car ? ' — ' + escapeHtml(car) : ''}</option>`;
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
  queueForm.elements.tag.value = client.tag || '';
  queueForm.elements.vin.value = client.vin || '';
});
enhanceClientSelect(document.getElementById('queueClientSelect'), '— новый клиент (не из базы) —');

// Артикул сравнивается без пробелов/дефисов и без учёта регистра — см.
// normalizeArticle в server.js (та же логика, продублирована здесь: фронт и
// бэк — разные рантаймы, общего модуля нет).
function normalizePlArticle(s) {
  return String(s || '').toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
}

const PL_STATUS_CLASSES = ['pl-status-transit', 'pl-status-delivered', 'pl-status-problem'];

// Подсвечивает поле "Тег" открытого заказа (общая сводка по всем позициям ПЛ
// под этим тегом) и поля "Артикул" каждой запчасти — по факту совпадения
// артикула с конкретной позицией у Профит-Лиги (см. /api/profitliga/status).
// Само совпадение тега недостаточно для конкретной запчасти: у одного тега
// может быть несколько позиций, и только артикул однозначно определяет,
// какая именно пришла. Это справочная подсветка, на сохранённые данные не
// влияет — авто-отмечание "на складе" делает кнопка "Проверить приход (ПЛ)"
// (см. ниже, /api/profitliga/sync), которая сверяет так же, по артикулу.
async function refreshProfitLigaStatuses() {
  const tagInput = queueForm.elements.tag;
  const articleInputs = Array.from(document.querySelectorAll('#queuePartsRows .row-article'));
  tagInput?.classList.remove(...PL_STATUS_CLASSES);
  if (tagInput) tagInput.title = '';
  articleInputs.forEach((el) => {
    el.classList.remove(...PL_STATUS_CLASSES);
    el.title = '';
    el.parentElement?.querySelector('.pl-status-badge')?.classList.add('hidden');
  });

  const tag = tagInput?.value.trim().toLowerCase();
  if (!tag) return;
  try {
    const map = await api('/api/profitliga/status');
    const products = map[tag];
    if (!products || !products.length) return;

    const overall = products.every((p) => p.category === 'delivered')
      ? 'delivered'
      : products.some((p) => p.category === 'problem')
        ? 'problem'
        : 'transit';
    tagInput.classList.add(`pl-status-${overall}`);
    tagInput.title = `Позиций у Профит-Лиги по этому тегу: ${products.length}`;

    articleInputs.forEach((articleInput) => {
      const key = normalizePlArticle(articleInput.value);
      if (!key) return;
      const match = products.find((p) => normalizePlArticle(p.article) === key);
      if (match) {
        articleInput.classList.add(`pl-status-${match.category}`);
        articleInput.title = `${match.status} (обновлено ${match.status_update})`;
        // Просто цветной рамки мало для проблемного статуса (отменён,
        // возврат, рекламация и т.п.) — это нужно заметить сразу, без
        // наведения мыши, поэтому дублируем явной подписью на поле.
        if (match.category === 'problem') {
          const badge = articleInput.parentElement?.querySelector('.pl-status-badge');
          if (badge) {
            badge.textContent = 'Отказ';
            badge.classList.remove('hidden');
          }
        }
      }
    });
  } catch {
    // Подсветка статуса необязательна — молча пропускаем при ошибке запроса.
  }
}

// Тег и артикул сверяются по факту редактирования, а не только при открытии
// диалога — иначе после правки артикула подсветка осталась бы от старого
// значения. blur не всплывает — слушаем на фазе перехвата (capture).
queueForm.elements.tag?.addEventListener('blur', refreshProfitLigaStatuses);
queuePartsRowsEl.addEventListener(
  'blur',
  (e) => { if (e.target.classList.contains('row-article')) refreshProfitLigaStatuses(); },
  true
);

function openQueueDialog(entry) {
  editingQueueId = entry ? entry.id : null;
  document.getElementById('queueDialogTitle').textContent = entry ? 'Заказ' : 'Новый заказ';
  deleteQueueBtn.classList.toggle('hidden', !entry);
  queueForm.reset();
  fillQueueClientSelect();
  setQueueClientFieldsOpen(false);

  if (entry) {
    for (const [k, v] of Object.entries(entry)) {
      if (queueForm.elements[k]) queueForm.elements[k].value = v || '';
    }
  } else {
    queueForm.elements.parts_eta.value = 'до 5 рабочих дней';
  }
  setDateMin(queueForm.elements.date, entry?.date);
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
  refreshProfitLigaStatuses();
}

document.getElementById('newQueueBtn').addEventListener('click', () => openQueueDialog(null));

// Сверка комментариев запчастей с заказами на pr-lg.ru — сервер сам находит
// совпадения и отмечает позиции "на складе", если у Профит-Лиги они уже
// доставлены (см. /api/profitliga/sync). Ничего не отправляем на их сайт,
// только читаем статус их же API-ключом.
document.getElementById('checkProfitLigaBtn').addEventListener('click', async () => {
  const btn = document.getElementById('checkProfitLigaBtn');
  btn.disabled = true;
  try {
    const { updated } = await api('/api/profitliga/sync', { method: 'POST' });
    showToast(updated ? `Обновлено заказов: ${updated}` : 'Новых поступлений не найдено');
    await loadQueue();
    if (!queueDialog.classList.contains('hidden')) refreshProfitLigaStatuses();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

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
      // Окно остаётся открытым после сохранения (см. ниже) — если не запомнить
      // id нового заказа, повторное "Сохранить" создало бы дубликат вместо
      // обновления той же записи.
      const created = await api('/api/queue', { method: 'POST', body: JSON.stringify(data) });
      editingQueueId = created.id;
      document.getElementById('queueDialogTitle').textContent = 'Заказ';
      deleteQueueBtn.classList.remove('hidden');
      showToast('Заказ добавлен');
    }
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
    // Если VIN указан и уже есть у существующего клиента — это та же машина,
    // не заводим дубль в базе, а добавляем смету к уже существующей карточке.
    // Список клиентов обновляем прямо перед проверкой — если вкладка была
    // открыта долго, state.clients мог устареть.
    await loadClients();
    const vin = queueForm.elements.vin.value.trim().toUpperCase();
    const existingClient = vin ? state.clients.find((c) => c.vin === vin) : null;
    const targetClient = existingClient || await api('/api/clients', {
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

    // В постоянную историю ремонта аналоги, которые клиент не выбрал, и
    // позиции, которые клиент решил не делать (не включены), не переносим —
    // решение уже принято, лишнее там не нужно.
    const works = collectRepairRows(queueWorksRowsEl).filter((w) => w.included !== false);
    const parts = collectRepairRows(queuePartsRowsEl)
      .filter((p) => p.included !== false)
      .filter((p) => !p.analogGroup || p.analogSelected)
      .map(({ analogGroup, analogSelected, ...rest }) => rest);
    const title = queueForm.elements.title.value;
    if (works.length || parts.length || title.trim()) {
      await api(`/api/clients/${targetClient.id}/repairs`, {
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

    showToast(existingClient ? 'Смета добавлена существующему клиенту' : 'Клиент добавлен в базу');
    closeDialog(queueDialog);
    await loadClients();
    await loadQueue();
  } catch (err) {
    showToast(err.message, true);
  }
});

function buildQueueOrderData() {
  // Позиции, снятые галочкой "включить", в заказ-наряд не попадают вовсе —
  // они остаются в сохранённом заказе, но клиент их в документе не увидит.
  const works = collectRepairRows(queueWorksRowsEl).filter((it) => it.included !== false);
  const parts = collectRepairRows(queuePartsRowsEl).filter((it) => it.included !== false);
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
  currentOrderContext = 'queue';
  currentOrderIsReportView = false;
  // Как при "Добавить в список клиентов" — аналоги, которые не выбраны
  // основными, и позиции, снятые галочкой, в постоянную историю не переносим.
  const works = collectRepairRows(queueWorksRowsEl).filter((w) => w.included !== false);
  const parts = collectRepairRows(queuePartsRowsEl)
    .filter((p) => p.included !== false)
    .filter((p) => !p.analogGroup || p.analogSelected)
    .map(({ analogGroup, analogSelected, ...rest }) => rest);
  currentOrderRecordData = {
    title: queueForm.elements.title.value,
    notes: queueForm.elements.notes.value,
    parts_eta: queueForm.elements.parts_eta.value,
    advance: queueAdvanceEnabled ? (Number(document.getElementById('queueAdvanceAmountInput').value) || 0) : 0,
    works,
    parts,
  };
  document.getElementById('orderAddToReportBtn').classList.remove('hidden');
  document.getElementById('orderAddToHistoryBtn').classList.add('hidden');
  document.getElementById('orderAddToHistoryPanel').classList.add('hidden');
  document.getElementById('orderContent').innerHTML = buildOrderHtml(order);
  openDialog(orderDialog);
});

// ---------- "Добавить в отчёт" (см. вкладку «Отчёт») ----------
// input[type=week] капризно поддерживается браузерами (в части из них нет
// пикера, значение приходится набирать текстом в формате "YYYY-Www" — на
// практике им невозможно пользоваться). Вместо этого — обычный date-picker:
// пользователь выбирает конкретный день, эта же дата и сохраняется у записи
// как есть (её неделя в отчёте определяется этой датой через startOfWeek —
// см. listRepairRecordsByDateRange на сервере, отдельно округлять её тут не
// нужно и не надо: раньше выбранный день молча заменялся на понедельник его
// недели, из-за чего реальная дата ремонта терялась).
document.getElementById('orderAddToReportBtn').addEventListener('click', () => {
  document.getElementById('orderAddToReportPanel').classList.toggle('hidden');
});

// ---------- "Добавить в историю клиента" (см. вкладку «ТО») ----------
// Заказ-наряд из ТО не привязан ни к клиенту, ни к записи ремонта (см.
// toArticleOrderBtn) — тут нужно сначала выбрать, кому именно эта замена
// масла/фильтров засчитывается, прежде чем сохранять.
function fillOrderHistoryClientSelect() {
  const sel = document.getElementById('orderHistoryClientSelect');
  const options = state.clients
    .map((c) => {
      const car = [c.car_make, c.car_model].filter(Boolean).join(' ');
      return `<option value="${c.id}" data-tag="${escapeHtml(c.tag || '')}">${escapeHtml(c.name)}${car ? ' — ' + escapeHtml(car) : ''}</option>`;
    })
    .join('');
  sel.innerHTML = `<option value="">— выберите клиента —</option>${options}`;
}
enhanceClientSelect(document.getElementById('orderHistoryClientSelect'), '— выберите клиента —');

document.getElementById('orderAddToHistoryBtn').addEventListener('click', () => {
  document.getElementById('orderAddToHistoryPanel').classList.toggle('hidden');
});

document.getElementById('orderAddToHistoryConfirmBtn').addEventListener('click', async () => {
  const clientId = Number(document.getElementById('orderHistoryClientSelect').value);
  const date = document.getElementById('orderHistoryDateInput').value;
  if (!clientId) { showToast('Выберите клиента', true); return; }
  if (!date) { showToast('Выберите дату', true); return; }
  try {
    await api(`/api/clients/${clientId}/repairs`, {
      method: 'POST',
      body: JSON.stringify({ title: 'ТО-Замена масла ДВС', date, works: [], parts: currentOrderData.parts }),
    });
    showToast('Добавлено в историю клиента');
    document.getElementById('orderAddToHistoryPanel').classList.add('hidden');
    document.getElementById('orderHistoryClientSelect').value = '';
    document.getElementById('orderHistoryDateInput').value = '';
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('orderAddToReportConfirmBtn').addEventListener('click', async () => {
  const date = document.getElementById('orderReportDateInput').value;
  if (!date) {
    showToast('Выберите дату', true);
    return;
  }
  try {
    if (currentOrderContext === 'repair') {
      const data = { ...currentOrderRecordData, date };
      if (editingRepairId) {
        // Запись уже существует в базе — клиент ей давно назначен, доп.
        // разрешение клиента (в т.ч. создание нового walk-in) тут не нужно.
        await api(`/api/repairs/${editingRepairId}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        const clientId = pendingApptForRepair ? await resolveClientForAppt(pendingApptForRepair) : historyClientId;
        if (!clientId) throw new Error('Не удалось определить клиента для записи');
        const created = await api(`/api/clients/${clientId}/repairs`, { method: 'POST', body: JSON.stringify(data) });
        editingRepairId = created.id;
      }
      if (historyClientId) await loadClientHistory(historyClientId);
    } else if (currentOrderContext === 'queue') {
      // Заказ в очереди ещё не привязан к настоящему клиенту (queue_entries
      // клиента не хранит) — заводим его, как при "Добавить в список
      // клиентов", и сразу создаём запись ремонта с выбранной датой.
      const name = queueForm.elements.name.value.trim();
      if (!name) {
        showToast('Укажите имя клиента', true);
        return;
      }
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
      await api(`/api/clients/${newClient.id}/repairs`, {
        method: 'POST',
        body: JSON.stringify({ ...currentOrderRecordData, date }),
      });
      await loadClients();
    } else {
      throw new Error('Неизвестный источник заказ-наряда');
    }
    showToast('Добавлено в отчёт');
    document.getElementById('orderAddToReportPanel').classList.add('hidden');
    document.getElementById('orderReportDateInput').value = '';
  } catch (err) {
    showToast(err.message, true);
  }
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

// ---------- Аккордеон "Добавить расходник" (мобильная версия) ----------
document.getElementById('consumablesToolbarToggleBtn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const open = document.getElementById('consumablesToolbarButtons').classList.toggle('mobile-open');
  btn.setAttribute('aria-expanded', String(open));
  btn.classList.toggle('accordion-open', open);
});

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
      return `<option value="${c.id}" data-tag="${escapeHtml(c.tag || '')}">${escapeHtml(c.name)}${car ? ' — ' + escapeHtml(car) : ''}</option>`;
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
  // Enter сохраняет форму (как в мессенджерах), Shift+Enter — перенос строки.
  // isComposing — иначе Enter, подтверждающий ввод иероглифа/слова в IME
  // (китайская/японская/корейская раскладка), тоже отправлял бы форму.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    el.blur();
    el.closest('form')?.requestSubmit();
  });
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
    // Тег в самом пункте списка не показан (см. fillQueueClientSelect/
    // fillClientSelect), но ищем и по нему тоже — через data-tag.
    const matches = q
      ? options.filter((o) => (o.textContent + ' ' + (o.dataset.tag || '')).toLowerCase().includes(q))
      : options;
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
      input.blur();
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
        input.blur();
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
  setDateMin(apptForm.elements.date, appt?.date);
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

// ---------- Отчёт (выполненные работы по автомобилям за неделю) ----------
let reportRequestSeq = 0;
// Последний загруженный (нефильтрованный) список записей — фильтр по мастеру
// применяется поверх него без повторного запроса к серверу.
let currentReportRecords = [];

// Мастер конкретной работы переопределяет мастера всей записи (см. поле
// "Мастер (если другой)" у работы, withMaster в createRepairRow); пусто —
// считается по мастеру записи. Работы, снятые галочкой "включить" или
// помеченные "не в отчёте", в подсчёт мастеров и суммы отчёта не входят —
// они всё ещё в истории/заказ-наряде клиента, просто не в отчёте.
function effectiveWorkMaster(work, record) {
  return (work.master && work.master.trim()) || record.master || '';
}
function reportRelevantWorks(record) {
  return (record.works || []).filter((w) => w.included !== false && !w.reportExcluded);
}
function recordMasters(record) {
  const set = new Set();
  reportRelevantWorks(record).forEach((w) => {
    const m = effectiveWorkMaster(w, record);
    if (m) set.add(m);
  });
  return set;
}
// masterFilter — если задан, считает только долю этого мастера (для строки
// отчёта под активным фильтром и для итога недели), иначе всю сумму работ.
function sumWorksForReport(record, masterFilter) {
  return reportRelevantWorks(record)
    .filter((w) => !masterFilter || effectiveWorkMaster(w, record) === masterFilter)
    .reduce((sum, w) => sum + (Number(w.price) || 0), 0);
}

function applyReportMasterFilter(records) {
  if (!state.reportMasterFilter) return records;
  return records.filter((r) => recordMasters(r).has(state.reportMasterFilter));
}

async function loadReportMasters() {
  let masters;
  try {
    masters = await api('/api/reports/masters');
  } catch (err) {
    return; // список мастеров — не критично, фильтр просто останется пустым
  }
  const sel = document.getElementById('reportMasterFilter');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Все мастера</option>' + masters.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (masters.includes(current)) sel.value = current;
}

// Список мастеров для полей ввода "Мастер" в записи ремонта (сама запись и
// каждая работа отдельно, см. openRepairDialog/createRepairRow) — datalist,
// а не строгий select, чтобы можно было и выбрать существующего мастера
// кликом, и вписать нового, если такого ещё не было.
async function loadMastersDatalist() {
  let masters;
  try {
    masters = await api('/api/reports/masters');
  } catch (err) {
    return; // необязательные подсказки — если не загрузились, поле остаётся обычным текстовым
  }
  document.getElementById('mastersDatalist').innerHTML = masters.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
}

document.getElementById('reportMasterFilter').addEventListener('change', (e) => {
  state.reportMasterFilter = e.target.value;
  renderReport(applyReportMasterFilter(currentReportRecords));
});

async function loadReportWeek() {
  const mySeq = ++reportRequestSeq;
  const weekStart = state.reportWeekStart; // фиксируем неделю, на которую отправлен запрос
  const start = toISODate(weekStart);
  const end = toISODate(addDays(weekStart, DAYS_IN_WEEK - 1));

  let records;
  try {
    records = await api(`/api/reports?start=${start}&end=${end}`);
  } catch (err) {
    if (mySeq === reportRequestSeq) showToast('Не удалось загрузить отчёт: ' + err.message, true);
    return;
  }
  if (mySeq !== reportRequestSeq) return; // ответ на устаревший клик "вперёд/назад"

  currentReportRecords = records;
  document.getElementById('reportWeekRange').textContent = fmtWeekRange(weekStart);
  renderReport(applyReportMasterFilter(records));
}

// Строит данные заказ-наряда прямо из записи отчёта (без открытия/чтения
// формы редактирования) — так сохраняются поля вроде поставщика запчасти,
// которые редактор сметы (repairForm) не показывает и не умеет вернуть назад.
function buildOrderDataFromRecord(record) {
  const works = (record.works || []).filter((it) => it.included !== false);
  const parts = (record.parts || []).filter((it) => it.included !== false);
  const worksSum = sumItems(works);
  const partsSum = sumItems(parts);
  const advance = Number(record.advance) || 0;
  return {
    clientName: record.client_name || '',
    carLine: [record.car_make, record.car_model].filter(Boolean).join(' '),
    mileage: record.mileage,
    partsEta: record.parts_eta,
    title: record.title,
    date: record.date,
    notes: record.notes,
    master: record.master || '',
    works,
    parts,
    worksSum,
    partsSum,
    advance,
    total: Math.max(0, worksSum + partsSum - advance),
  };
}

function renderReport(records) {
  const body = document.getElementById('reportBody');
  body.innerHTML = '';
  document.getElementById('reportEmpty').classList.toggle('hidden', records.length !== 0);

  let totalWorks = 0;
  let totalParts = 0;

  records.forEach((r) => {
    // Под активным фильтром по мастеру сумма работ — только его доля;
    // без фильтра — все работы записи (кроме исключённых из отчёта).
    const worksSum = sumWorksForReport(r, state.reportMasterFilter);
    const partsSum = sumItems(r.parts);
    totalWorks += worksSum;
    totalParts += partsSum;

    const masters = Array.from(recordMasters(r));
    const masterLabel = masters.length === 0 ? '—' : masters.length === 1 ? masters[0] : `Смешанно (${masters.length})`;

    const tr = document.createElement('tr');
    const carLine = [r.car_make, r.car_model].filter(Boolean).join(' ');
    const dateLabel = r.date ? fmtFullDate(new Date(r.date + 'T00:00:00')) : 'Без даты';
    tr.innerHTML = `
      <td data-label="Дата">${escapeHtml(dateLabel)}</td>
      <td class="cell-tag" data-label="Тег">${escapeHtml(r.client_tag || '—')}</td>
      <td data-label="Автомобиль">${escapeHtml(carLine || '—')}</td>
      <td data-label="Мастер" title="${escapeHtml(masters.join(', '))}">${escapeHtml(masterLabel)}</td>
      <td data-label="Сумма работ">${fmtMoney(worksSum)}</td>
      <td data-label="Сумма запчастей">${fmtMoney(partsSum)}</td>
      <td><button type="button" class="report-delete-btn" title="Убрать из отчёта" aria-label="Убрать из отчёта">${REPORT_DELETE_ICON_SVG}</button></td>
    `;
    const deleteBtn = tr.querySelector('.report-delete-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Убирает запись только из отчёта (report_hidden=true) — в истории
      // ремонта клиента она остаётся как была, это не удаление данных.
      if (!(await showConfirm('Убрать запись из отчёта? В истории ремонта клиента она останется.', { confirmLabel: 'Убрать', danger: false }))) return;
      try {
        await api(`/api/repairs/${r.id}`, { method: 'PUT', body: JSON.stringify({ ...r, report_hidden: true }) });
        showToast('Запись убрана из отчёта');
        await loadReportWeek();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    // Клик по строке отчёта сразу открывает заказ-наряд (документ), а не
    // диалог редактирования сметы. editingRepairId/historyClientId выставляем,
    // как при открытии истории ремонта клиента, — чтобы "Добавить в отчёт"
    // ниже (см. orderAddToReportConfirmBtn) знал, какую запись обновлять.
    tr.addEventListener('click', () => {
      editingRepairId = r.id;
      historyClientId = r.client_id;
      currentOrderContext = 'repair';
      currentOrderIsReportView = true;
      currentOrderRecordData = {
        title: r.title,
        mileage: r.mileage,
        notes: r.notes,
        parts_eta: r.parts_eta,
        advance: Number(r.advance) || 0,
        works: r.works || [],
        parts: r.parts || [],
        master: r.master || '',
      };
      const order = buildOrderDataFromRecord(r);
      currentOrderData = order;
      // showSupplier: true — поставщик запчасти виден только в заказ-наряде,
      // открытом из вкладки «Отчёт», в остальных местах не показывается.
      document.getElementById('orderAddToReportBtn').classList.remove('hidden');
      document.getElementById('orderAddToHistoryBtn').classList.add('hidden');
      document.getElementById('orderAddToHistoryPanel').classList.add('hidden');
      document.getElementById('orderContent').innerHTML = buildOrderHtml(order, { showSupplier: true });
      openDialog(orderDialog);
    });
    body.appendChild(tr);
  });

  document.getElementById('reportTotalWorks').textContent = fmtMoney(totalWorks);
  document.getElementById('reportTotalParts').textContent = fmtMoney(totalParts);
}

document.getElementById('reportPrevWeek').addEventListener('click', () => { state.reportWeekStart = addDays(state.reportWeekStart, -7); loadReportWeek(); });
document.getElementById('reportNextWeek').addEventListener('click', () => { state.reportWeekStart = addDays(state.reportWeekStart, 7); loadReportWeek(); });
document.getElementById('reportTodayBtn').addEventListener('click', () => { state.reportWeekStart = startOfWeek(new Date()); loadReportWeek(); });

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
    const senderName = r.client_name
      ? escapeHtml(r.client_name)
      : r.client_profile?.name
      ? `${escapeHtml(r.client_profile.name)} (не в базе)`
      : 'Клиент не найден в базе';
    const telHref = r.client_phone
      ? r.client_phone.replace(/[^\d+]/g, '')
      : r.client_profile?.phone
      ? r.client_profile.phone.replace(/[^\d+]/g, '')
      : '';
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
          if (p.name) clientForm.elements.name.value = p.name;
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
let clientCarSnapshot = '';
// true, пока VIN не заведён в базе админом — тогда имя/телефон/марка/модель
// обязательны, а кнопка "Добавить в базу" видна всегда, а не только при
// реальных правках (см. loadClientProfile/updateClientCarSaveVisibility).
let clientIsNewRegistration = false;
// true после того, как в этой сессии клиент уже нажал "Добавить в базу" и
// сохранение прошло успешно — админ мог ещё не успеть завести карточку
// (known всё ещё false), но повторно показывать форму регистрации клиенту,
// который её только что заполнил, не нужно: дальше форма ведёт себя как
// обычная, с кнопкой "Сохранить" только при правках.
let clientRegistrationSubmitted = false;
const clientRequestForm = document.getElementById('clientRequestForm');
const clientRequestPhotoInput = document.getElementById('clientRequestPhotoInput');
const clientRequestPhotoPreview = document.getElementById('clientRequestPhotoPreview');
const clientRequestPhotoImg = document.getElementById('clientRequestPhotoImg');
const clientRequestError = document.getElementById('clientRequestError');
let clientRequestPhotoData = null;

// Плейсхолдер поля сообщения — случайный из набора примеров при каждом
// заходе в кабинет, чтобы подсказать разные поводы написать в сервис.
const CLIENT_REQUEST_PLACEHOLDERS = [
  'Например: хочу прислать другой VIN, вопрос по ремонту…',
  'Например: когда будут готовы запчасти?',
  'Например: можно перенести запись на другой день?',
  'Например: сколько будет стоить замена масла?',
  'Например: подскажите статус моего ремонта',
  'Например: хочу уточнить итоговую сумму',
  'Например: можно приехать раньше записи?',
  'Например: пришлите, пожалуйста, фото повреждения',
  'Например: нужна консультация по шуму в подвеске',
  'Например: уточните, работаете ли вы в субботу',
];
function setRandomClientRequestPlaceholder() {
  const pick = CLIENT_REQUEST_PLACEHOLDERS[Math.floor(Math.random() * CLIENT_REQUEST_PLACEHOLDERS.length)];
  clientRequestForm.elements.message.placeholder = pick;
}

async function loadClientProfile() {
  const profile = await api('/api/client/me');
  document.getElementById('clientVinBadge').textContent = profile.vin;
  clientCarForm.elements.vin.value = profile.vin;
  clientCarForm.elements.name.value = profile.car.name || '';
  clientCarForm.elements.phone.value = profile.car.phone || '';
  clientCarForm.elements.car_make.value = profile.car.car_make || '';
  clientCarForm.elements.car_model.value = profile.car.car_model || '';
  clientCarForm.elements.plate.value = profile.car.plate || '';
  clientCarForm.elements.notes.value = profile.car.notes || '';
  autoResizeTextarea(clientCarForm.elements.notes);
  // Заметка, которую оставил админ — только для чтения, отдельно от своей.
  const adminNotesText = profile.car.admin_notes || '';
  document.getElementById('clientCarAdminNotes').classList.toggle('hidden', !adminNotesText);
  document.getElementById('clientCarAdminNotesText').textContent = adminNotesText;
  renderClientRepairs(profile.repairs);

  // Пока такого VIN нет в базе (админ ещё не завёл карточку) — основные
  // поля обязательны, а кнопка называется "Добавить в базу" и видна всегда,
  // а не только при правках. Как только карточка появится в базе (known
  // станет true при следующей загрузке), форма ведёт себя как обычно.
  clientIsNewRegistration = !profile.known && !clientRegistrationSubmitted;
  const saveBtn = document.getElementById('clientCarSaveBtn');
  ['name', 'phone', 'car_make', 'car_model'].forEach((field) => {
    clientCarForm.elements[field].required = clientIsNewRegistration;
  });
  document.querySelectorAll('.client-car-required-mark').forEach((el) => {
    el.classList.toggle('hidden', !clientIsNewRegistration);
  });
  saveBtn.textContent = clientIsNewRegistration ? 'Добавить в базу' : 'Сохранить';

  // Кнопка появляется только когда что-то реально поменялось (кроме нового
  // клиента — там она видна всегда) — запоминаем состояние формы сразу
  // после загрузки как точку отсчёта.
  clientCarSnapshot = getClientCarFormSnapshot();
  updateClientCarSaveVisibility();
}

function getClientCarFormSnapshot() {
  return JSON.stringify(Object.fromEntries(new FormData(clientCarForm).entries()));
}

function updateClientCarSaveVisibility() {
  const changed = getClientCarFormSnapshot() !== clientCarSnapshot;
  document.getElementById('clientCarSaveBtn').classList.toggle('hidden', !changed && !clientIsNewRegistration);
}

clientCarForm.addEventListener('input', updateClientCarSaveVisibility);

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
    const dateObj = r.date ? new Date(r.date + 'T00:00:00') : null;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-head">
        <span class="${r.title ? 'history-title' : 'history-date'}">${r.title ? escapeHtml(r.title) : (dateObj ? fmtFullDate(dateObj) : 'Без даты')}</span>
        <strong class="history-total">${fmtMoney(total)}</strong>
      </div>
      ${r.title && dateObj ? `<span class="history-date">${fmtFullDate(dateObj)}</span>` : ''}
      ${r.mileage ? `<div class="repair-list-sum"><span>Пробег</span><span>${fmtMileage(r.mileage)}</span></div>` : ''}
      ${renderRepairBlock('Запчасти', r.parts, partsSum, 'Сумма запчастей')}
      ${renderRepairBlock('Работы', r.works, worksSum, 'Сумма работ:')}
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
  const wasNewRegistration = clientIsNewRegistration;
  try {
    await api('/api/client/car', { method: 'PUT', body: JSON.stringify(data) });
    showToast(wasNewRegistration ? 'Данные отправлены в сервис' : 'Сохранено');
    // Успешная регистрация — дальше форма не должна снова требовать
    // обязательные поля и показывать "Добавить в базу", даже если админ
    // ещё не успел завести карточку (см. clientRegistrationSubmitted).
    if (wasNewRegistration) clientRegistrationSubmitted = true;
    // VIN мог измениться (клиент исправил опечатку) — перезагружаем анкету
    // целиком, чтобы бейдж и история ремонта обновились под новый VIN.
    await loadClientProfile();
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
    // Клиент может заполнить машину/телефон выше, но не нажать отдельную
    // кнопку "Сохранить" в той форме — отправляя заявку, на всякий случай
    // сохраняем анкету заодно, иначе админ не увидит эти данные в заявке.
    const carData = Object.fromEntries(new FormData(clientCarForm).entries());
    if (Object.values(carData).some((v) => (v || '').trim())) {
      try {
        await api('/api/client/car', { method: 'PUT', body: JSON.stringify(carData) });
      } catch (err) {
        // Не блокируем отправку заявки, если сохранение анкеты не удалось.
      }
    }
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
    setRandomClientRequestPlaceholder();
    await loadClientProfile();
    await loadClientRequests();
  } catch (err) {
    showToast('Не удалось загрузить данные: ' + err.message, true);
  }
}

// ---------- Заметки владельца ----------
const noteDialog = document.getElementById('noteDialog');
const noteForm = document.getElementById('noteForm');
const deleteNoteBtn = document.getElementById('deleteNoteBtn');
let editingNoteId = null;
let currentNoteTag = 'normal';

function setNoteTag(tag) {
  currentNoteTag = tag === 'urgent' ? 'urgent' : 'normal';
  document.querySelectorAll('#noteTagSwitch .note-tag-btn').forEach((b) => {
    const active = b.dataset.noteTag === currentNoteTag;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
}
document.querySelectorAll('#noteTagSwitch .note-tag-btn').forEach((btn) => {
  btn.addEventListener('click', () => setNoteTag(btn.dataset.noteTag));
});

function openNoteDialog(note) {
  editingNoteId = note ? note.id : null;
  document.getElementById('noteDialogTitle').textContent = note ? 'Заметка' : 'Новая заметка';
  deleteNoteBtn.classList.toggle('hidden', !note);
  noteForm.reset();
  noteForm.elements.text.value = note ? note.text : '';
  setNoteTag(note ? note.tag : 'normal');
  autoResizeTextarea(noteForm.elements.text);
  openDialog(noteDialog);
}

document.getElementById('newNoteBtn').addEventListener('click', () => openNoteDialog(null));

noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = { text: noteForm.elements.text.value, tag: currentNoteTag };
  try {
    if (editingNoteId) {
      await api(`/api/notes/${editingNoteId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Заметка обновлена');
    } else {
      await api('/api/notes', { method: 'POST', body: JSON.stringify(data) });
      showToast('Заметка добавлена');
    }
    closeDialog(noteDialog);
    await loadNotes();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteNoteBtn.addEventListener('click', async () => {
  if (!editingNoteId) return;
  if (!(await showConfirm('Удалить заметку?'))) return;
  try {
    await api(`/api/notes/${editingNoteId}`, { method: 'DELETE' });
    showToast('Заметка удалена');
    closeDialog(noteDialog);
    await loadNotes();
  } catch (err) {
    showToast(err.message, true);
  }
});

async function loadNotes() {
  const list = document.getElementById('notesList');
  const empty = document.getElementById('notesEmpty');
  let notes;
  try {
    notes = await api('/api/notes');
  } catch (err) {
    showToast('Не удалось загрузить заметки: ' + err.message, true);
    return;
  }
  list.innerHTML = '';
  empty.classList.toggle('hidden', notes.length !== 0);

  const notesBadge = document.getElementById('notesBadge');
  notesBadge.textContent = String(notes.length);
  notesBadge.classList.toggle('hidden', notes.length === 0);

  notes.forEach((n) => {
    const item = document.createElement('div');
    item.className = 'note-item' + (n.tag === 'urgent' ? ' note-item-urgent' : '');
    item.innerHTML = `
      <div class="note-item-head">
        ${n.tag === 'urgent' ? '<span class="note-item-badge">Срочно</span>' : ''}
        <span class="note-item-date">${fmtDateTime(n.updated_at || n.created_at)}</span>
      </div>
      <p class="note-item-text">${escapeHtml(n.text)}</p>
    `;
    item.addEventListener('click', () => openNoteDialog(n));
    list.appendChild(item);
  });
}

// ---------- ТО: артикулы масла/фильтров по марке/модели авто ----------
const toArticleDialog = document.getElementById('toArticleDialog');
const toArticleForm = document.getElementById('toArticleForm');
const deleteToArticleBtn = document.getElementById('deleteToArticleBtn');
let toArticles = [];
let editingToArticleId = null;

// Марка/модель можно подтянуть из уже существующего клиента вместо ручного
// набора — сам клиент тут не сохраняется, берётся только его марка/модель.
function fillToArticleClientSelect() {
  const sel = document.getElementById('toArticleClientSelect');
  const options = state.clients
    .map((c) => {
      const car = [c.car_make, c.car_model].filter(Boolean).join(' ');
      if (!car) return ''; // без машины подставлять нечего
      // data-tag — тег не показываем в самом пункте списка (не захламляем),
      // но поиск в client-picker (см. enhanceClientSelect) должен его находить.
      return `<option value="${c.id}" data-tag="${escapeHtml(c.tag || '')}">${escapeHtml(c.name)} — ${escapeHtml(car)}</option>`;
    })
    .join('');
  sel.innerHTML = `<option value="">— ввести вручную —</option>${options}`;
}

document.getElementById('toArticleClientSelect').addEventListener('change', (e) => {
  const client = state.clients.find((c) => c.id === Number(e.target.value));
  if (!client) return;
  toArticleForm.elements.car_make.value = client.car_make || '';
  toArticleForm.elements.car_model.value = client.car_model || '';
  toArticleForm.elements.tag.value = client.tag || '';
});
enhanceClientSelect(document.getElementById('toArticleClientSelect'), '— ввести вручную —');

function openToArticleDialog(item) {
  editingToArticleId = item ? item.id : null;
  document.getElementById('toArticleDialogTitle').textContent = item ? 'Марка / модель' : 'Новая машина';
  deleteToArticleBtn.classList.toggle('hidden', !item);
  toArticleForm.reset();
  fillToArticleClientSelect();
  if (item) {
    for (const [k, v] of Object.entries(item)) {
      if (toArticleForm.elements[k]) toArticleForm.elements[k].value = v || '';
    }
  }
  openDialog(toArticleDialog);
}

document.getElementById('newToArticleBtn').addEventListener('click', () => openToArticleDialog(null));

// Быстрый заказ-наряд прямо из карточки ТО — без клиента, просто список
// артикулов этой марки/модели (масло + фильтры) для печати/отправки, чтобы
// не переносить их вручную в новую смету. Строится из текущих полей формы
// (можно сформировать даже ещё не сохранив карточку).
document.getElementById('toArticleOrderBtn').addEventListener('click', () => {
  const parts = [
    { label: 'oil_article', name: `Масло${toArticleForm.elements.oil_spec.value.trim() ? ' ' + toArticleForm.elements.oil_spec.value.trim() : ''}` },
    { label: 'oil_filter_article', brandLabel: 'oil_filter_brand', name: 'Масляный фильтр' },
    { label: 'air_filter_article', brandLabel: 'air_filter_brand', name: 'Воздушный фильтр' },
    { label: 'cabin_filter_article', brandLabel: 'cabin_filter_brand', name: 'Фильтр салона' },
  ]
    .map(({ label, brandLabel, name }) => ({
      name,
      article: toArticleForm.elements[label].value.trim(),
      brand: brandLabel ? toArticleForm.elements[brandLabel].value.trim() : '',
    }))
    .filter((p) => p.article)
    .map((p) => ({ ...p, price: 0 }));
  if (!parts.length) {
    showToast('Заполните хотя бы один артикул', true);
    return;
  }
  const order = {
    clientName: '',
    carLine: [toArticleForm.elements.car_make.value, toArticleForm.elements.car_model.value].filter(Boolean).join(' '),
    mileage: null,
    partsEta: '',
    title: 'ТО',
    date: '',
    notes: toArticleForm.elements.notes.value,
    works: [],
    parts,
    worksSum: 0,
    partsSum: 0,
    advance: 0,
    total: 0,
  };
  currentOrderData = order;
  currentOrderContext = 'to';
  currentOrderIsReportView = false;
  // "Добавить в отчёт" тут не при делах — заказ-наряд не привязан ни к
  // клиенту, ни к записи ремонта, сохранять в отчёт нечего. Вместо неё —
  // "Добавить в историю клиента": там выбирается, кому именно засчитать.
  document.getElementById('orderAddToReportBtn').classList.add('hidden');
  document.getElementById('orderAddToReportPanel').classList.add('hidden');
  document.getElementById('orderAddToHistoryBtn').classList.remove('hidden');
  document.getElementById('orderAddToHistoryPanel').classList.add('hidden');
  fillOrderHistoryClientSelect();
  document.getElementById('orderHistoryClientSelect').value = '';
  document.getElementById('orderHistoryDateInput').value = '';
  document.getElementById('orderContent').innerHTML = buildOrderHtml(order);
  openDialog(orderDialog);
});

toArticleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    car_make: toArticleForm.elements.car_make.value,
    car_model: toArticleForm.elements.car_model.value,
    tag: toArticleForm.elements.tag.value,
    oil_spec: toArticleForm.elements.oil_spec.value,
    oil_article: toArticleForm.elements.oil_article.value,
    oil_filter_brand: toArticleForm.elements.oil_filter_brand.value,
    oil_filter_article: toArticleForm.elements.oil_filter_article.value,
    air_filter_brand: toArticleForm.elements.air_filter_brand.value,
    air_filter_article: toArticleForm.elements.air_filter_article.value,
    cabin_filter_brand: toArticleForm.elements.cabin_filter_brand.value,
    cabin_filter_article: toArticleForm.elements.cabin_filter_article.value,
    notes: toArticleForm.elements.notes.value,
  };
  try {
    if (editingToArticleId) {
      await api(`/api/to-articles/${editingToArticleId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Изменения сохранены');
    } else {
      await api('/api/to-articles', { method: 'POST', body: JSON.stringify(data) });
      showToast('Машина добавлена');
    }
    closeDialog(toArticleDialog);
    await loadToArticles();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteToArticleBtn.addEventListener('click', async () => {
  if (!editingToArticleId) return;
  if (!(await showConfirm('Удалить эту марку/модель из ТО?'))) return;
  try {
    await api(`/api/to-articles/${editingToArticleId}`, { method: 'DELETE' });
    showToast('Удалено');
    closeDialog(toArticleDialog);
    await loadToArticles();
  } catch (err) {
    showToast(err.message, true);
  }
});

// Артикул в отдельном span с кнопкой копирования — тот же приём, что и у
// расходников/VIN: клик по кнопке не должен открывать диалог редактирования.
function toArticleCell(article) {
  if (!article) return '—';
  return `<span class="to-article-cell"><span class="to-article-text" title="${escapeHtml(article)}">${escapeHtml(article)}</span><button type="button" class="article-copy-btn" data-article="${escapeHtml(article)}" title="Копировать артикул">${COPY_ICON_SVG}</button></span>`;
}

// Фирма фильтра — просто текстом перед артикулом (как вязкость у масла),
// сам артикул — через toArticleCell (копирование, обрезка многоточием).
function toFilterCell(brand, article) {
  if (!article) return brand ? escapeHtml(brand) : '—';
  return `${brand ? escapeHtml(brand) + ' — ' : ''}${toArticleCell(article)}`;
}

function renderToArticles() {
  const q = document.getElementById('toSearch').value.trim().toLowerCase();
  const body = document.getElementById('toArticlesBody');
  const filtered = q
    ? toArticles.filter((it) => [it.car_make, it.car_model, it.tag].filter(Boolean).join(' ').toLowerCase().includes(q))
    : toArticles;
  body.innerHTML = '';
  document.getElementById('toArticlesEmpty').classList.toggle('hidden', toArticles.length !== 0);

  filtered.forEach((it) => {
    const tr = document.createElement('tr');
    const carLine = [it.car_make, it.car_model].filter(Boolean).join(' ');
    const oilLabel = it.oil_article ? `${it.oil_spec ? escapeHtml(it.oil_spec) + ' — ' : ''}${toArticleCell(it.oil_article)}` : (it.oil_spec ? escapeHtml(it.oil_spec) : '—');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(carLine)}</td>
      <td class="cell-tag">${escapeHtml(it.tag || '—')}</td>
      <td>${oilLabel}</td>
      <td>${toFilterCell(it.oil_filter_brand, it.oil_filter_article)}</td>
      <td>${toFilterCell(it.air_filter_brand, it.air_filter_article)}</td>
      <td>${toFilterCell(it.cabin_filter_brand, it.cabin_filter_article)}</td>
      <td class="edit-hint">${EDIT_ICON_SVG}</td>
    `;
    tr.querySelectorAll('.article-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyArticleToClipboard(btn.dataset.article);
      });
    });
    tr.addEventListener('click', () => openToArticleDialog(it));
    body.appendChild(tr);
  });
}

document.getElementById('toSearch').addEventListener('input', renderToArticles);

async function loadToArticles() {
  try {
    toArticles = await api('/api/to-articles');
  } catch (err) {
    showToast('Не удалось загрузить ТО: ' + err.message, true);
    return;
  }
  renderToArticles();
}

// ---------- Init ----------
async function bootApp() {
  try {
    await loadClients();
    await loadWeek();
    await loadQueue();
    await loadConsumables();
    await loadToArticles();
    await loadRequests();
    await loadNotes();
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
