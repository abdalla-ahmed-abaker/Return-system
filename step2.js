// ============================================================
// الخطوة الثانية: أسباب الرجوع + هل الرجوع باختياره
// ============================================================

const submissionId = sessionStorage.getItem('submission_id');
if (!submissionId) window.location.href = 'index.html';

const form = document.getElementById('step2Form');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');
const formCard = document.getElementById('formCard');
const successCard = document.getElementById('successCard');

document.querySelectorAll('.choice-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.choice-card').forEach(c => c.classList.remove('checked'));
    card.classList.add('checked');
  });
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = 'index.html';
});

function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');

  const reason = document.getElementById('return_reason').value.trim();
  const voluntary = document.querySelector('input[name="is_voluntary"]:checked');

  if (!reason || !voluntary) {
    return showError('الرجاء كتابة أسباب الرجوع واختيار (نعم) أو (لا).');
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جارٍ الإرسال...';

  try {
    const record = await DB.get(submissionId);
    if (!record) {
      sessionStorage.removeItem('submission_id');
      return window.location.href = 'index.html';
    }

    record.return_reason = reason;
    record.is_voluntary = voluntary.value;
    record.step_completed = 1;
    record.updated_at = new Date().toISOString();
    await DB.put(record);

    sessionStorage.removeItem('submission_id');
    formCard.style.display = 'none';
    successCard.style.display = 'block';
  } catch (err) {
    console.error(err);
    showError('تعذر حفظ البيانات. الرجاء المحاولة مرة أخرى.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال';
  }
});
