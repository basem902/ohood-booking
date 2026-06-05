/* =====================================================
   app.js — منطق تطبيق حجوزات عهود
   ===================================================== */
'use strict';

/* ---------- أدوات مساعدة ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const STATUS_LABEL = { confirmed: 'مؤكد', pending: 'بانتظار التأكيد', done: 'مكتمل', cancelled: 'ملغي' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function weekdayName(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00');
  return AR_DAYS[d.getDay()] || '';
}

// تحويل كائن Date إلى نص تاريخ محلي YYYY-MM-DD (بدون انزياح المنطقة الزمنية)
function dateToStr(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h < 12 ? 'ص' : 'م';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- الحالة ---------- */
let bookings = [];     // كل الحجوزات في الذاكرة (مرآة لقاعدة البيانات)
let packages = [];     // الباقات
let settings = {
  biz: 'حجوزات عهود',
  cc: '966',
  // ساعات العمل والإعدادات الموحّدة
  workDays: [0, 1, 2, 3, 4],   // 0=الأحد .. 6=السبت
  workStart: '10:00',
  workEnd: '22:00',
  defaultDuration: 60,         // دقائق
  blockConflicts: false,       // منع الحفظ عند التعارض الفعلي
  currency: 'ر.س',
  notifyEnabled: false,
  // الإعدادات المالية
  vatEnabled: false,           // تفعيل ضريبة القيمة المضافة
  vatRate: 15,                 // نسبة الضريبة %
  fixedExpenses: [],           // مصروفات ثابتة شهرية [{id, name, amount}]
  targetRevenue: 0,            // هدف الإيراد الشهري
  targetProfit: 0,             // هدف صافي الربح الشهري
  lowMarginThreshold: 20,      // حد هامش الربح المنخفض %
};
let editingId = null;

/* ---------- حالة العرض والتقويم ---------- */
let viewMode = 'list';         // 'list' أو 'calendar'
let calMode = 'month';         // 'month' أو 'week'
let calCursor = new Date();    // تاريخ المرجع للتقويم (يحدّد الشهر/الأسبوع المعروض)
let dayFilter = '';            // عند الضبط: تصفية القائمة على تاريخ محدد (YYYY-MM-DD)

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DAYS_SHORT = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

/* ---------- التهيئة ---------- */
async function init() {
  await loadSettings();
  await loadPackages();
  await loadBookings();

  // تاريخ اليوم والمدة الافتراضية كقيم ابتدائية (المدة تُعرض بالساعات، التخزين بالدقائق)
  $('#f-date').value = todayStr();
  $('#f-duration').value = settings.defaultDuration / 60;

  bindEvents();
  refreshAll();
  refreshDayWarning();
  // مؤقّت تذكير المواعيد عبر إشعارات المتصفح (يعمل طالما الصفحة مفتوحة)
  startReminderTimer();
}

async function loadSettings() {
  const biz = await DB.get('settings', 'biz');
  const cc = await DB.get('settings', 'cc');
  if (biz) settings.biz = biz.value;
  if (cc) settings.cc = cc.value;

  // إعدادات ساعات العمل والعقد الموحّد (مع الافتراضيات إن غابت)
  const workDays = await DB.get('settings', 'workDays');
  const workStart = await DB.get('settings', 'workStart');
  const workEnd = await DB.get('settings', 'workEnd');
  const defaultDuration = await DB.get('settings', 'defaultDuration');
  const blockConflicts = await DB.get('settings', 'blockConflicts');
  const currency = await DB.get('settings', 'currency');
  const notifyEnabled = await DB.get('settings', 'notifyEnabled');

  // الإعدادات المالية
  const vatEnabled = await DB.get('settings', 'vatEnabled');
  const vatRate = await DB.get('settings', 'vatRate');
  const fixedExpenses = await DB.get('settings', 'fixedExpenses');
  const targetRevenue = await DB.get('settings', 'targetRevenue');
  const targetProfit = await DB.get('settings', 'targetProfit');
  const lowMarginThreshold = await DB.get('settings', 'lowMarginThreshold');

  if (workDays && Array.isArray(workDays.value)) settings.workDays = workDays.value.map(Number);
  if (workStart && workStart.value) settings.workStart = workStart.value;
  if (workEnd && workEnd.value) settings.workEnd = workEnd.value;
  if (defaultDuration && defaultDuration.value != null) {
    settings.defaultDuration = Number(defaultDuration.value) || settings.defaultDuration;
  }
  if (blockConflicts) settings.blockConflicts = !!blockConflicts.value;
  if (currency && currency.value) settings.currency = currency.value;
  if (notifyEnabled) settings.notifyEnabled = !!notifyEnabled.value;

  // تحميل الإعدادات المالية مع الافتراضيات (توافق رجعي تام)
  if (vatEnabled) settings.vatEnabled = !!vatEnabled.value;
  if (vatRate && vatRate.value != null) {
    const r = Number(vatRate.value);
    settings.vatRate = Number.isFinite(r) && r >= 0 ? r : settings.vatRate;
  }
  if (fixedExpenses && Array.isArray(fixedExpenses.value)) {
    settings.fixedExpenses = fixedExpenses.value
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ id: x.id || uid(), name: String(x.name || ''), amount: Math.max(0, Number(x.amount) || 0) }));
  }
  if (targetRevenue && targetRevenue.value != null) {
    settings.targetRevenue = Math.max(0, Number(targetRevenue.value) || 0);
  }
  if (targetProfit && targetProfit.value != null) {
    settings.targetProfit = Math.max(0, Number(targetProfit.value) || 0);
  }
  if (lowMarginThreshold && lowMarginThreshold.value != null) {
    const t = Number(lowMarginThreshold.value);
    settings.lowMarginThreshold = Number.isFinite(t) && t >= 0 ? t : settings.lowMarginThreshold;
  }

  applySettings();
}

function applySettings() {
  $('#biz-name').textContent = settings.biz || 'حجوزات عهود';
  document.title = settings.biz || 'حجوزات عهود';
  $('#set-biz').value = settings.biz || '';
  $('#set-cc').value = settings.cc || '';
  $('.brand-logo').textContent = (settings.biz || 'ع').trim().charAt(0) || 'ع';
  applyWorkSettingsToUI();
}

// تعبئة حقول ساعات العمل في نافذة الإعدادات من كائن settings
function applyWorkSettingsToUI() {
  // أيام الأسبوع (مربعات اختيار)
  $$('.work-day').forEach((cb) => {
    cb.checked = settings.workDays.includes(Number(cb.value));
  });
  const ws = $('#set-work-start'); if (ws) ws.value = settings.workStart || '10:00';
  const we = $('#set-work-end'); if (we) we.value = settings.workEnd || '22:00';
  const dd = $('#set-duration'); if (dd) dd.value = (settings.defaultDuration || 60) / 60;
  const cur = $('#set-currency'); if (cur) cur.value = settings.currency || 'ر.س';
  const bc = $('#set-block'); if (bc) bc.checked = !!settings.blockConflicts;
  applyFinanceSettingsToUI();
}

// تعبئة حقول الإعدادات المالية في نافذة الإعدادات من كائن settings
function applyFinanceSettingsToUI() {
  const ve = $('#set-vat-enabled'); if (ve) ve.checked = !!settings.vatEnabled;
  const vr = $('#set-vat-rate'); if (vr) vr.value = settings.vatRate != null ? settings.vatRate : 15;
  const tr = $('#set-target-revenue'); if (tr) tr.value = settings.targetRevenue || 0;
  const tp = $('#set-target-profit'); if (tp) tp.value = settings.targetProfit || 0;
  const lm = $('#set-low-margin'); if (lm) lm.value = settings.lowMarginThreshold != null ? settings.lowMarginThreshold : 20;
  renderFixedExpenses();
}

async function loadPackages() {
  packages = await DB.getAll('packages');
  // بذور افتراضية عند أول تشغيل
  if (!packages.length) {
    const seed = [
      { id: uid(), name: 'استشارة', price: 100, desc: 'جلسة تقييم أولية' },
      { id: uid(), name: 'جلسة عادية', price: 200, desc: 'جلسة كاملة بمدة قياسية' },
      { id: uid(), name: 'باقة مميزة', price: 350, desc: 'جلسة موسّعة مع متابعة' },
      { id: uid(), name: 'باقة VIP', price: 600, desc: 'خدمة شاملة مع أولوية بالحجز' },
    ];
    for (const p of seed) await DB.put('packages', p);
    packages = seed;
  }
  renderPackages();
}

async function loadBookings() {
  bookings = await DB.getAll('bookings');
}

