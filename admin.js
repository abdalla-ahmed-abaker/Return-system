// ============================================================
// لوحة المشرف: دخول + إدارة الطلبات + Excel (تصدير/استيراد/ربط ملف)
// ============================================================

const $ = (id) => document.getElementById(id);

const state = { rows: [], page: 1, limit: 15, status: '', q: '', current: null, handle: null };

// ---------------- كلمة المرور (تخزين محلي بتجزئة SHA-256) ----------------
async function sha256(text) {
  if (!(window.crypto && crypto.subtle)) return btoa(unescape(encodeURIComponent(text)));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomSalt() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function savePassword(pw) {
  const salt = randomSalt();
  await DB.setMeta('admin_auth', { salt, hash: await sha256(salt + pw) });
}

let setupMode = false;

async function initAuth() {
  const auth = await DB.getMeta('admin_auth');
  setupMode = !auth;
  $('confirmWrap').style.display = setupMode ? 'block' : 'none';
  $('loginTitle').textContent = setupMode ? 'إنشاء كلمة مرور المشرف' : 'تسجيل دخول المشرف';
  $('loginSubtitle').textContent = setupMode
    ? 'هذه أول مرة. اختر كلمة مرور (6 أحرف على الأقل) لحماية لوحة التحكم.'
    : 'أدخل كلمة المرور للمتابعة.';
  $('loginBtn').textContent = setupMode ? 'حفظ ودخول' : 'دخول';

  if (sessionStorage.getItem('admin_ok') === '1' && !setupMode) showDashboard();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.classList.remove('show');
  const pw = $('password').value;

  try {
    if (setupMode) {
      if (pw.length < 6) throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف.');
      if (pw !== $('password2').value) throw new Error('كلمتا المرور غير متطابقتين.');
      await savePassword(pw);
    } else {
      const auth = await DB.getMeta('admin_auth');
      if ((await sha256(auth.salt + pw)) !== auth.hash) throw new Error('كلمة المرور غير صحيحة.');
    }
    sessionStorage.setItem('admin_ok', '1');
    $('password').value = ''; $('password2').value = '';
    showDashboard();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
  }
});

$('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('admin_ok');
  location.reload();
});

$('changePwBtn').addEventListener('click', async () => {
  const pw = prompt('أدخل كلمة المرور الجديدة (6 أحرف على الأقل):');
  if (pw === null) return;
  if (pw.length < 6) return alert('كلمة المرور قصيرة جداً.');
  await savePassword(pw);
  alert('تم تغيير كلمة المرور.');
});

// ---------------- عرض اللوحة ----------------
async function showDashboard() {
  $('loginView').style.display = 'none';
  $('dashboardView').style.display = 'block';
  $('topActions').style.display = 'flex';

  state.handle = (await DB.getMeta('file_handle')) || null;
  if (!window.showSaveFilePicker) $('linkBtn').style.display = 'none';
  await refresh();
  try { if (state.handle && await writeLinked(false)) updateFileStatus('تمت المزامنة تلقائياً'); else updateFileStatus(); }
  catch (e) { updateFileStatus(); }
}

async function refresh() {
  const rows = await DB.all();
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  state.rows = rows;
  renderStats();
  renderTable();
}

