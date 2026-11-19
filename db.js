// ============================================================
// طبقة التخزين: IndexedDB داخل المتصفح + تصدير/استيراد Excel
// ============================================================

const DB = (() => {
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('sudan_return_db', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('submissions', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function run(storeName, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(storeName, mode);
      const request = fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(request ? request.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    add: (obj) => run('submissions', 'readwrite', s => s.add(obj)),      // يعيد المعرّف الجديد
    put: (obj) => run('submissions', 'readwrite', s => s.put(obj)),
    get: (id) => run('submissions', 'readonly', s => s.get(Number(id))),
    all: () => run('submissions', 'readonly', s => s.getAll()),
    remove: (id) => run('submissions', 'readwrite', s => s.delete(Number(id))),
    getMeta: (k) => run('meta', 'readonly', s => s.get(k)),
    setMeta: (k, v) => run('meta', 'readwrite', s => s.put(v, k))
  };
})();

// ------------------------------------------------------------
// ثوابت وتسميات مشتركة
// ------------------------------------------------------------
const LABELS = {
  status: {
    pending: 'قيد الانتظار', under_review: 'قيد المراجعة', approved: 'تمت الموافقة',
    scheduled: 'تم الجدولة', completed: 'مكتمل', rejected: 'مرفوض'
  },
  gender: { male: 'ذكر', female: 'أنثى' },
  yesno: { yes: 'نعم', no: 'لا' },
  done: { 1: 'نعم', 0: 'لا' }
};

function invert(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
}

// ------------------------------------------------------------
// Excel (يتطلب مكتبة SheetJS: متغير XLSX)
// ------------------------------------------------------------
const Excel = (() => {
  // [المفتاح الداخلي, عنوان العمود في Excel]
  const COLS = [
    ['id', 'الرقم'],
    ['full_name', 'الاسم الكامل'],
    ['phone', 'رقم التلفون'],
    ['email', 'البريد الإلكتروني'],
    ['gender', 'الجنس'],
    ['return_reason', 'أسباب الرجوع'],
    ['is_voluntary', 'الرجوع باختياره؟'],
    ['status', 'الحالة'],
    ['travel_date', 'تاريخ السفر'],
    ['admin_notes', 'ملاحظات المشرف'],
    ['passport_name', 'ملف الجواز'],
    ['step_completed', 'اكتمل الطلب؟'],
    ['created_at', 'تاريخ التقديم']
  ];

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toCell(key, r) {
    switch (key) {
      case 'gender': return LABELS.gender[r.gender] || '';
      case 'is_voluntary': return LABELS.yesno[r.is_voluntary] || '';
      case 'status': return LABELS.status[r.status] || '';
      case 'step_completed': return r.step_completed ? 'نعم' : 'لا';
      case 'created_at': return fmtDateTime(r.created_at);
      default: return r[key] ?? '';
    }
  }

  function buildWorkbook(rows) {
    const headers = COLS.map(c => c[1]);
    const data = rows.map(r => Object.fromEntries(COLS.map(([k, h]) => [h, toCell(k, r)])));
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    ws['!cols'] = [6, 26, 16, 26, 8, 40, 14, 14, 14, 30, 22, 12, 18].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الطلبات');
    wb.Workbook = { Views: [{ RTL: true }] };
    return wb;
  }

  function toArrayBuffer(rows) {
    return XLSX.write(buildWorkbook(rows), { bookType: 'xlsx', type: 'array' });
  }

  function download(rows, filename) {
    XLSX.writeFile(buildWorkbook(rows), filename || 'return-requests.xlsx');
  }

  // يقرأ ملف Excel ويعيد قائمة كائنات بالمفاتيح الداخلية
  async function parseFile(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headerToKey = Object.fromEntries(COLS.map(([k, h]) => [h, k]));
    const rev = { gender: invert(LABELS.gender), is_voluntary: invert(LABELS.yesno), status: invert(LABELS.status) };

    return json.map(row => {
      const o = {};
      for (const [h, v] of Object.entries(row)) {
        const key = headerToKey[h.trim()];
        if (!key) continue;
        let val = typeof v === 'string' ? v.trim() : v;
        if (rev[key]) val = rev[key][val] ?? '';
        if (key === 'step_completed') val = (val === 'نعم' || val === 1 || val === '1') ? 1 : 0;
        if (key === 'id') val = Number(val) || null;
        if (key === 'created_at' && val) { const d = new Date(val); val = isNaN(d) ? new Date().toISOString() : d.toISOString(); }
        if (key === 'travel_date' && val instanceof Date) val = val.toISOString().slice(0, 10);
        o[key] = val;
      }
      return o;
    }).filter(o => o.full_name || o.phone);
  }

  return { toArrayBuffer, download, parseFile };
})();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