/* ---------- ربط الأحداث ---------- */
function bindEvents() {
  $('#booking-form').addEventListener('submit', onSave);
  $('#btn-reset').addEventListener('click', resetForm);
  $('#f-date').addEventListener('change', refreshDayWarning);
  $('#f-time').addEventListener('change', refreshDayWarning);
  $('#f-duration').addEventListener('input', refreshDayWarning);
  $('#f-package').addEventListener('input', onPackageInput);
  // تحديث سطري المتبقّي والصافي حيًّا عند تغيير السعر/الدفعة/المصروفات/الخصم
  $('#f-price').addEventListener('input', updateRemainingLine);
  $('#f-paid').addEventListener('input', updateRemainingLine);
  $('#f-expenses').addEventListener('input', updateRemainingLine);
  $('#f-discount').addEventListener('input', updateRemainingLine);

  $('#search').addEventListener('input', renderList);
  // تغيير النطاق الزمني يلغي تصفية اليوم المحدّد من التقويم
  $('#filter-scope').addEventListener('change', () => { dayFilter = ''; renderList(); });
  $('#filter-status').addEventListener('change', renderList);
  $('#btn-print').addEventListener('click', () => window.print());

  // مبدّل العرض: قائمة / تقويم
  $('#view-list-btn').addEventListener('click', () => setView('list'));
  $('#view-cal-btn').addEventListener('click', () => setView('calendar'));

  // إلغاء تصفية اليوم المحدّد
  $('#day-filter-clear').addEventListener('click', () => { dayFilter = ''; renderList(); });

  // تنقّل التقويم
  $('#cal-prev').addEventListener('click', () => shiftCalendar(-1));
  $('#cal-next').addEventListener('click', () => shiftCalendar(1));
  $('#cal-today').addEventListener('click', () => { calCursor = new Date(); renderCalendar(); });
  $('#cal-mode-month').addEventListener('click', () => setCalMode('month'));
  $('#cal-mode-week').addEventListener('click', () => setCalMode('week'));
  // تفويض النقر داخل شبكة التقويم (يوم أو موعد مصغّر)
  $('#cal-grid').addEventListener('click', onCalendarClick);

  // التقارير (لوحة تحليلية بفترة زمنية)
  $('#btn-reports').addEventListener('click', openReports);
  $('#report-from').addEventListener('change', () => { clearQuickActive(); renderReport(); });
  $('#report-to').addEventListener('change', () => { clearQuickActive(); renderReport(); });
  // أزرار الاختصارات السريعة: تضبط من/إلى ثم تعيد الرسم
  $$('.rq-btn').forEach((btn) => btn.addEventListener('click', () => {
    applyQuickRange(btn.getAttribute('data-range'));
    $$('.rq-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderReport();
  }));

  // الإعدادات
  $('#btn-settings').addEventListener('click', () => { applyWorkSettingsToUI(); updateNotifyUI(); openModal('#settings-modal'); });
  $('#btn-backup').addEventListener('click', () => { applyWorkSettingsToUI(); updateNotifyUI(); openModal('#settings-modal'); });
  $$('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));

  $('#set-biz').addEventListener('change', saveBizSettings);
  $('#set-cc').addEventListener('change', saveBizSettings);

  // إعدادات ساعات العمل (حفظ عند التغيير)
  $$('.work-day').forEach((cb) => cb.addEventListener('change', saveWorkSettings));
  $('#set-work-start').addEventListener('change', saveWorkSettings);
  $('#set-work-end').addEventListener('change', saveWorkSettings);
  $('#set-duration').addEventListener('change', saveWorkSettings);
  $('#set-currency').addEventListener('change', saveWorkSettings);
  $('#set-block').addEventListener('change', saveWorkSettings);

  // الإعدادات المالية (حفظ عند التغيير)
  $('#set-vat-enabled').addEventListener('change', saveVatSettings);
  $('#set-vat-rate').addEventListener('change', saveVatSettings);
  $('#set-target-revenue').addEventListener('change', saveTargetSettings);
  $('#set-target-profit').addEventListener('change', saveTargetSettings);
  $('#set-low-margin').addEventListener('change', saveLowMarginSetting);
  $('#fx-add-btn').addEventListener('click', addFixedExpense);

  // إشعارات التذكير
  $('#btn-notify').addEventListener('click', enableNotifications);

  $('#pkg-add-btn').addEventListener('click', addPackage);
  $('#exp-json').addEventListener('click', exportJSON);
  $('#exp-csv').addEventListener('click', exportCSV);
  $('#imp-json').addEventListener('click', () => $('#imp-file').click());
  $('#imp-file').addEventListener('change', importJSON);
  $('#wipe-all').addEventListener('click', wipeAll);

  // تثبيت PWA
  $('#btn-install').addEventListener('click', installApp);

  // إغلاق النوافذ بمفتاح Esc
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
}

/* ---------- حفظ / تعديل حجز ---------- */
async function onSave(e) {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const date = $('#f-date').value;
  const time = $('#f-time').value;
  if (!name || !date || !time) { toast('الرجاء تعبئة الحقول المطلوبة', 'err'); return; }

  const price = Number($('#f-price').value) || 0;
  // المدة تُدخَل بالساعات وتُخزَّن بالدقائق؛ إن كان الحقل فارغاً نستخدم المدة الافتراضية (دقائق)
  const duration = durationFieldMinutes();
  const paidAmount = Math.max(0, Number($('#f-paid').value) || 0);
  // الحقول المالية الجديدة (افتراضها 0/فارغ ⇒ توافق رجعي)
  const expenses = Math.max(0, Number($('#f-expenses').value) || 0);
  const expenseNote = $('#f-expense-note').value.trim();
  const discount = Math.max(0, Number($('#f-discount').value) || 0);
  const status = $('#f-status').value;

  // منع الحفظ عند التعارض الفعلي إن كان مفعّلاً (مع تجاهل السجل قيد التعديل)
  if (settings.blockConflicts && status !== 'cancelled') {
    const clash = findConflicts(date, time, duration, editingId).length > 0;
    if (clash) { toast('يوجد تعارض مع موعد آخر في نفس الوقت', 'err'); return; }
  }

  const record = {
    id: editingId || uid(),
    name,
    phone: $('#f-phone').value.trim(),
    date,
    time,
    package: $('#f-package').value.trim(),
    price,
    duration,
    paidAmount,
    expenses,
    expenseNote,
    discount,
    status,
    notes: $('#f-notes').value.trim(),
    createdAt: editingId ? (bookings.find((b) => b.id === editingId)?.createdAt || Date.now()) : Date.now(),
  };

  await DB.put('bookings', record);
  await loadBookings();
  resetForm();
  refreshAll();
  toast(editingId ? 'تم تحديث الحجز ✓' : 'تم حفظ الحجز ✓', 'ok');
}

function editBooking(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  editingId = id;
  $('#f-id').value = id;
  $('#f-name').value = b.name || '';
  $('#f-phone').value = b.phone || '';
  $('#f-date').value = b.date || '';
  $('#f-time').value = b.time || '';
  $('#f-package').value = b.package || '';
  $('#f-price').value = b.price || '';
  // المدة مخزَّنة بالدقائق وتُعرَض في الحقل بالساعات
  $('#f-duration').value = (b.duration != null ? b.duration : settings.defaultDuration) / 60;
  $('#f-paid').value = (b.paidAmount != null ? b.paidAmount : 0);
  // الحقول المالية الجديدة (الحجوزات القديمة بلا هذه الحقول ⇒ فارغة/أصفار)
  $('#f-expenses').value = (b.expenses != null && Number(b.expenses) > 0) ? b.expenses : '';
  $('#f-expense-note').value = b.expenseNote || '';
  $('#f-discount').value = (b.discount != null && Number(b.discount) > 0) ? b.discount : '';
  $('#f-status').value = b.status || 'confirmed';
  $('#f-notes').value = b.notes || '';

  $('#form-title').textContent = '✏️ تعديل الحجز';
  $('#btn-save').textContent = 'حفظ التعديل';
  $('#btn-reset').hidden = false;
  onPackageInput();        // حدّث تلميح محتوى الباقة وفق الباقة المختارة
  updateRemainingLine();   // أظهر سطر المتبقّي وفق السعر/الدفعة المعبّأة
  refreshDayWarning();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteBooking(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`حذف حجز «${b.name}»؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
  await DB.del('bookings', id);
  await loadBookings();
  if (editingId === id) resetForm();
  refreshAll();
  toast('تم حذف الحجز', 'ok');
}

function resetForm() {
  editingId = null;
  $('#booking-form').reset();
  $('#f-id').value = '';
  $('#f-date').value = todayStr();
  $('#f-duration').value = settings.defaultDuration / 60;   // المدة الافتراضية (ساعات)
  $('#f-paid').value = '';
  // تصفير الحقول المالية الجديدة
  $('#f-expenses').value = '';
  $('#f-expense-note').value = '';
  $('#f-discount').value = '';
  $('#form-title').textContent = '➕ حجز جديد';
  $('#btn-save').textContent = 'حفظ الحجز';
  $('#btn-reset').hidden = true;
  onPackageInput();        // أخفِ تلميح محتوى الباقة بعد التفريغ
  updateRemainingLine();   // أخفِ سطر المتبقّي بعد التفريغ
  refreshDayWarning();
}

/* ---------- مدّة الحجز وكشف التعارض بالمجالات ---------- */

// مدّة الحجز بالدقائق (مع اعتبار الحجوزات القديمة = المدة الافتراضية)
function bookingDuration(b) {
  const d = Number(b && b.duration);
  return Number.isFinite(d) && d > 0 ? d : (Number(settings.defaultDuration) || 60);
}

// نص عربي للمدة بالساعات للعرض فقط (الإدخال يبقى دقائق داخلياً): 30→«نصف ساعة»، 60→«ساعة»، 90→«ساعة ونصف»
function formatDurationHours(min) {
  const m = Number(min) || 0;
  if (m === 30) return 'نصف ساعة';
  if (m === 60) return 'ساعة';
  if (m === 90) return 'ساعة ونصف';
  const h = m / 60;
  // أظهر منزلة عشرية واحدة عند اللزوم فقط (مثل 1.5)، وإلا عدداً صحيحاً
  const hs = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
  return `${hs} ساعة`;
}

// قراءة قيمة حقل المدة (#f-duration) بالساعات وتحويلها للدقائق مرة واحدة عند حدود الإدخال.
// تبقى كل منطقيات التعارض/ساعات العمل تعمل بالدقائق كما هي.
function durationFieldMinutes() {
  const hrs = Number($('#f-duration').value);
  return hrs > 0 ? Math.max(1, Math.round(hrs * 60)) : (Number(settings.defaultDuration) || 60);
}

/* ---------- حالة الدفع والمتبقّي (مشتقّة حسب العقد) ---------- */

// المبلغ المدفوع (افتراضياً 0)
function bookingPaid(b) {
  const p = Number(b && b.paidAmount);
  return Number.isFinite(p) && p > 0 ? p : 0;
}

// السعر (افتراضياً 0)
function bookingPrice(b) {
  const p = Number(b && b.price);
  return Number.isFinite(p) && p > 0 ? p : 0;
}

/* ---------- العقد المالي: دوال محسوبة لكل حجز ----------
   تُعرَّف مرة واحدة وتُستخدم في كل مكان (لا تكرار للحساب).
   كل الحقول الجديدة افتراضها 0 ⇒ توافق رجعي تام مع الحجوزات القديمة. */

// مبلغ الخصم (افتراضياً 0)
function bookingDiscount(b) {
  return Math.max(0, Number(b && b.discount) || 0);
}

// الإجمالي بعد الخصم = ما على العميل
function bookingTotal(b) {
  return Math.max(0, bookingPrice(b) - bookingDiscount(b));
}

// الضريبة المُستخرَجة من إجمالي شامل الضريبة (إن كانت مفعّلة)
function bookingVat(b) {
  const rate = Number(settings.vatRate) || 0;
  return settings.vatEnabled ? bookingTotal(b) * (rate / (100 + rate)) : 0;
}

// الإيراد الصافي من الضريبة (إيرادك الفعلي)
function bookingRevenue(b) {
  return bookingTotal(b) - bookingVat(b);
}

// مصروفات الحجز المباشرة (افتراضياً 0)
function bookingExpenses(b) {
  return Math.max(0, Number(b && b.expenses) || 0);
}

// صافي الربح = الإيراد الصافي - مصروفات الحجز
function bookingNet(b) {
  return bookingRevenue(b) - bookingExpenses(b);
}

// هامش الربح % (حارس ضد القسمة على صفر)
function bookingMargin(b) {
  const rev = bookingRevenue(b);
  return rev > 0 ? (bookingNet(b) / rev) * 100 : 0;
}

// المتبقّي = max(0, الإجمالي بعد الخصم - المدفوع)
function bookingRemaining(b) {
  return Math.max(0, bookingTotal(b) - bookingPaid(b));
}

/* حالة الدفع المشتقّة (بناءً على الإجمالي بعد الخصم):
   paid<=0 ⇒ 'unpaid'، total>0 && paid>=total ⇒ 'paid'، غير ذلك ⇒ 'partial' */
function paymentStatus(b) {
  const paid = bookingPaid(b);
  const total = bookingTotal(b);
  if (paid <= 0) return 'unpaid';
  if (total > 0 && paid >= total) return 'paid';
  return 'partial';
}

const PAY_LABEL = { paid: 'مدفوع', partial: 'جزئي', unpaid: 'غير مدفوع' };

// تنسيق مبلغ مع العملة الحالية
function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US') + ' ' + (settings.currency || 'ر.س');
}

/* بناء كائن حجز مؤقّت من قيم النموذج الحالية لإعادة استخدام الدوال المحسوبة.
   يضمن تطابق حسابات الواجهة الحيّة مع منطق الحفظ والتقارير. */
function formBookingDraft() {
  return {
    price: Number($('#f-price').value) || 0,
    discount: Math.max(0, Number($('#f-discount') && $('#f-discount').value) || 0),
    expenses: Math.max(0, Number($('#f-expenses') && $('#f-expenses').value) || 0),
    paidAmount: Math.max(0, Number($('#f-paid').value) || 0),
  };
}

/* تحديث سطر «المتبقّي» الحي أسفل صف السعر/الدفعة في النموذج.
   المتبقّي = max(0, الإجمالي بعد الخصم - الدفعة الأولى). يظهر فقط عند وجود إجمالي>0.
   ويحدّث سطر «الصافي» (الصافي والهامش%) تبعاً للسعر/الخصم/المصروفات/الضريبة. */
function updateRemainingLine() {
  const draft = formBookingDraft();
  const line = $('#f-remaining-line');
  if (line) {
    const total = bookingTotal(draft);
    if (total > 0) {
      const remaining = bookingRemaining(draft);
      const discount = bookingDiscount(draft);
      const vat = bookingVat(draft);
      line.innerHTML = `المتبقّي: <b>${esc(fmtMoney(remaining))}</b>`
        + (discount > 0 ? ` <span class="rl-extra">• بعد خصم ${esc(fmtMoney(discount))}</span>` : '')
        + (vat > 0 ? ` <span class="rl-extra">• ضريبة ${esc(fmtMoney(vat))}</span>` : '');
      line.hidden = false;
    } else {
      line.textContent = '';
      line.hidden = true;
    }
  }
  updateNetLine(draft);
}

/* سطر «الصافي» الحي: صافي الربح والهامش% للحجز الحالي.
   يظهر عند وجود إيراد>0 أو مصروفات>0، ويُخفى خلاف ذلك. */
function updateNetLine(draft) {
  const net = $('#f-net-line');
  if (!net) return;
  const d = draft || formBookingDraft();
  const revenue = bookingRevenue(d);
  const expenses = bookingExpenses(d);
  if (revenue > 0 || expenses > 0) {
    const netVal = bookingNet(d);
    const margin = bookingMargin(d);
    const cls = netVal < 0 ? 'neg' : (margin < (Number(settings.lowMarginThreshold) || 0) ? 'low' : 'pos');
    net.className = 'net-line ' + cls;
    net.innerHTML = `الصافي: <b>${esc(fmtMoney(netVal))}</b>`
      + ` <span class="nl-margin">هامش ${margin.toFixed(1)}%</span>`
      + (expenses > 0 ? ` <span class="nl-extra">• مصروفات ${esc(fmtMoney(expenses))}</span>` : '');
    net.hidden = false;
  } else {
    net.textContent = '';
    net.hidden = true;
  }
}

// هل يتقاطع مجالان زمنيان [s1,e1) و [s2,e2)؟
function intervalsOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

/* إيجاد الحجوزات المتعارضة فعلياً (تقاطع المجالات) في نفس اليوم.
   نتجاهل: الملغي، والسجل المستثنى (قيد التعديل)، وأي سجل بلا وقت. */
function findConflicts(date, time, duration, ignoreId) {
  if (!date || !time) return [];
  const start = toMinutes(time);
  const dur = Math.max(1, Number(duration) || (Number(settings.defaultDuration) || 60));
  const end = start + dur;
  return bookings.filter((b) => {
    if (b.id === ignoreId) return false;
    if (b.date !== date) return false;
    if (b.status === 'cancelled') return false;
    if (!b.time) return false;
    const bs = toMinutes(b.time);
    const be = bs + bookingDuration(b);
    return intervalsOverlap(start, end, bs, be);
  });
}

/* ---------- تحذير وجود موعد في نفس اليوم / تعارض ---------- */
function refreshDayWarning() {
  const box = $('#day-warning');
  const date = $('#f-date').value;
  const time = $('#f-time').value;
  if (!date) { box.hidden = true; return; }

  const sameDay = bookings
    .filter((b) => b.date === date && b.id !== editingId && b.status !== 'cancelled')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // تنبيه الخروج عن أيام/ساعات العمل (لا يمنع الحفظ)
  const offHoursMsg = workHoursNotice(date, time);

  if (!sameDay.length) {
    if (offHoursMsg) {
      box.className = 'warning';
      box.innerHTML = `<b>${offHoursMsg}</b>`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    return;
  }

  // التعارض الفعلي = تقاطع المجالات الزمنية مع المدة الحالية (بالدقائق)
  const duration = durationFieldMinutes();
  const conflictIds = new Set(findConflicts(date, time, duration, editingId).map((b) => b.id));
  const hasConflict = conflictIds.size > 0;

  const items = sameDay.map((b) => {
    const clash = conflictIds.has(b.id);
    return `<li>
      <span class="wtime">${formatTime12(b.time)}</span>
      <span>${esc(b.name)}${b.package ? ' — ' + esc(b.package) : ''}</span>
      ${clash ? '<span style="margin-inline-start:auto;font-weight:700">⛔ تعارض</span>' : ''}
    </li>`;
  }).join('');

  box.className = 'warning' + (hasConflict ? ' conflict' : '');
  box.innerHTML =
    `<b>${hasConflict ? '⛔ تعارض في الموعد!' : '⚠️ تنبيه: يوجد ' + sameDay.length + ' موعد في نفس اليوم'}</b>
     ${offHoursMsg ? `<b>${offHoursMsg}</b>` : ''}
     <ul>${items}</ul>`;
  box.hidden = false;
}

/* رسالة تنبيه عند وقوع الموعد خارج أيام العمل أو خارج المجال [بداية, نهاية).
   ترجع نصاً للعرض، أو '' إن كان ضمن النطاق. لا تمنع الحفظ. */
function workHoursNotice(date, time) {
  if (!date) return '';
  const wd = new Date(date + 'T00:00').getDay();
  if (Array.isArray(settings.workDays) && !settings.workDays.includes(wd)) {
    return `⏰ تنبيه: اليوم (${weekdayName(date)}) خارج أيام العمل`;
  }
  if (time) {
    const start = toMinutes(time);
    const duration = durationFieldMinutes();   // المدة بالدقائق (الحقل بالساعات)
    const end = start + duration;
    const ws = toMinutes(settings.workStart);
    const we = toMinutes(settings.workEnd);
    if (start < ws || end > we) {
      return `⏰ تنبيه: الموعد خارج ساعات العمل (${settings.workStart} - ${settings.workEnd})`;
    }
  }
  return '';
}

function toMinutes(t) {
  if (!t) return -999;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/* ---------- الباقات ---------- */
function onPackageInput() {
  const val = $('#f-package').value.trim();
  const p = packages.find((x) => x.name === val);
  if (p && !$('#f-price').value) $('#f-price').value = p.price || '';

  // تلميح محتوى الباقة: يظهر عند مطابقة باقة لها وصف، ويُخفى خلاف ذلك
  const hint = $('#package-hint');
  if (hint) {
    const desc = p && p.desc ? String(p.desc).trim() : '';
    if (desc) {
      hint.textContent = desc;
      hint.hidden = false;
    } else {
      hint.textContent = '';
      hint.hidden = true;
    }
  }
}

function renderPackages() {
  // قائمة الاقتراحات في النموذج
  $('#packages-list').innerHTML = packages
    .map((p) => `<option value="${esc(p.name)}">${p.price ? p.price + ' ' + esc(settings.currency) : ''}</option>`).join('');

  // قائمة الإدارة في الإعدادات
  $('#pkg-list').innerHTML = packages.length
    ? packages.map((p) => `
      <div class="pkg-item">
        <span class="pn">
          ${esc(p.name)}
          ${p.desc ? `<span class="pkg-desc">${esc(p.desc)}</span>` : ''}
        </span>
        <span class="pp">${p.price ? p.price + ' ' + esc(settings.currency) : '—'}</span>
        <button class="icon-btn" onclick="removePackage('${p.id}')">🗑</button>
      </div>`).join('')
    : '<p class="hint">لا توجد باقات بعد.</p>';
}

async function addPackage() {
  const name = $('#pkg-name').value.trim();
  const price = Number($('#pkg-price').value) || 0;
  const desc = $('#pkg-desc').value.trim();
  if (!name) { toast('اكتب اسم الباقة', 'err'); return; }
  const p = { id: uid(), name, price, desc };
  await DB.put('packages', p);
  packages.push(p);
  $('#pkg-name').value = '';
  $('#pkg-price').value = '';
  $('#pkg-desc').value = '';
  renderPackages();
  toast('تمت إضافة الباقة ✓', 'ok');
}

async function removePackage(id) {
  await DB.del('packages', id);
  packages = packages.filter((p) => p.id !== id);
  renderPackages();
}

/* ---------- العرض ---------- */
function refreshAll() {
  renderStats();
  renderList();
  if (viewMode === 'calendar') renderCalendar();
}

function renderStats() {
  const today = todayStr();
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const todayCount = active.filter((b) => b.date === today).length;
  const upcoming = active.filter((b) => b.date >= today).length;
  const revenue = active.reduce((s, b) => s + bookingPrice(b), 0);
  const remaining = active.reduce((s, b) => s + bookingRemaining(b), 0);
  // صافي ربح الحجوزات غير الملغاة (مجموع bookingNet لكل حجز)
  const net = active.reduce((s, b) => s + bookingNet(b), 0);

  $('#stat-today').textContent = todayCount;
  $('#stat-upcoming').textContent = upcoming;
  $('#stat-total').textContent = bookings.length;
  $('#stat-revenue').innerHTML = revenue.toLocaleString('en-US') + ` <small>${esc(settings.currency)}</small>`;
  // صافي الربح الإجمالي تحت بطاقة قيمة الحجوزات (يظهر دائماً ما دام هناك حجوزات نشطة)
  const netEl = $('#stat-net');
  if (netEl) {
    if (active.length) {
      netEl.textContent = `الصافي: ${fmtMoney(net)}`;
      netEl.className = 'stat-sub ' + (net < 0 ? 'neg' : 'pos');
    } else {
      netEl.textContent = '';
      netEl.className = 'stat-sub';
    }
  }
  // المتبقّي الإجمالي تحت بطاقة قيمة الحجوزات (يظهر فقط عند وجود متبقٍّ)
  const remEl = $('#stat-remaining');
  if (remEl) {
    remEl.textContent = remaining > 0 ? `المتبقّي: ${fmtMoney(remaining)}` : '';
  }
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const scope = $('#filter-scope').value;
  const status = $('#filter-status').value;
  const today = todayStr();

  let rows = bookings.slice();

  // تصفية على يوم محدّد (قادمة من النقر في التقويم) لها الأولوية على النطاق
  if (dayFilter) {
    rows = rows.filter((b) => b.date === dayFilter);
  } else if (scope === 'today') {
    rows = rows.filter((b) => b.date === today);
  } else if (scope === 'upcoming') {
    rows = rows.filter((b) => b.date >= today);
  } else if (scope === 'past') {
    rows = rows.filter((b) => b.date < today);
  }

  if (status) rows = rows.filter((b) => b.status === status);
  if (q) rows = rows.filter((b) =>
    (b.name || '').toLowerCase().includes(q) || (b.phone || '').includes(q));

  // الترتيب: الأقرب أولاً (تصاعدي للقادمة، تنازلي للسابقة)
  rows.sort((a, b) => {
    const ka = (a.date || '') + (a.time || '');
    const kb = (b.date || '') + (b.time || '');
    return (!dayFilter && scope === 'past') ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });

  const body = $('#bookings-body');
  const empty = $('#empty-state');
  const tableEl = $('#bookings-table');

  // شارة تصفية اليوم المحدّد (مع زر مسح)
  const chip = $('#day-filter-clear');
  if (dayFilter) {
    chip.innerHTML = `✕ ${esc(dayFilter)} (${weekdayName(dayFilter)})`;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }

  $('#list-count').textContent = `${rows.length} حجز`;

  if (!rows.length) {
    body.innerHTML = '';
    tableEl.style.display = 'none';
    empty.hidden = false;
    return;
  }
  tableEl.style.display = '';
  empty.hidden = true;

  const lowMargin = Number(settings.lowMarginThreshold) || 0;
  body.innerHTML = rows.map((b) => {
    const isToday = b.date === today;
    const pay = paymentStatus(b);          // حالة الدفع المشتقّة
    const remaining = bookingRemaining(b); // المتبقّي
    // مؤشّرات الربحية (الدوال المحسوبة — لا تكرار للحساب)
    const revenue = bookingRevenue(b);
    const net = bookingNet(b);
    const margin = bookingMargin(b);
    // تنبيه «ربح منخفض»: إيراد>0 والهامش أقل من الحد المضبوط (غير الملغاة فقط)
    const isLow = b.status !== 'cancelled' && revenue > 0 && margin < lowMargin;
    const netCls = net < 0 ? 'neg' : (isLow ? 'low' : 'pos');
    return `<tr class="${b.status}${isLow ? ' is-low-margin' : ''}">
      <td>
        <span class="cell-name">${esc(b.name)}</span>
        ${b.phone ? `<span class="cell-sub">${esc(b.phone)}</span>` : ''}
        ${b.notes ? `<span class="cell-sub" title="${esc(b.notes)}">📝 ${esc(b.notes.slice(0, 30))}${b.notes.length > 30 ? '…' : ''}</span>` : ''}
      </td>
      <td>
        ${esc(b.date)}
        <span class="cell-sub">${weekdayName(b.date)}${isToday ? ' • اليوم' : ''}</span>
      </td>
      <td>${formatTime12(b.time)}</td>
      <td>
        ${esc(b.package) || '—'}
        ${b.price ? `<span class="cell-sub">${Number(b.price).toLocaleString('en-US')} ${esc(settings.currency)}</span>` : ''}
        <span class="pay-line">
          <span class="pay-badge ${pay}">${PAY_LABEL[pay]}</span>
          ${remaining > 0 ? `<span class="pay-rem">متبقّي ${esc(fmtMoney(remaining))}</span>` : ''}
        </span>
        ${(revenue > 0 || bookingExpenses(b) > 0) ? `<span class="net-line-row ${netCls}">
          <span class="nlr-net">صافي ${esc(fmtMoney(net))}</span>
          <span class="nlr-margin">${margin.toFixed(1)}%</span>
          ${isLow ? '<span class="nlr-warn">⚠️ ربح منخفض</span>' : ''}
        </span>` : ''}
      </td>
      <td><span class="badge ${b.status}">${STATUS_LABEL[b.status] || ''}</span></td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="a-edit" title="تعديل" onclick="editBooking('${b.id}')">✏️</button>
          <button class="a-bell" title="تذكير بإشعار" onclick="notifyBooking('${b.id}')">🔔</button>
          ${b.phone ? `<button class="a-wa" title="تذكير واتساب" onclick="sendWhatsApp('${b.id}')">💬</button>` : ''}
          <button class="a-del" title="حذف" onclick="deleteBooking('${b.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ===================================================== */
/* ---------- التقويم (شهري / أسبوعي) ---------- */
/* ===================================================== */

// تبديل بين عرض القائمة والتقويم (يظهر أحدهما فقط)
function setView(mode) {
  viewMode = mode === 'calendar' ? 'calendar' : 'list';
  const isCal = viewMode === 'calendar';
  $('#list-view').hidden = isCal;
  $('#calendar-view').hidden = !isCal;
  $('#view-list-btn').classList.toggle('is-active', !isCal);
  $('#view-cal-btn').classList.toggle('is-active', isCal);
  $('#view-list-btn').setAttribute('aria-selected', String(!isCal));
  $('#view-cal-btn').setAttribute('aria-selected', String(isCal));
  if (isCal) renderCalendar();
}

// تبديل مدى التقويم (شهري/أسبوعي)
function setCalMode(mode) {
  calMode = mode === 'week' ? 'week' : 'month';
  $('#cal-mode-month').classList.toggle('is-active', calMode === 'month');
  $('#cal-mode-week').classList.toggle('is-active', calMode === 'week');
  $('#cal-mode-month').setAttribute('aria-selected', String(calMode === 'month'));
  $('#cal-mode-week').setAttribute('aria-selected', String(calMode === 'week'));
  renderCalendar();
}

// التنقّل للأمام/للخلف (شهر أو أسبوع حسب الوضع)
function shiftCalendar(dir) {
  if (calMode === 'week') {
    calCursor.setDate(calCursor.getDate() + dir * 7);
  } else {
    // الانتقال لليوم الأول لتفادي مشاكل نهايات الشهر (مثل 31)
    calCursor.setDate(1);
    calCursor.setMonth(calCursor.getMonth() + dir);
  }
  calCursor = new Date(calCursor);
  renderCalendar();
}

// فهرسة الحجوزات حسب التاريخ مع حساب الازدحام والتعارض لكل يوم
function bookingsByDate() {
  const map = new Map();
  for (const b of bookings) {
    if (!b.date) continue;
    if (!map.has(b.date)) map.set(b.date, []);
    map.get(b.date).push(b);
  }
  return map;
}

// هل يوجد تعارض زمني فعلي بين حجوزات نفس اليوم؟
function dayHasConflict(list) {
  const active = list.filter((b) => b.status !== 'cancelled' && b.time);
  for (let i = 0; i < active.length; i++) {
    const s1 = toMinutes(active[i].time);
    const e1 = s1 + bookingDuration(active[i]);
    for (let j = i + 1; j < active.length; j++) {
      const s2 = toMinutes(active[j].time);
      const e2 = s2 + bookingDuration(active[j]);
      if (intervalsOverlap(s1, e1, s2, e2)) return true;
    }
  }
  return false;
}

// الرسم الرئيسي: يختار شهري أو أسبوعي
function renderCalendar() {
  if (calMode === 'week') renderCalendarWeek();
  else renderCalendarMonth();
}

// رؤوس أيام الأسبوع العربية المختصرة (تبدأ من الأحد)
function renderWeekdayHeaders() {
  $('#cal-weekdays').innerHTML = AR_DAYS_SHORT
    .map((d) => `<div class="cal-wd">${d}</div>`).join('');
}

// بناء خلية يوم واحدة (تُستخدم في الشهري والأسبوعي)
// map: فهرس الحجوزات حسب التاريخ، today: تاريخ اليوم (يُحسبان مرة واحدة لكل رسم)
function buildDayCell(dateObj, inMonth, map, today) {
  const ds = dateToStr(dateObj);
  const list = (map.get(ds) || [])
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const activeCount = list.filter((b) => b.status !== 'cancelled').length;
  const conflict = dayHasConflict(list);
  const busy = activeCount >= 3;   // يوم مزدحم: 3 مواعيد فأكثر

  const cls = ['cal-day'];
  if (!inMonth) cls.push('is-out');
  if (ds === today) cls.push('is-today');
  if (busy) cls.push('is-busy');
  if (conflict) cls.push('is-conflict');

  // أول 3 مواعيد مصغّرة (وقت + اسم)
  const maxShow = 3;
  const mini = list.slice(0, maxShow).map((b) =>
    `<button type="button" class="cal-ev ${esc(b.status)}" title="${esc(b.name)}${b.time ? ' • ' + esc(formatTime12(b.time)) : ''}" data-edit="${esc(b.id)}">
      <span class="ev-t">${b.time ? esc(formatTime12(b.time)) : '—'}</span>
      <span class="ev-n">${esc(b.name)}</span>
    </button>`).join('');
  const more = list.length > maxShow ? `<span class="cal-more">+${list.length - maxShow} غير ذلك</span>` : '';
  const badge = activeCount ? `<span class="cal-count">${activeCount}</span>` : '';

  return `<div class="${cls.join(' ')}" data-date="${ds}">
    <div class="cal-day-head">
      <span class="cal-dnum">${dateObj.getDate()}</span>
      ${badge}
    </div>
    <div class="cal-events">${mini}${more}</div>
  </div>`;
}

// العرض الشهري: شبكة 7 أعمدة من الأحد، مع أيام الشهر المجاور لملء الصفوف
function renderCalendarMonth() {
  renderWeekdayHeaders();
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  $('#cal-title').textContent = `${AR_MONTHS[m]} ${y}`;

  const first = new Date(y, m, 1);
  // ابدأ من الأحد السابق لليوم الأول
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const map = bookingsByDate();
  const today = todayStr();
  let cells = '';
  const cur = new Date(start);
  // 6 أسابيع × 7 أيام = 42 خلية لتغطية كل الأشهر
  for (let i = 0; i < 42; i++) {
    cells += buildDayCell(cur, cur.getMonth() === m, map, today);
    cur.setDate(cur.getDate() + 1);
  }
  const grid = $('#cal-grid');
  grid.className = 'cal-grid';
  grid.innerHTML = cells;
}

// العرض الأسبوعي: الأسبوع الحالي (الأحد→السبت) بصف واحد من 7 خلايا
function renderCalendarWeek() {
  renderWeekdayHeaders();
  const start = new Date(calCursor);
  start.setDate(start.getDate() - start.getDay());   // أحد الأسبوع
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  // عنوان: نطاق الأسبوع
  const sameMonth = start.getMonth() === end.getMonth();
  $('#cal-title').textContent = sameMonth
    ? `${start.getDate()} – ${end.getDate()} ${AR_MONTHS[end.getMonth()]} ${end.getFullYear()}`
    : `${start.getDate()} ${AR_MONTHS[start.getMonth()]} – ${end.getDate()} ${AR_MONTHS[end.getMonth()]} ${end.getFullYear()}`;

  const map = bookingsByDate();
  const today = todayStr();
  let cells = '';
  const cur = new Date(start);
  for (let i = 0; i < 7; i++) {
    cells += buildDayCell(cur, true, map, today);   // كل أيام الأسبوع داخل النطاق
    cur.setDate(cur.getDate() + 1);
  }
  const grid = $('#cal-grid');
  grid.className = 'cal-grid is-week';
  grid.innerHTML = cells;
}

// النقر على التقويم: موعد مصغّر ⇒ تعديل، أو يوم ⇒ تصفية القائمة وتعبئة التاريخ
function onCalendarClick(e) {
  const evBtn = e.target.closest('[data-edit]');
  if (evBtn) {
    e.stopPropagation();
    editBooking(evBtn.getAttribute('data-edit'));
    return;
  }
  const cell = e.target.closest('.cal-day');
  if (!cell) return;
  const ds = cell.getAttribute('data-date');
  if (!ds) return;
  // عبّئ التاريخ في النموذج لتسهيل الإضافة
  $('#f-date').value = ds;
  refreshDayWarning();
  // بدّل إلى القائمة مفلترة على ذلك اليوم
  dayFilter = ds;
  setView('list');
  renderList();
}

/* ---------- واتساب ---------- */
function sendWhatsApp(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b || !b.phone) return;
  let num = b.phone.replace(/\D/g, '');
  if (num.startsWith('00')) num = num.slice(2);
  else if (num.startsWith('0')) num = (settings.cc || '966') + num.slice(1);
  else if (!num.startsWith(settings.cc || '966') && num.length <= 10) num = (settings.cc || '966') + num;

  const msg = `مرحباً ${b.name} 🌸\nنذكّركم بموعدكم:\n📅 ${b.date} (${weekdayName(b.date)})\n🕐 ${formatTime12(b.time)}` +
    (b.package ? `\n💼 ${b.package}` : '') +
    `\n\n${settings.biz}`;
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ===================================================== */
/* ---------- إشعارات التذكير (Notification API) ---------- */
/* ===================================================== */

// هل إشعارات المتصفح مدعومة في هذه البيئة؟ (تعامل آمن دون رمي استثناء)
function notifySupported() {
  try { return typeof window !== 'undefined' && 'Notification' in window; }
  catch (_) { return false; }
}

// حالة الإذن الحالية: 'granted' | 'denied' | 'default' | 'unsupported'
function notifyPermission() {
  if (!notifySupported()) return 'unsupported';
  try { return Notification.permission; } catch (_) { return 'unsupported'; }
}

// تحديث السطر التوضيحي وزر التفعيل في الإعدادات حسب حالة الإذن
function updateNotifyUI() {
  const btn = $('#btn-notify');
  const st = $('#notify-status');
  if (!btn || !st) return;
  const perm = notifyPermission();
  if (perm === 'unsupported') {
    btn.disabled = true;
    st.textContent = '⚠️ متصفحك لا يدعم الإشعارات';
    st.className = 'notify-status warn';
  } else if (perm === 'granted') {
    btn.disabled = false;
    btn.textContent = '🔔 الإشعارات مفعّلة ✓';
    st.textContent = settings.notifyEnabled ? 'سيتم تذكيرك بالمواعيد طالما التطبيق مفتوح.' : 'الإذن ممنوح. فعّل التذكير من الزر.';
    st.className = 'notify-status ok';
  } else if (perm === 'denied') {
    btn.disabled = false;
    btn.textContent = '🔔 تفعيل إشعارات التذكير';
    st.textContent = '🚫 الإشعارات محظورة من إعدادات المتصفح.';
    st.className = 'notify-status warn';
  } else {
    btn.disabled = false;
    btn.textContent = '🔔 تفعيل إشعارات التذكير';
    st.textContent = '';
    st.className = 'notify-status';
  }
}

// زر «تفعيل إشعارات التذكير»: يطلب الإذن ويحفظ notifyEnabled
async function enableNotifications() {
  if (!notifySupported()) { toast('متصفحك لا يدعم الإشعارات', 'err'); return; }
  let perm = notifyPermission();
  try {
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
  } catch (_) {
    // قد يرمي بعض المتصفحات إن استُدعي خارج تفاعل المستخدم — تجاهل بأمان
    perm = notifyPermission();
  }
  if (perm === 'granted') {
    settings.notifyEnabled = true;
    await DB.put('settings', { key: 'notifyEnabled', value: true });
    updateNotifyUI();
    toast('تم تفعيل إشعارات التذكير ✓', 'ok');
    // افحص فوراً بعد التفعيل
    scanReminders();
  } else if (perm === 'denied') {
    settings.notifyEnabled = false;
    await DB.put('settings', { key: 'notifyEnabled', value: false });
    updateNotifyUI();
    toast('الإشعارات محظورة من إعدادات المتصفح', 'err');
  } else {
    updateNotifyUI();
  }
}

// إظهار إشعار واحد بأمان (يُرجع true إن نجح)
function showNotification(title, body) {
  if (notifyPermission() !== 'granted') return false;
  try {
    const n = new Notification(title, {
      body: body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      lang: 'ar',
      dir: 'rtl',
    });
    // إغلاق تلقائي بعد قليل (بعض المنصات تتجاهله، لا بأس)
    setTimeout(() => { try { n.close(); } catch (_) {} }, 15000);
    return true;
  } catch (_) {
    return false;
  }
}

// نص جسم الإشعار لحجز معيّن
function reminderBody(b) {
  return `${b.name || ''} — ${formatTime12(b.time)}` +
    (b.package ? ` • ${b.package}` : '') +
    `\n${b.date} (${weekdayName(b.date)})`;
}

// مفتاح localStorage لتتبّع ما تم التنبيه عنه (تاريخ اليوم + معرّف الحجز + نوع)
function reminderKey(id, kind) {
  return `ohood-notified:${todayStr()}:${kind}:${id}`;
}

// هل سبق التنبيه عن هذا الحجز اليوم بهذا النوع؟ (تعامل آمن مع غياب localStorage)
function wasNotified(id, kind) {
  try { return localStorage.getItem(reminderKey(id, kind)) === '1'; }
  catch (_) { return false; }
}

// تعليم الحجز كمُنبَّه عنه اليوم
function markNotified(id, kind) {
  try { localStorage.setItem(reminderKey(id, kind), '1'); } catch (_) {}
}

// مسح مفاتيح التنبيه القديمة (أيام سابقة) لتفادي تضخّم localStorage
function pruneReminderKeys() {
  try {
    const today = todayStr();
    const toDel = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ohood-notified:') && !k.startsWith(`ohood-notified:${today}:`)) {
        toDel.push(k);
      }
    }
    toDel.forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}

/* المرور على الحجوزات غير الملغاة وإظهار تذكير لمواعيد «غداً»،
   ومواعيد «اليوم» التي اقترب وقتها (خلال 60 دقيقة قادمة ولم يفُت)،
   مع تفادي التكرار عبر localStorage. آمن تماماً إن لم تُمنح الأذونات. */
function scanReminders() {
  if (!settings.notifyEnabled) return;
  if (notifyPermission() !== 'granted') return;

  pruneReminderKeys();

  const now = new Date();
  const today = dateToStr(now);
  const tomorrow = dateToStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const SOON = 60; // نافذة «اقترب وقته» بالدقائق

  for (const b of bookings) {
    if (!b || b.status === 'cancelled' || !b.date || !b.time) continue;

    // موعد الغد: ذكّر مرة واحدة في اليوم
    if (b.date === tomorrow) {
      if (!wasNotified(b.id, 'tomorrow')) {
        if (showNotification('📅 تذكير بموعد الغد', reminderBody(b))) {
          markNotified(b.id, 'tomorrow');
        }
      }
      continue;
    }

    // موعد اليوم الذي اقترب وقته ولم يفُت بعد
    if (b.date === today) {
      const start = toMinutes(b.time);
      const diff = start - nowMin;
      if (diff >= 0 && diff <= SOON && !wasNotified(b.id, 'soon')) {
        if (showNotification('⏰ موعدك قريب', reminderBody(b))) {
          markNotified(b.id, 'soon');
        }
      }
    }
  }
}

// إرسال تذكير فوري يدوي لحجز محدّد (زر 🔔 بجانب الحجز)
async function notifyBooking(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  if (!notifySupported()) { toast('متصفحك لا يدعم الإشعارات', 'err'); return; }

  let perm = notifyPermission();
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (_) { perm = notifyPermission(); }
    if (perm === 'granted') {
      settings.notifyEnabled = true;
      await DB.put('settings', { key: 'notifyEnabled', value: true });
      updateNotifyUI();
    }
  }
  if (perm !== 'granted') { toast('الإشعارات غير مفعّلة', 'err'); return; }

  if (showNotification('🔔 تذكير بموعد', reminderBody(b))) {
    toast('تم إرسال إشعار التذكير ✓', 'ok');
  } else {
    toast('تعذّر إرسال الإشعار', 'err');
  }
}

// بدء مؤقّت الفحص الدوري (~كل 5 دقائق) طالما الصفحة مفتوحة
let reminderTimer = null;
function startReminderTimer() {
  // افحص مرة عند الإقلاع ثم كل 5 دقائق
  scanReminders();
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(scanReminders, 5 * 60 * 1000);
}

/* ===================================================== */
/* ---------- التقارير الشهرية ---------- */
/* ===================================================== */

/* ---------- أدوات الفترة الزمنية ---------- */

// أول يوم في شهر تاريخٍ ما (YYYY-MM-DD)
function firstOfMonth(d) { return dateToStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
// آخر يوم في شهر تاريخٍ ما (YYYY-MM-DD)
function lastOfMonth(d) { return dateToStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

// إزالة فعّال «نشط» عن أزرار الاختصارات (عند تعديل الحقول يدوياً)
function clearQuickActive() {
  $$('.rq-btn').forEach((b) => b.classList.remove('is-active'));
}

// ضبط حقلي من/إلى وفق اختصار سريع
function applyQuickRange(kind) {
  const now = new Date();
  let from = '';
  let to = '';
  if (kind === 'month') {
    from = firstOfMonth(now); to = lastOfMonth(now);
  } else if (kind === 'last-month') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    from = firstOfMonth(lm); to = lastOfMonth(lm);
  } else if (kind === '30') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    from = dateToStr(start); to = dateToStr(now);
  } else if (kind === 'year') {
    from = dateToStr(new Date(now.getFullYear(), 0, 1));
    to = dateToStr(new Date(now.getFullYear(), 11, 31));
  } else if (kind === 'all') {
    // أوسع نطاق ممكن من بيانات الحجوزات الفعلية
    const dates = bookings.map((b) => b.date).filter(Boolean).sort();
    from = dates.length ? dates[0] : firstOfMonth(now);
    to = dates.length ? dates[dates.length - 1] : lastOfMonth(now);
    // إن امتد المدى للمستقبل، وسّع «إلى» ليشمل آخر حجز
    if (to < dateToStr(now)) to = dateToStr(now);
  }
  $('#report-from').value = from;
  $('#report-to').value = to;
}

// قراءة الفترة الحالية من الحقلين، مع ضمان from<=to (تبديل عند اللزوم)
function reportRange() {
  let from = $('#report-from').value || '';
  let to = $('#report-to').value || '';
  if (from && to && from > to) { const t = from; from = to; to = t; }
  return { from, to };
}

// تصفية الحجوزات التي تاريخها داخل [from..to] شاملًا الطرفين
function bookingsInRange(from, to) {
  return bookings.filter((b) => {
    const d = b.date || '';
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// عدد الأيام في فترة [from..to] شاملًا الطرفين (1 على الأقل)
function rangeDays(from, to) {
  if (!from || !to) return 1;
  const a = new Date(from + 'T00:00');
  const b = new Date(to + 'T00:00');
  const ms = b - a;
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// عدد أشهر الفترة حسب العقد = (سنةإلى*12+شهرإلى) - (سنةمن*12+شهرمن) + 1
function rangeMonths(from, to) {
  if (!from || !to) return 1;
  const a = new Date(from + 'T00:00');
  const b = new Date(to + 'T00:00');
  const m = (b.getFullYear() * 12 + b.getMonth()) - (a.getFullYear() * 12 + a.getMonth()) + 1;
  return Math.max(1, m);
}

/* تجميع الإجماليات المالية لفترة (تُحسب على غير الملغاة داخل الفترة).
   يرجع كائناً بكل المؤشرات اللازمة للوحة، مع الحراسة ضد القسمة على صفر. */
function periodTotals(from, to) {
  const all = bookingsInRange(from, to);                 // كل حجوزات الفترة (شاملة الملغاة)
  const active = all.filter((b) => b.status !== 'cancelled');

  const revenue = active.reduce((s, b) => s + bookingRevenue(b), 0);   // إجمالي الإيراد الصافي من الضريبة
  const bookingExp = active.reduce((s, b) => s + bookingExpenses(b), 0); // مصروفات الحجوزات
  const vat = active.reduce((s, b) => s + bookingVat(b), 0);            // إجمالي الضريبة
  const collected = active.reduce((s, b) => s + bookingPaid(b), 0);     // المُحصّل
  const remaining = active.reduce((s, b) => s + bookingRemaining(b), 0); // المتبقّي

  const months = rangeMonths(from, to);
  const fixed = fixedExpensesTotal() * months;            // المصروفات الثابتة للفترة
  const net = revenue - bookingExp - fixed;               // صافي ربح الفترة
  const margin = revenue > 0 ? (net / revenue) * 100 : 0; // هامش الفترة %

  const total = all.length;
  const cancelled = all.length - active.length;
  const cancelRate = total > 0 ? (cancelled / total) * 100 : 0;
  const avgBooking = active.length > 0 ? revenue / active.length : 0;
  const avgNet = active.length > 0 ? net / active.length : 0;

  return {
    all, active, revenue, bookingExp, vat, fixed, net, margin,
    collected, remaining, count: total, activeCount: active.length,
    cancelled, cancelRate, avgBooking, avgNet, months,
  };
}

/* ---------- الاتجاه الشهري (للرسم البياني) ----------
   يبني صفاً لكل شهر يتقاطع مع الفترة [from..to]، يقصّ الشهر الأول/الأخير على حدود الفترة.
   لكل شهر: الإيراد = Σ bookingRevenue، المصروفات = Σ bookingExpenses + المصروفات الثابتة الشهرية،
   الصافي = الإيراد - المصروفات (تتطابق الأعمدة الثلاثة بصرياً: صافي = إيراد - مصروفات).
   يُحسب على غير الملغاة فقط. */
function monthlyTrend(from, to) {
  if (!from || !to) return [];
  const a = new Date(from + 'T00:00');
  const b = new Date(to + 'T00:00');
  const fixedMonthly = fixedExpensesTotal();
  const rows = [];
  // ابدأ من أول الشهر الذي يقع فيه «from» وتقدّم شهراً شهراً حتى شهر «to»
  let cur = new Date(a.getFullYear(), a.getMonth(), 1);
  const endKey = b.getFullYear() * 12 + b.getMonth();
  // حارس ضد أي مدى غير منطقي (حد أقصى 600 شهر = 50 سنة)
  for (let guard = 0; guard < 600; guard++) {
    const curKey = cur.getFullYear() * 12 + cur.getMonth();
    if (curKey > endKey) break;
    // حدود الشهر مقصوصة على حدود الفترة
    const mFirst = firstOfMonth(cur);
    const mLast = lastOfMonth(cur);
    const lo = mFirst < from ? from : mFirst;
    const hi = mLast > to ? to : mLast;
    const list = bookingsInRange(lo, hi).filter((x) => x.status !== 'cancelled');
    const revenue = list.reduce((s, x) => s + bookingRevenue(x), 0);
    const expenses = list.reduce((s, x) => s + bookingExpenses(x), 0) + fixedMonthly;
    rows.push({
      key: dateToStr(cur).slice(0, 7),
      label: `${AR_MONTHS[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
      revenue,
      expenses,
      net: revenue - expenses,
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return rows;
}

/* رسم شريط تقدّم نحو هدف (مع الحراسة ضد القسمة على صفر).
   يرجّع HTML لشريط واحد: التسمية، القيمة/الهدف، النسبة، وتلوين عند بلوغ الهدف. */
function goalBarHtml(label, value, target) {
  const tgt = Math.max(0, Number(target) || 0);
  if (tgt <= 0) return '';   // هدف غير مفعّل
  const val = Number(value) || 0;
  const pct = (val / tgt) * 100;
  const reached = val >= tgt;
  const width = Math.max(0, Math.min(100, pct));   // عرض الشريط محصور بين 0 و100%
  const cls = reached ? 'reached' : (val < 0 ? 'neg' : '');
  return `<div class="goal-row">
    <div class="goal-top">
      <span class="goal-label">${esc(label)}${reached ? ' <span class="goal-check">✓ تحقّق</span>' : ''}</span>
      <span class="goal-pct ${cls}">${pct.toFixed(1)}%</span>
    </div>
    <div class="goal-track"><span class="goal-fill ${cls}" style="width:${width.toFixed(1)}%"></span></div>
    <div class="goal-sub">${esc(fmtMoney(val))} <span class="goal-of">من ${esc(fmtMoney(tgt))}</span></div>
  </div>`;
}

/* لوحة الأهداف الشهرية: تقدّم الإيراد مقابل targetRevenue والصافي مقابل targetProfit.
   الأهداف شهرية، فإن امتدت الفترة لعدة أشهر نضرب الهدف في عدد الأشهر للمقارنة العادلة. */
function goalsHtml(t) {
  const months = Math.max(1, t.months || 1);
  const revTarget = (Number(settings.targetRevenue) || 0) * months;
  const profitTarget = (Number(settings.targetProfit) || 0) * months;
  const revBar = goalBarHtml('الإيراد مقابل الهدف', t.revenue, revTarget);
  const netBar = goalBarHtml('صافي الربح مقابل الهدف', t.net, profitTarget);
  if (!revBar && !netBar) return '';   // لا أهداف مضبوطة
  const note = months > 1 ? ` <span class="goals-note">(هدف ${months} أشهر)</span>` : '';
  return `<h4 class="report-h">الأهداف الشهرية${note}</h4>
    <div class="goals-wrap">${revBar}${netBar}</div>`;
}

/* رسم بياني للاتجاه الشهري (آخر 6 أشهر ضمن الفترة): أعمدة مجمّعة لكل شهر
   تُظهر الإيراد والمصروفات والصافي. الارتفاع نسبةً لأكبر قيمة مطلقة (حارس ضد صفر). */
function trendChartHtml(from, to) {
  let rows = monthlyTrend(from, to);
  if (!rows.length) return '';
  // آخر 6 أشهر فقط للحفاظ على وضوح الرسم
  if (rows.length > 6) rows = rows.slice(rows.length - 6);
  // المقياس: أكبر قيمة مطلقة بين الإيراد/المصروفات/الصافي (حارس ضد القسمة على صفر)
  let maxAbs = 0;
  for (const r of rows) {
    maxAbs = Math.max(maxAbs, Math.abs(r.revenue), Math.abs(r.expenses), Math.abs(r.net));
  }
  if (maxAbs <= 0) maxAbs = 1;
  const cols = rows.map((r) => {
    const hR = Math.max(2, Math.round((Math.abs(r.revenue) / maxAbs) * 100));
    const hE = Math.max(2, Math.round((Math.abs(r.expenses) / maxAbs) * 100));
    const hN = Math.max(2, Math.round((Math.abs(r.net) / maxAbs) * 100));
    const netCls = r.net < 0 ? 'neg' : 'pos';
    return `<div class="tc-col" title="${esc(r.label)}">
      <div class="tc-bars">
        <span class="tc-bar tc-rev" style="height:${hR}%" title="الإيراد ${esc(fmtMoney(r.revenue))}"></span>
        <span class="tc-bar tc-exp" style="height:${hE}%" title="المصروفات ${esc(fmtMoney(r.expenses))}"></span>
        <span class="tc-bar tc-net ${netCls}" style="height:${hN}%" title="الصافي ${esc(fmtMoney(r.net))}"></span>
      </div>
      <span class="tc-net-val ${netCls}">${esc(fmtMoney(Math.round(r.net)))}</span>
      <span class="tc-label">${esc(r.label)}</span>
    </div>`;
  }).join('');
  return `<h4 class="report-h">الاتجاه الشهري (آخر ${rows.length} ${rows.length === 1 ? 'شهر' : 'أشهر'})</h4>
    <div class="trend-chart">
      <div class="tc-cols">${cols}</div>
      <div class="tc-legend">
        <span class="tcl"><i class="tcl-dot tc-rev"></i> الإيراد</span>
        <span class="tcl"><i class="tcl-dot tc-exp"></i> المصروفات</span>
        <span class="tcl"><i class="tcl-dot tc-net pos"></i> الصافي</span>
      </div>
    </div>`;
}

/* أعمدة أفقية للربح حسب الباقة: الصافي لكل باقة، الطول نسبةً لأكبر صافٍ مطلق.
   pkgArr: مصفوفة [اسم, {count, revenue, expenses, net}] مرتّبة تنازلياً بالصافي. */
function pkgProfitBarsHtml(pkgArr) {
  if (!pkgArr.length) return '';
  let maxAbs = 0;
  for (const [, v] of pkgArr) maxAbs = Math.max(maxAbs, Math.abs(v.net));
  if (maxAbs <= 0) maxAbs = 1;   // حارس ضد القسمة على صفر
  const bars = pkgArr.map(([name, v], i) => {
    const w = Math.max(2, Math.round((Math.abs(v.net) / maxAbs) * 100));
    const cls = v.net < 0 ? 'neg' : 'pos';
    const top = i === 0 && v.net > 0;
    return `<div class="ppb-row">
      <span class="ppb-name" title="${esc(name)}">${top ? '⭐ ' : ''}${esc(name)}</span>
      <span class="ppb-track"><span class="ppb-fill ${cls}" style="width:${w}%"></span></span>
      <span class="ppb-val ${cls}">${esc(fmtMoney(Math.round(v.net)))}</span>
    </div>`;
  }).join('');
  return `<div class="pkg-profit-bars">${bars}</div>`;
}

// فتح نافذة التقارير: اضبط «هذا الشهر» افتراضياً (إن لم تُضبط فترة) ثم ابنِ التقرير
function openReports() {
  if (!$('#report-from').value || !$('#report-to').value) {
    applyQuickRange('month');
    $$('.rq-btn').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-range') === 'month'));
  }
  renderReport();
  openModal('#reports-modal');
}

// سهم/نسبة التغيّر بين قيمة حالية وسابقة (للمقارنة)
function deltaHtml(cur, prev) {
  if (!(prev > 0)) {
    // لا أساس سابق للمقارنة (صفر أو سالب): أظهر «جديد» محايداً عند وجود قيمة حالية
    if (cur > 0) return `<span class="rep-delta neu">جديد</span>`;
    return `<span class="rep-delta neu">—</span>`;
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const arrow = up ? '↑' : '↓';
  const cls = up ? 'up' : 'down';
  return `<span class="rep-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

/* بناء اللوحة التحليلية للفترة [from..to] حسب العقد المالي.
   - بطاقات المؤشرات (KPIs)، المقارنة بالفترة السابقة المكافئة،
   - التوزيع حسب الحالة، والربح حسب الباقة. */
function renderReport() {
  const box = $('#report-content');
  const { from, to } = reportRange();

  // لا فترة محدّدة بعد
  if (!from || !to) {
    box.innerHTML = `<div class="report-empty">اختر فترة لعرض التقرير.</div>`;
    return;
  }

  const t = periodTotals(from, to);

  if (!t.count) {
    box.innerHTML = `<div class="report-empty">لا توجد حجوزات في هذه الفترة.</div>`;
    return;
  }

  // ----- المقارنة: الفترة السابقة المكافئة (نفس عدد الأيام قبلها مباشرة) -----
  const days = rangeDays(from, to);
  const prevTo = dateToStr(new Date(new Date(from + 'T00:00').getTime() - 86400000));
  const prevFrom = dateToStr(new Date(new Date(prevTo + 'T00:00').getTime() - (days - 1) * 86400000));
  const tp = periodTotals(prevFrom, prevTo);

  const netCls = t.net < 0 ? 'neg' : (t.margin < (Number(settings.lowMarginThreshold) || 0) ? 'low' : 'pos');

  // ----- لوحة المؤشرات (KPIs) -----
  const kpis = `
    <div class="kpi-grid">
      <div class="kpi kpi-rev">
        <span class="kpi-label">إجمالي الإيراد</span>
        <span class="kpi-value">${esc(fmtMoney(t.revenue))}</span>
        ${deltaHtml(t.revenue, tp.revenue)}
      </div>
      <div class="kpi kpi-net ${netCls}">
        <span class="kpi-label">صافي الربح</span>
        <span class="kpi-value">${esc(fmtMoney(t.net))}</span>
        ${deltaHtml(t.net, tp.net)}
      </div>
      <div class="kpi">
        <span class="kpi-label">هامش الربح</span>
        <span class="kpi-value">${t.margin.toFixed(1)}%</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">مصروفات الحجوزات</span>
        <span class="kpi-value">${esc(fmtMoney(t.bookingExp))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">مصروفات ثابتة (${t.months}ش)</span>
        <span class="kpi-value">${esc(fmtMoney(t.fixed))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">الضريبة</span>
        <span class="kpi-value">${esc(fmtMoney(t.vat))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">المُحصّل</span>
        <span class="kpi-value ok">${esc(fmtMoney(t.collected))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">المتبقّي</span>
        <span class="kpi-value ${t.remaining > 0 ? 'rem' : ''}">${esc(fmtMoney(t.remaining))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">متوسط قيمة الحجز</span>
        <span class="kpi-value">${esc(fmtMoney(t.avgBooking))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">متوسط الصافي/حجز</span>
        <span class="kpi-value">${esc(fmtMoney(t.avgNet))}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">عدد الحجوزات</span>
        <span class="kpi-value">${t.count}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">معدل الإلغاء</span>
        <span class="kpi-value ${t.cancelRate > 0 ? 'rem' : ''}">${t.cancelRate.toFixed(1)}%</span>
      </div>
    </div>`;

  // ----- التوزيع حسب الحالة (كل حجوزات الفترة) -----
  const byStatus = {};
  for (const b of t.all) {
    const k = b.status || 'confirmed';
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  const statusOrder = ['confirmed', 'pending', 'done', 'cancelled'];
  const maxStatus = Math.max(1, ...statusOrder.map((k) => byStatus[k] || 0));
  const statusBars = statusOrder
    .filter((k) => byStatus[k])
    .map((k) => {
      const v = byStatus[k];
      const pct = Math.round((v / maxStatus) * 100);
      return `<div class="rb-row">
        <span class="rb-label"><span class="badge ${k}">${STATUS_LABEL[k]}</span></span>
        <span class="rb-track"><span class="rb-fill st-${k}" style="width:${pct}%"></span></span>
        <span class="rb-val">${v}</span>
      </div>`;
    }).join('');

  // ----- الربح حسب الباقة (غير الملغاة): العدد، الإيراد، المصروفات، الصافي، الهامش% -----
  const byPkg = new Map();
  for (const b of t.active) {
    const name = (b.package || '').trim() || 'بدون باقة';
    const cur = byPkg.get(name) || { count: 0, revenue: 0, expenses: 0, net: 0 };
    cur.count += 1;
    cur.revenue += bookingRevenue(b);
    cur.expenses += bookingExpenses(b);
    cur.net += bookingNet(b);   // ملاحظة: صافي الباقة لا يشمل المصروفات الثابتة (توزَّع على مستوى الفترة)
    byPkg.set(name, cur);
  }
  const pkgArr = [...byPkg.entries()].sort((a, b) => b[1].net - a[1].net);
  const pkgRows = pkgArr.map(([name, v], i) => {
    const margin = v.revenue > 0 ? (v.net / v.revenue) * 100 : 0;
    const top = i === 0 && v.net > 0;   // تمييز الأعلى ربحية
    const netClsP = v.net < 0 ? 'neg' : 'pos';
    return `<tr class="${top ? 'is-top' : ''}">
      <td class="pp-name">${top ? '⭐ ' : ''}${esc(name)}</td>
      <td>${v.count}</td>
      <td>${esc(fmtMoney(v.revenue))}</td>
      <td>${esc(fmtMoney(v.expenses))}</td>
      <td class="pp-net ${netClsP}">${esc(fmtMoney(v.net))}</td>
      <td class="pp-margin">${margin.toFixed(1)}%</td>
    </tr>`;
  }).join('');
  const pkgTable = pkgArr.length ? `
    <div class="pkg-profit-wrap">
      <table class="pkg-profit-table">
        <thead>
          <tr>
            <th>الباقة</th><th>العدد</th><th>الإيراد</th>
            <th>المصروفات</th><th>الصافي</th><th>الهامش%</th>
          </tr>
        </thead>
        <tbody>${pkgRows}</tbody>
      </table>
    </div>` : '<div class="report-empty">لا توجد حجوزات فعّالة في الفترة.</div>';

  // ----- الأهداف الشهرية + الرسوم البيانية + أعمدة الربح حسب الباقة -----
  const goals = goalsHtml(t);
  const trend = trendChartHtml(from, to);
  const pkgBars = pkgProfitBarsHtml(pkgArr);

  box.innerHTML = `
    <div class="report-actions">
      <button type="button" id="btn-pl-print" class="btn btn-primary btn-sm">🧾 طباعة تقرير ربح وخسارة</button>
    </div>
    ${kpis}
    ${goals}
    ${trend}
    <h4 class="report-h">التوزيع حسب الحالة</h4>
    <div class="report-bars">${statusBars}</div>
    <h4 class="report-h">الربح حسب الباقة</h4>
    ${pkgBars}
    ${pkgTable}`;

  // زر تصدير/طباعة بيان الربح والخسارة للفترة الحالية
  const plBtn = $('#btn-pl-print');
  if (plBtn) plBtn.addEventListener('click', () => printProfitLoss(from, to, t));
}

/* ===================================================== */
/* ---------- تصدير/طباعة تقرير ربح وخسارة ---------- */
/* ===================================================== */

/* يبني بيان ربح وخسارة منظّماً للفترة [from..to] ويفتحه في نافذة طباعة مستقلة منسّقة (RTL).
   كل القيم عبر الدوال المحسوبة و fmtMoney. لا مكتبات خارجية.
   البنية: الإيراد، ناقص الضريبة، ناقص مصروفات الحجوزات، ناقص المصروفات الثابتة، = صافي الربح، مع الهامش%. */
function printProfitLoss(from, to, totals) {
  const t = totals || periodTotals(from, to);
  const biz = settings.biz || 'حجوزات عهود';
  const printedAt = new Date().toLocaleString('en-GB');
  // الإيراد الإجمالي (شامل الضريبة) = الإيراد الصافي + الضريبة (لعرض المسار كاملاً)
  const gross = t.revenue + t.vat;
  const netCls = t.net < 0 ? 'neg' : 'pos';

  // صف بيان (تسمية + قيمة + صنف اختياري)
  const row = (label, value, cls) =>
    `<tr class="${cls || ''}"><td class="pl-l">${esc(label)}</td><td class="pl-v">${esc(fmtMoney(value))}</td></tr>`;
  // صف فرعي بإشارة ناقص
  const minus = (label, value) =>
    `<tr class="pl-minus"><td class="pl-l">ناقص: ${esc(label)}</td><td class="pl-v">- ${esc(fmtMoney(value))}</td></tr>`;

  const vatLine = settings.vatEnabled
    ? `${row('إجمالي المبيعات (شامل الضريبة)', gross)}
       ${minus(`ضريبة القيمة المضافة (${esc(String(settings.vatRate))}%)`, t.vat)}`
    : '';

  const statementRows = `
    ${vatLine}
    ${row('صافي الإيراد', t.revenue, 'pl-strong')}
    ${minus('مصروفات الحجوزات', t.bookingExp)}
    ${minus(`المصروفات الثابتة (${t.months} ${t.months === 1 ? 'شهر' : 'أشهر'})`, t.fixed)}
    <tr class="pl-total ${netCls}"><td class="pl-l">= صافي الربح</td><td class="pl-v">${esc(fmtMoney(t.net))}</td></tr>
    <tr class="pl-margin"><td class="pl-l">هامش الربح</td><td class="pl-v">${t.margin.toFixed(1)}%</td></tr>`;

  // مؤشرات مساندة (المُحصّل/المتبقّي/العدد/الإلغاء)
  const extraRows = `
    ${row('المُحصّل من العملاء', t.collected)}
    ${row('المتبقّي على العملاء', t.remaining)}
    <tr><td class="pl-l">عدد الحجوزات</td><td class="pl-v">${t.count}</td></tr>
    <tr><td class="pl-l">منها ملغاة</td><td class="pl-v">${t.cancelled} (${t.cancelRate.toFixed(1)}%)</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
<title>تقرير ربح وخسارة — ${esc(biz)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, system-ui, sans-serif; color: #1f2333; margin: 0; padding: 28px; background: #fff; }
  .pl-head { text-align: center; border-bottom: 3px solid #7c3aed; padding-bottom: 14px; margin-bottom: 18px; }
  .pl-head h1 { margin: 0; font-size: 22px; color: #6d28d9; }
  .pl-head h2 { margin: 6px 0 0; font-size: 16px; font-weight: 600; color: #1f2333; }
  .pl-period { font-size: 13px; color: #6b7280; margin-top: 6px; }
  .pl-sec-title { font-size: 14px; font-weight: 700; color: #6d28d9; margin: 22px 0 8px; }
  table.pl-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.pl-table td { padding: 9px 12px; border-bottom: 1px solid #e9e7f3; }
  .pl-l { text-align: start; }
  .pl-v { text-align: end; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pl-minus .pl-l { color: #6b7280; padding-inline-start: 22px; }
  .pl-minus .pl-v { color: #b91c1c; font-weight: 600; }
  .pl-strong td { font-weight: 700; background: #f5f4fb; }
  .pl-total td { font-size: 17px; font-weight: 800; border-top: 2px solid #7c3aed; border-bottom: 2px solid #7c3aed; }
  .pl-total.pos td { color: #15803d; background: #dcfce7; }
  .pl-total.neg td { color: #b91c1c; background: #fef2f2; }
  .pl-margin td { color: #6b7280; font-weight: 600; }
  .pl-foot { margin-top: 26px; font-size: 11px; color: #9ca3af; text-align: center; border-top: 1px solid #e9e7f3; padding-top: 10px; }
  @media print { body { padding: 0; } .pl-noprint { display: none; } }
</style></head>
<body>
  <div class="pl-head">
    <h1>${esc(biz)}</h1>
    <h2>تقرير الربح والخسارة</h2>
    <div class="pl-period">الفترة: ${esc(from)} إلى ${esc(to)} • ${t.months} ${t.months === 1 ? 'شهر' : 'أشهر'}</div>
  </div>

  <div class="pl-sec-title">بيان الربح والخسارة</div>
  <table class="pl-table"><tbody>${statementRows}</tbody></table>

  <div class="pl-sec-title">مؤشرات مساندة</div>
  <table class="pl-table"><tbody>${extraRows}</tbody></table>

  <div class="pl-foot">طُبع في ${esc(printedAt)} — ${esc(biz)}</div>

  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 250);
    });
  <\/script>
</body></html>`;

  // افتح نافذة مستقلة واكتب فيها البيان (آمن إن مُنعت النوافذ المنبثقة)
  const w = window.open('', '_blank');
  if (!w) { toast('فعّل النوافذ المنبثقة لطباعة التقرير', 'err'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ---------- الإعدادات والنسخ الاحتياطي ---------- */
async function saveBizSettings() {
  settings.biz = $('#set-biz').value.trim() || 'حجوزات عهود';
  settings.cc = $('#set-cc').value.replace(/\D/g, '') || '966';
  await DB.put('settings', { key: 'biz', value: settings.biz });
  await DB.put('settings', { key: 'cc', value: settings.cc });
  applySettings();
  toast('تم حفظ الإعدادات ✓', 'ok');
}

// حفظ إعدادات ساعات العمل (الأيام، البداية/النهاية، المدة الافتراضية، العملة، منع التعارض)
async function saveWorkSettings() {
  const days = [];
  $$('.work-day').forEach((cb) => { if (cb.checked) days.push(Number(cb.value)); });
  settings.workDays = days;
  settings.workStart = $('#set-work-start').value || '10:00';
  settings.workEnd = $('#set-work-end').value || '22:00';
  // المدة الافتراضية تُدخَل بالساعات وتُخزَّن بالدقائق
  const defHoursRaw = Number($('#set-duration').value);
  settings.defaultDuration = defHoursRaw > 0 ? Math.max(1, Math.round(defHoursRaw * 60)) : 60;
  settings.currency = $('#set-currency').value.trim() || 'ر.س';
  settings.blockConflicts = !!$('#set-block').checked;

  await DB.put('settings', { key: 'workDays', value: settings.workDays });
  await DB.put('settings', { key: 'workStart', value: settings.workStart });
  await DB.put('settings', { key: 'workEnd', value: settings.workEnd });
  await DB.put('settings', { key: 'defaultDuration', value: settings.defaultDuration });
  await DB.put('settings', { key: 'currency', value: settings.currency });
  await DB.put('settings', { key: 'blockConflicts', value: settings.blockConflicts });

  // حدّث القيمة الافتراضية للمدة في النموذج إن لم يكن قيد تعديل (تُعرض بالساعات)
  if (!editingId) {
    const fd = $('#f-duration');
    if (fd && !fd.value) fd.value = settings.defaultDuration / 60;
  }
  refreshAll();
  refreshDayWarning();
  toast('تم حفظ ساعات العمل ✓', 'ok');
}

/* ---------- الإعدادات المالية ---------- */

// حفظ إعدادات الضريبة (تفعيل + نسبة)
async function saveVatSettings() {
  settings.vatEnabled = !!$('#set-vat-enabled').checked;
  const r = Number($('#set-vat-rate').value);
  settings.vatRate = Number.isFinite(r) && r >= 0 ? r : 15;
  await DB.put('settings', { key: 'vatEnabled', value: settings.vatEnabled });
  await DB.put('settings', { key: 'vatRate', value: settings.vatRate });
  // أعِد عرض القيمة المُطهَّرة وحدّث الواجهات المعتمدة على الضريبة
  const vr = $('#set-vat-rate'); if (vr) vr.value = settings.vatRate;
  updateRemainingLine();
  refreshAll();
  toast('تم حفظ إعدادات الضريبة ✓', 'ok');
}

// حفظ الأهداف الشهرية (الإيراد والربح)
async function saveTargetSettings() {
  settings.targetRevenue = Math.max(0, Number($('#set-target-revenue').value) || 0);
  settings.targetProfit = Math.max(0, Number($('#set-target-profit').value) || 0);
  await DB.put('settings', { key: 'targetRevenue', value: settings.targetRevenue });
  await DB.put('settings', { key: 'targetProfit', value: settings.targetProfit });
  toast('تم حفظ الأهداف الشهرية ✓', 'ok');
}

// حفظ حد هامش الربح المنخفض
async function saveLowMarginSetting() {
  const t = Number($('#set-low-margin').value);
  settings.lowMarginThreshold = Number.isFinite(t) && t >= 0 ? t : 20;
  await DB.put('settings', { key: 'lowMarginThreshold', value: settings.lowMarginThreshold });
  const lm = $('#set-low-margin'); if (lm) lm.value = settings.lowMarginThreshold;
  updateRemainingLine();
  refreshAll();
  toast('تم حفظ حد الهامش المنخفض ✓', 'ok');
}

// حفظ مصفوفة المصروفات الثابتة في قاعدة البيانات
async function persistFixedExpenses() {
  await DB.put('settings', { key: 'fixedExpenses', value: settings.fixedExpenses });
}

// مجموع المصروفات الثابتة الشهرية
function fixedExpensesTotal() {
  return (settings.fixedExpenses || []).reduce((s, x) => s + (Math.max(0, Number(x.amount) || 0)), 0);
}

// عرض قائمة المصروفات الثابتة ومجموعها الشهري في الإعدادات
function renderFixedExpenses() {
  const list = $('#fixed-exp-list');
  if (!list) return;
  const items = settings.fixedExpenses || [];
  list.innerHTML = items.length
    ? items.map((x) => `
      <div class="fx-item">
        <span class="fx-n">${esc(x.name) || '—'}</span>
        <span class="fx-a">${esc(fmtMoney(x.amount))}</span>
        <button class="icon-btn" onclick="removeFixedExpense('${esc(x.id)}')">🗑</button>
      </div>`).join('')
    : '<p class="hint">لا توجد مصروفات ثابتة بعد.</p>';
  const tot = $('#fixed-exp-total');
  if (tot) tot.innerHTML = `المجموع الشهري: <b>${esc(fmtMoney(fixedExpensesTotal()))}</b>`;
}

// إضافة عنصر مصروف ثابت (اسم + مبلغ)
async function addFixedExpense() {
  const name = $('#fx-name').value.trim();
  const amount = Math.max(0, Number($('#fx-amount').value) || 0);
  if (!name) { toast('اكتب اسم المصروف', 'err'); return; }
  if (amount <= 0) { toast('أدخل مبلغاً صحيحاً', 'err'); return; }
  settings.fixedExpenses = (settings.fixedExpenses || []).concat({ id: uid(), name, amount });
  await persistFixedExpenses();
  $('#fx-name').value = '';
  $('#fx-amount').value = '';
  renderFixedExpenses();
  toast('تمت إضافة المصروف ✓', 'ok');
}

// حذف عنصر مصروف ثابت بالمعرّف
async function removeFixedExpense(id) {
  settings.fixedExpenses = (settings.fixedExpenses || []).filter((x) => x.id !== id);
  await persistFixedExpenses();
  renderFixedExpenses();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  const data = { version: 1, exportedAt: new Date().toISOString(), bookings, packages, settings };
  download(`نسخة-احتياطية-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('تم تصدير النسخة الاحتياطية ✓', 'ok');
}

function exportCSV() {
  const headers = ['الاسم', 'الجوال', 'التاريخ', 'اليوم', 'الوقت', 'الباقة', 'السعر', 'الخصم', 'الضريبة', 'المصروفات', 'الصافي', 'الهامش%', 'المدفوع', 'المتبقّي', 'المدة (ساعات)', 'حالة الدفع', 'الحالة', 'ملاحظات'];
  const lines = bookings
    .slice()
    .sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')))
    .map((b) => [b.name, b.phone, b.date, weekdayName(b.date), b.time, b.package, bookingPrice(b), bookingDiscount(b), Math.round(bookingVat(b)), bookingExpenses(b), Math.round(bookingNet(b)), bookingMargin(b).toFixed(1), bookingPaid(b), bookingRemaining(b), bookingDuration(b) / 60, PAY_LABEL[paymentStatus(b)] || '', STATUS_LABEL[b.status] || '', b.notes]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  // BOM لضمان ظهور العربية في Excel
  const csv = '﻿' + headers.join(',') + '\n' + lines.join('\n');
  download(`الحجوزات-${todayStr()}.csv`, csv, 'text/csv;charset=utf-8');
  toast('تم تصدير ملف Excel ✓', 'ok');
}

async function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.bookings) throw new Error('ملف غير صالح');
    if (!confirm('سيتم دمج بيانات النسخة الاحتياطية مع بياناتك الحالية. متابعة؟')) return;
    for (const b of data.bookings) { b.id = b.id || uid(); await DB.put('bookings', b); }
    if (Array.isArray(data.packages)) for (const p of data.packages) await DB.put('packages', p);
    await loadBookings();
    await loadPackages();
    refreshAll();
    toast('تم استيراد البيانات ✓', 'ok');
  } catch (err) {
    toast('تعذّر قراءة الملف', 'err');
  } finally {
    e.target.value = '';
  }
}

async function wipeAll() {
  if (!confirm('⚠️ سيتم حذف جميع الحجوزات نهائياً.\nننصح بأخذ نسخة احتياطية أولاً.\n\nهل أنت متأكد؟')) return;
  if (!confirm('تأكيد أخير: حذف كل البيانات؟')) return;
  await DB.clear('bookings');
  await loadBookings();
  refreshAll();
  closeModals();
  toast('تم حذف كل الحجوزات', 'ok');
}

/* ---------- النوافذ ---------- */
function openModal(sel) { $(sel).hidden = false; }
function closeModals() { $$('.modal').forEach((m) => (m.hidden = true)); }

/* ---------- تثبيت PWA ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('#btn-install').hidden = true;
  toast('تم تثبيت التطبيق ✓', 'ok');
});
async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  } else {
    openModal('#ios-modal');
  }
}

// هل التطبيق يعمل مثبّتاً (وضع standalone)؟
function isStandalonePWA() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
// كشف أجهزة آيفون/آيباد (iOS لا يدعم beforeinstallprompt)
function isIosDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
}
// على آيفون: أظهر زر التثبيت يدويًا ليفتح إرشادات «إضافة إلى الشاشة الرئيسية»
if (isIosDevice() && !isStandalonePWA()) {
  const installBtn = $('#btn-install');
  if (installBtn) installBtn.hidden = false;
}

/* كشف الدوال المستخدمة في onclick داخل الجدول */
window.editBooking = editBooking;
window.deleteBooking = deleteBooking;
window.sendWhatsApp = sendWhatsApp;
window.removePackage = removePackage;
window.notifyBooking = notifyBooking;
window.removeFixedExpense = removeFixedExpense;

/* انطلاق */
init().catch((err) => {
  console.error(err);
  toast('حدث خطأ في تحميل قاعدة البيانات', 'err');
});
