/**
 * Pure helpers — NO Google APIs here, so test/lib.test.js can load this file in Node.
 */

var TABLES = {
  Patients: ['patient_id', 'full_name', 'name_search', 'dob', 'birth_year', 'gender', 'phone', 'address',
    'allergies', 'systemic_diseases', 'current_meds', 'notes', 'folder_id', 'import_stt', 'import_folder_name',
    'created_at', 'updated_at', 'deleted'],
  Visits: ['visit_id', 'patient_id', 'visit_date', 'reason', 'diagnosis', 'teeth', 'treatment', 'plan',
    'prescription', 'cost', 'paid', 'next_appointment', 'notes', 'folder_id', 'source',
    'created_at', 'updated_at', 'deleted'],
  Images: ['image_id', 'visit_id', 'patient_id', 'file_name', 'mime', 'size_bytes', 'label', 'created_at', 'deleted'],
  Counters: ['year', 'last_seq'],
  ImportLog: ['run_id', 'at', 'sheet', 'row', 'status', 'message']
};
var DATE_COLS = { Patients: ['dob'], Visits: ['visit_date', 'next_appointment'] };
var NUMBER_COLS = {
  Patients: ['birth_year', 'import_stt'], Visits: ['cost', 'paid'], Images: ['size_bytes'],
  Counters: ['year', 'last_seq'], ImportLog: ['row']
};
var IMAGE_LABELS = ['truoc', 'sau', 'xquang', 'khac'];
var GENDERS = ['Nam', 'Nữ'];
var MAX_TEXT = 4000;
var IMPORT_VISIT_REASON = 'Dữ liệu cũ';

function stripAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** Lowercase, accent-free, single-spaced — used for "nguyen van a" ≈ "Nguyễn Văn A". */
function normalizeText(s) {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function folderSafeName(s) {
  return stripAccents(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function formatPatientId(year, seq) {
  return 'NK' + String(year).slice(-2) + '-' + String(seq).padStart(4, '0');
}

/** Returns canonical id ("NK26-0001") if q looks like a patient code, else null. */
function parsePatientIdQuery(q) {
  var m = String(q || '').replace(/\s/g, '').match(/^nk(\d{2})-?(\d{1,6})$/i);
  return m ? 'NK' + m[1] + '-' + m[2].padStart(4, '0') : null;
}

function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

/** Accepts 'yyyy-mm-dd' or 'dd/mm/yyyy' (text typed into Excel). Returns 'yyyy-mm-dd', '' if empty, null if invalid. */
function parseDateLoose(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) s = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return isValidDateStr(s) ? s : null;
}

/** Prevent formula injection: Sheets treats strings starting with = + - @ as formulas. */
function sanitizeCell(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function isTrue(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/** Excel often turns 0903123456 into the number 903123456 — restore the leading 0 for VN mobile numbers. */
function normalizePhone(v) {
  if (v == null || v === '') return '';
  var s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
  if (/^\d{9}$/.test(s) && /^[35789]/.test(s)) s = '0' + s;
  return s;
}

/** '' → '', valid → number, invalid → null. Accepts "800.000", "800,000đ". */
function parseMoney(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v >= 0 ? v : null;
  var s = String(v).replace(/[.,\s]|đ|vnd/gi, '');
  if (s === '') return '';
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

function debtOf(cost, paid) {
  return (Number(cost) || 0) - (Number(paid) || 0);
}

function yearOf(dateStr) {
  return Number(String(dateStr).slice(0, 4));
}

function dedupeName(base, existing) {
  if (existing.indexOf(base) < 0) return base;
  var i = 2;
  while (existing.indexOf(base + '_' + i) >= 0) i++;
  return base + '_' + i;
}

function text_(d, key, errors, label) {
  var s = d[key] == null ? '' : String(d[key]).trim();
  if (s.length > MAX_TEXT) errors.push(label + ' quá dài (tối đa ' + MAX_TEXT + ' ký tự)');
  return s;
}

/** Validates & normalizes patient input. Returns {errors:[], value:{}}. */
function validatePatient(d, currentYear) {
  var e = [];
  var v = {
    full_name: text_(d, 'full_name', e, 'Họ tên'),
    gender: text_(d, 'gender', e, 'Giới tính'),
    phone: normalizePhone(d.phone),
    address: text_(d, 'address', e, 'Địa chỉ'),
    allergies: text_(d, 'allergies', e, 'Dị ứng'),
    systemic_diseases: text_(d, 'systemic_diseases', e, 'Bệnh toàn thân'),
    current_meds: text_(d, 'current_meds', e, 'Thuốc đang dùng'),
    notes: text_(d, 'notes', e, 'Ghi chú')
  };
  if (!v.full_name) e.push('Thiếu họ tên');
  if (v.gender && GENDERS.indexOf(v.gender) < 0) e.push('Giới tính phải là Nam hoặc Nữ');
  v.dob = parseDateLoose(d.dob);
  if (v.dob === null) e.push('Ngày sinh không hợp lệ');
  var by = d.birth_year == null || d.birth_year === '' ? '' : Number(d.birth_year);
  if (by !== '' && !(Number.isInteger(by) && by >= 1900 && by <= currentYear)) e.push('Năm sinh không hợp lệ');
  v.birth_year = v.dob ? yearOf(v.dob) : by;
  return { errors: e, value: v };
}

function validateVisit(d) {
  var e = [];
  var v = {
    reason: text_(d, 'reason', e, 'Lý do'),
    diagnosis: text_(d, 'diagnosis', e, 'Chẩn đoán'),
    teeth: text_(d, 'teeth', e, 'Răng'),
    treatment: text_(d, 'treatment', e, 'Điều trị'),
    plan: text_(d, 'plan', e, 'Kế hoạch'),
    prescription: text_(d, 'prescription', e, 'Đơn thuốc'),
    notes: text_(d, 'notes', e, 'Ghi chú')
  };
  v.visit_date = parseDateLoose(d.visit_date);
  if (!v.visit_date) e.push('Ngày khám thiếu hoặc không hợp lệ');
  v.next_appointment = parseDateLoose(d.next_appointment);
  if (v.next_appointment === null) e.push('Ngày hẹn tái khám không hợp lệ');
  v.cost = parseMoney(d.cost);
  if (v.cost === null) e.push('Chi phí không hợp lệ');
  v.paid = parseMoney(d.paid);
  if (v.paid === null) e.push('Đã thu không hợp lệ');
  return { errors: e, value: v };
}

/**
 * Parses the 2 sheets of Mau_nhap_benh_nhan_cu.xlsx (rows from row 3, values already
 * normalized by the caller: Date → 'yyyy-mm-dd').
 * BenhNhan cols: A STT, B MaBN(ignored), C HoTen, D NgaySinh, E NamSinh, F GioiTinh, G SDT, H DiaChi,
 *   I DiUng, J BenhToanThan, K Thuoc, L ThuMucAnh, M GhiChu
 * LanKham cols: A STT BN, B(auto), C NgayKham, D LyDo, E ChanDoan, F Rang, G DieuTri, H KeHoach,
 *   I DonThuoc, J ChiPhi, K DaThu, L(auto), M HenTaiKham, N GhiChu
 */
function parseImport(bnRows, lkRows, opts) {
  var errors = [], warnings = [], patients = [], byStt = {}, skippedExisting = 0;
  var existing = {};
  (opts.existingStts || []).forEach(function (s) { existing[Number(s)] = true; });
  var isBlank = function (r) { return r.every(function (c) { return c === '' || c == null; }); };
  var isExample = function (r, col) { return /VÍ DỤ/i.test(String(r[col] || '')); };

  bnRows.forEach(function (r, i) {
    var row = i + 3;
    if (isBlank(r.slice(0, 13))) return;
    if (isExample(r, 12)) { warnings.push({ sheet: 'BenhNhan', row: row, message: 'Bỏ qua dòng VÍ DỤ' }); return; }
    var stt = Number(r[0]);
    if (!(Number.isInteger(stt) && stt >= 1)) { errors.push({ sheet: 'BenhNhan', row: row, message: 'STT phải là số nguyên ≥ 1' }); return; }
    if (byStt[stt]) { errors.push({ sheet: 'BenhNhan', row: row, message: 'STT ' + stt + ' bị trùng' }); return; }
    var res = validatePatient({
      full_name: r[2], dob: r[3], birth_year: r[4], gender: r[5], phone: r[6], address: r[7],
      allergies: r[8], systemic_diseases: r[9], current_meds: r[10], notes: r[12]
    }, opts.currentYear);
    res.errors.forEach(function (m) { errors.push({ sheet: 'BenhNhan', row: row, message: m }); });
    var p = res.value;
    p.import_stt = stt;
    p.import_folder_name = String(r[11] == null ? '' : r[11]).trim();
    p.visits = [];
    byStt[stt] = p;
    if (existing[stt]) { skippedExisting++; p.skip = true; }
    patients.push(p);
  });

  lkRows.forEach(function (r, i) {
    var row = i + 3;
    if (isBlank([r[0]].concat(r.slice(2, 11), r.slice(12, 14)))) return;
    if (isExample(r, 13)) { warnings.push({ sheet: 'LanKham', row: row, message: 'Bỏ qua dòng VÍ DỤ' }); return; }
    var p = byStt[Number(r[0])];
    if (!p) { errors.push({ sheet: 'LanKham', row: row, message: 'STT BN "' + r[0] + '" không có trong sheet BenhNhan' }); return; }
    var res = validateVisit({
      visit_date: r[2], reason: r[3], diagnosis: r[4], teeth: r[5], treatment: r[6], plan: r[7],
      prescription: r[8], cost: r[9], paid: r[10], next_appointment: r[12], notes: r[13]
    });
    res.errors.forEach(function (m) { errors.push({ sheet: 'LanKham', row: row, message: m }); });
    p.visits.push(res.value);
  });

  patients.forEach(function (p) {
    var dates = p.visits.map(function (v) { return v.visit_date; }).filter(Boolean).sort();
    p.year = dates.length ? yearOf(dates[0]) : opts.currentYear;
  });
  return { patients: patients, errors: errors, warnings: warnings, skippedExisting: skippedExisting };
}

if (typeof module !== 'undefined') module.exports = {}; // allow plain require in tooling