function renderStats() {
  const r = state.rows;
  const count = (s) => r.filter(x => x.status === s).length;
  const cards = [
    ['إجمالي الطلبات', r.length],
    ['غير مكتملة (الخطوة 1 فقط)', r.filter(x => !x.step_completed).length],
    ['قيد الانتظار', count('pending')],
    ['قيد المراجعة', count('under_review')],
    ['تمت الموافقة', count('approved')],
    ['تم الجدولة', count('scheduled')],
    ['مكتمل', count('completed')]
  ];
  $('statGrid').innerHTML = cards.map(([l, n]) =>
    `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
}

function filtered() {
  const q = state.q.toLowerCase();
  return state.rows.filter(r =>
    (!state.status || r.status === state.status) &&
    (!q || [r.full_name, r.phone, r.email].some(v => (v || '').toLowerCase().includes(q))));
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function renderTable() {
  const list = filtered();
  const pages = Math.max(Math.ceil(list.length / state.limit), 1);
  if (state.page > pages) state.page = pages;
  const slice = list.slice((state.page - 1) * state.limit, state.page * state.limit);

  $('emptyState').style.display = list.length ? 'none' : 'block';
  $('tableBody').innerHTML = slice.map(r => `
    <tr data-id="${r.id}">
      <td>${r.id}</td>
      <td>${escapeHtml(r.full_name)}</td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${LABELS.gender[r.gender] || '—'}</td>
      <td>${LABELS.yesno[r.is_voluntary] || '—'}</td>
      <td>${r.step_completed ? '✔' : '✖'}</td>
      <td><span class="badge ${r.status}">${LABELS.status[r.status] || ''}</span></td>
      <td>${r.travel_date ? fmtDate(r.travel_date) : '—'}</td>
      <td>${fmtDate(r.created_at)}</td>
    </tr>`).join('');

  $('tableBody').querySelectorAll('tr').forEach(tr =>
    tr.addEventListener('click', () => openModal(tr.dataset.id)));

  $('pagination').innerHTML = pages > 1
    ? Array.from({ length: pages }, (_, i) =>
        `<button class="${i + 1 === state.page ? 'active' : ''}" data-p="${i + 1}">${i + 1}</button>`).join('')
    : '';
  $('pagination').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => { state.page = Number(b.dataset.p); renderTable(); }));
}

let debounce;
$('searchInput').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.q = $('searchInput').value.trim(); state.page = 1; renderTable(); }, 250);
});
$('statusFilter').addEventListener('change', () => {
  state.status = $('statusFilter').value; state.page = 1; renderTable();
});

// ---------------- نافذة التفاصيل ----------------
async function openModal(id) {
  const r = await DB.get(id);
  if (!r) return;
  state.current = r.id;

  const isPdf = (r.passport_data || '').startsWith('data:application/pdf');
  $('modalBody').innerHTML = `
    <div class="detail-row"><span class="k">الاسم الكامل</span><span class="v">${escapeHtml(r.full_name)}</span></div>
    <div class="detail-row"><span class="k">الهاتف</span><span class="v">${escapeHtml(r.phone)}</span></div>
    <div class="detail-row"><span class="k">البريد الإلكتروني</span><span class="v">${escapeHtml(r.email || '—')}</span></div>
    <div class="detail-row"><span class="k">الجنس</span><span class="v">${LABELS.gender[r.gender] || '—'}</span></div>
    <div class="detail-row"><span class="k">الرجوع باختياره؟</span><span class="v">${LABELS.yesno[r.is_voluntary] || '—'}</span></div>
    <div class="detail-row"><span class="k">أسباب الرجوع</span><span class="v">${escapeHtml(r.return_reason || '—')}</span></div>
    <div class="detail-row"><span class="k">تاريخ التقديم</span><span class="v">${fmtDate(r.created_at)}</span></div>
    ${r.passport_data ? `
      <div class="passport-preview">
        <p class="field-hint">صورة جواز السفر:</p>
        ${isPdf ? '' : `<img src="${r.passport_data}" alt="صورة الجواز"><br>`}
        <a href="${r.passport_data}" download="${escapeHtml(r.passport_name || 'passport')}">⬇ تنزيل الملف</a>
      </div>` : ''}`;

  $('modalStatus').value = r.status || 'pending';
  $('modalTravelDate').value = r.travel_date || '';
  $('modalNotes').value = r.admin_notes || '';
  $('modalOverlay').classList.add('show');
}

const closeModal = () => $('modalOverlay').classList.remove('show');
$('closeModalBtn').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

$('saveModalBtn').addEventListener('click', async () => {
  const r = await DB.get(state.current);
  if (!r) return closeModal();
  r.status = $('modalStatus').value;
  r.travel_date = $('modalTravelDate').value;
  r.admin_notes = $('modalNotes').value;
  r.updated_at = new Date().toISOString();
  await DB.put(r);
  closeModal();
  await refresh();
  await autoSave();
});

$('deleteBtn').addEventListener('click', async () => {
  if (!confirm('هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  await DB.remove(state.current);
  closeModal();
  await refresh();
  await autoSave();
});

// ---------------- Excel: تصدير / استيراد / ربط ملف ----------------
$('exportBtn').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') return alert('تعذر تحميل مكتبة Excel. تأكد من الاتصال بالإنترنت.');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  Excel.download(state.rows, `return-requests-${stamp}.xlsx`);
});

$('importBtn').addEventListener('click', () => $('importInput').click());
$('importInput').addEventListener('change', async () => {
  const file = $('importInput').files[0];
  $('importInput').value = '';
  if (!file) return;
  if (typeof XLSX === 'undefined') return alert('تعذر تحميل مكتبة Excel. تأكد من الاتصال بالإنترنت.');

  try {
    const imported = await Excel.parseFile(file);
    if (!imported.length) return alert('لا توجد بيانات صالحة في الملف.');
    let added = 0, updated = 0;

    for (const row of imported) {
      const existing = row.id ? await DB.get(row.id) : null;
      if (existing) {
        // تحديث الحقول النصية والحالة فقط (صورة الجواز تبقى كما هي)
        const { id, passport_name, created_at, ...fields } = row;
        await DB.put({ ...existing, ...fields });
        updated++;
      } else {
        const rec = {
          full_name: '', phone: '', email: '', gender: '', return_reason: '', is_voluntary: '',
          status: 'pending', travel_date: '', admin_notes: '', passport_name: '', passport_data: '',
          step_completed: 0, created_at: new Date().toISOString(), ...row
        };
        if (!rec.id) delete rec.id;
        await DB.put(rec);
        added++;
      }
    }
    await refresh();
    await autoSave();
    alert(`تم الاستيراد: ${added} طلب جديد، ${updated} طلب محدَّث.`);
  } catch (err) {
    console.error(err);
    alert('تعذر قراءة الملف. تأكد أنه ملف Excel بنفس أعمدة ملف التصدير.');
  }
});

$('linkBtn').addEventListener('click', async () => {
  if (typeof XLSX === 'undefined') return alert('تعذر تحميل مكتبة Excel. تأكد من الاتصال بالإنترنت.');
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'return-requests.xlsx',
      types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
    });
    await DB.setMeta('file_handle', handle);
    state.handle = handle;
    await autoSave(true);
  } catch (err) {
    if (err.name !== 'AbortError') alert('تعذر ربط الملف: ' + err.message);
  }
});

// يكتب كل الطلبات في الملف المرتبط (Chrome / Edge فقط)
async function writeLinked(interactive) {
  const h = state.handle;
  if (!h) return false;
  let perm = await h.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    if (!interactive) return false;
    perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
  }
  const w = await h.createWritable();
  await w.write(Excel.toArrayBuffer(await DB.all()));
  await w.close();
  return true;
}

async function autoSave(showMsg) {
  if (!state.handle) return;
  try {
    const ok = await writeLinked(true);
    updateFileStatus(ok ? `تم الحفظ في الملف ${new Date().toLocaleTimeString('ar-EG')}` : 'لم يُمنح إذن الكتابة في الملف');
  } catch (err) {
    console.error(err);
    updateFileStatus('تعذر الكتابة في الملف المرتبط');
  }
}

$('saveNowBtn').addEventListener('click', () => autoSave(true));

function updateFileStatus(extra) {
  const el = $('fileStatus');
  $('saveNowBtn').style.display = state.handle ? 'inline-flex' : 'none';
  if (state.handle) {
    el.innerHTML = `📎 الملف المرتبط: <b>${escapeHtml(state.handle.name)}</b> — يتحدّث تلقائياً بعد كل تعديل. ${extra ? '— ' + escapeHtml(extra) : ''}`;
  } else if (window.showSaveFilePicker) {
    el.innerHTML = 'لا يوجد ملف Excel مرتبط. اضغط «ربط ملف Excel» ليُحفَظ كل تعديل تلقائياً في ملف على جهازك، أو استخدم «تصدير Excel» لتنزيل نسخة.';
  } else {
    el.innerHTML = 'متصفحك لا يدعم الربط التلقائي بملف. استخدم «تصدير Excel» بانتظام لأخذ نسخة احتياطية (يُنصح باستخدام Chrome أو Edge).';
  }
}

// ---------------- البدء ----------------
initAuth();
