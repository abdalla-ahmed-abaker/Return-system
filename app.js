// ============================================================
// الخطوة الأولى: حفظ البيانات الأساسية + صورة الجواز في المتصفح
// ============================================================

const form = document.getElementById('step1Form');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');
const fileInput = document.getElementById('passport_image');
const fileDrop = document.getElementById('fileDrop');
const fileDropText = document.getElementById('fileDropText');

const MAX_MB = 5;
const ALLOWED = ['jpg', 'jpeg', 'png', 'pdf'];

document.querySelectorAll('.radio-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('checked'));
    card.classList.add('checked');
  });
});

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileDropText.textContent = f ? `✔ ${f.name}` : 'اضغط هنا لاختيار صورة الجواز أو ملف PDF';
  fileDrop.classList.toggle('has-file', !!f);
});

function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
function clearError() { errorBox.classList.remove('show'); errorBox.textContent = ''; }

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('تعذر قراءة الملف'));
    r.readAsDataURL(file);
  });
}

// تصغير صور الجواز لتوفير مساحة التخزين (أقصى بعد 1400px)
async function prepareFile(file) {
  const dataUrl = await readAsDataURL(file);
  if (file.type === 'application/pdf') return dataUrl;

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const fullName = document.getElementById('full_name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const email = document.getElementById('email').value.trim();
  const gender = document.querySelector('input[name="gender"]:checked');
  const file = fileInput.files[0];

  if (!fullName || !phone || !gender || !file) {
    return showError('الرجاء تعبئة جميع الحقول المطلوبة (*) بما في ذلك صورة الجواز.');
  }
  if (!/^[+\d][\d\s\-]{6,18}$/.test(phone)) {
    return showError('رقم التلفون غير صحيح. استخدم أرقاماً فقط (يمكن أن يبدأ بـ +).');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return showError('صيغة البريد الإلكتروني غير صحيحة.');
  }
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ALLOWED.includes(ext)) {
    return showError('صيغة الملف غير مدعومة. الرجاء رفع JPG أو PNG أو PDF.');
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return showError(`حجم الملف أكبر من ${MAX_MB} ميغابايت.`);
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جارٍ الحفظ...';

  try {
    const passportData = await prepareFile(file);
    const id = await DB.add({
      full_name: fullName,
      phone,
      email,
      gender: gender.value,
      passport_name: file.name,
      passport_data: passportData,
      return_reason: '',
      is_voluntary: '',
      status: 'pending',
      travel_date: '',
      admin_notes: '',
      step_completed: 0,
      created_at: new Date().toISOString()
    });

    sessionStorage.setItem('submission_id', String(id));
    window.location.href = 'step2.html';
  } catch (err) {
    console.error(err);
    showError('تعذر حفظ البيانات في المتصفح. تأكد أن التخزين غير معطّل ولا تستخدم وضع التصفح الخفي.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'التالي ←';
  }
});
