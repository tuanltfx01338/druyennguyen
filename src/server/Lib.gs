/**
 * Pure helpers — NO Google APIs here, so test/lib.test.js can load this file in Node.
 */

var TABLES = {
  Patients: ['patient_id', 'full_name', 'name_search', 'national_id', 'dob', 'birth_year', 'gender', 'phone', 'address',
    'allergies', 'systemic_diseases', 'current_meds', 'notes', 'avatar_id', 'folder_id', 'import_stt', 'import_folder_name',
    'created_at', 'updated_at', 'deleted'],
  Visits: ['visit_id', 'patient_id', 'visit_date', 'reason', 'diagnosis', 'teeth', 'treatment', 'plan',
    'prescription', 'notes', 'folder_id', 'source',
    'created_at', 'updated_at', 'deleted'],
  // visit_id = lần khám đã đặt hẹn này · result_visit_id = lần khám ghi kết quả của buổi hẹn này
  Appointments: ['appt_id', 'patient_id', 'appt_date', 'start_time', 'duration_min', 'title', 'notes', 'status', 'visit_id',
    'result_visit_id', 'created_at', 'updated_at', 'deleted'],
  Images: ['image_id', 'visit_id', 'patient_id', 'file_name', 'mime', 'size_bytes', 'label', 'created_at', 'deleted'],
  Counters: ['year', 'last_seq'],
  ImportLog: ['run_id', 'at', 'sheet', 'row', 'status', 'message']
};
var DATE_COLS = { Patients: ['dob'], Visits: ['visit_date'], Appointments: ['appt_date'] };
var NUMBER_COLS = {
  Patients: ['birth_year', 'import_stt'], Images: ['size_bytes'], Appointments: ['duration_min'],
  Counters: ['year', 'last_seq'], ImportLog: ['row']
};
var IMAGE_LABELS = ['truoc', 'sau', 'xquang', 'khac'];
var GENDERS = ['Nam', 'Nữ'];
var MAX_TEXT = 4000;
var IMPORT_VISIT_REASON = 'Dữ liệu cũ';
/** scheduled = đã hẹn · arrived = đã đến · no_show = không đến · cancelled = huỷ */
var APPT_STATUSES = ['scheduled', 'arrived', 'no_show', 'cancelled'];

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

/** Several numbers allowed ("0903…, 0912…"); each normalized, duplicates dropped. */
function normalizePhones(v) {
  if (v == null || v === '') return '';
  var parts = typeof v === 'number' ? [v] : String(v).split(/[,;\/\n]+/);
  var out = [];
  parts.map(normalizePhone).filter(Boolean).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
  return out.join(', ');
}

/** Căn cước công dân: 12 chữ số, duy nhất mỗi công dân. '' → '', invalid → null. */
function normalizeNationalId(v) {
  if (v == null || v === '') return '';
  var s = typeof v === 'number' ? String(Math.round(v)).padStart(12, '0') : String(v).replace(/[\s.-]/g, '');
  return /^\d{12}$/.test(s) ? s : null;
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
    phone: normalizePhones(d.phone),
    address: text_(d, 'address', e, 'Địa chỉ'),
    allergies: text_(d, 'allergies', e, 'Dị ứng'),
    systemic_diseases: text_(d, 'systemic_diseases', e, 'Bệnh toàn thân'),
    current_meds: text_(d, 'current_meds', e, 'Thuốc đang dùng'),
    notes: text_(d, 'notes', e, 'Ghi chú')
  };
  if (!v.full_name) e.push('Thiếu họ tên');
  v.national_id = normalizeNationalId(d.national_id);
  if (v.national_id === null) e.push('Số CCCD phải gồm đúng 12 chữ số');
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
  return { errors: e, value: v };
}

/**
 * Parses the 2 sheets of Mau_nhap_benh_nhan_cu.xlsx (rows from row 3, values already
 * normalized by the caller: Date → 'yyyy-mm-dd').
 * BenhNhan cols: A STT, B MaBN(ignored), C HoTen, D NgaySinh, E NamSinh, F GioiTinh, G CCCD, H SDT, I DiaChi,
 *   J DiUng, K BenhToanThan, L Thuoc, M ThuMucAnh, N GhiChu
 * LanKham cols: A STT BN, B(auto), C NgayKham, D LyDo, E ChanDoan, F Rang, G DieuTri, H KeHoach,
 *   I DonThuoc, J HenTaiKham, K GhiChu
 */
function parseImport(bnRows, lkRows, opts) {
  var errors = [], warnings = [], patients = [], byStt = {}, skippedExisting = 0;
  var existing = {}, idOwner = {}; // idOwner: CCCD → "hồ sơ NK…" / "dòng n"
  (opts.existingStts || []).forEach(function (s) { existing[Number(s)] = true; });
  (opts.existingNationalIds || []).forEach(function (x) { idOwner[x.national_id] = { stt: x.import_stt, label: 'hồ sơ ' + x.patient_id }; });
  var isBlank = function (r) { return r.every(function (c) { return c === '' || c == null; }); };
  var isExample = function (r, col) { return /VÍ DỤ/i.test(String(r[col] || '')); };

  bnRows.forEach(function (r, i) {
    var row = i + 3;
    if (isBlank(r.slice(0, 14))) return;
    if (isExample(r, 13)) { warnings.push({ sheet: 'BenhNhan', row: row, message: 'Bỏ qua dòng VÍ DỤ' }); return; }
    var stt = Number(r[0]);
    if (!(Number.isInteger(stt) && stt >= 1)) { errors.push({ sheet: 'BenhNhan', row: row, message: 'STT phải là số nguyên ≥ 1' }); return; }
    if (byStt[stt]) { errors.push({ sheet: 'BenhNhan', row: row, message: 'STT ' + stt + ' bị trùng' }); return; }
    var res = validatePatient({
      full_name: r[2], dob: r[3], birth_year: r[4], gender: r[5], national_id: r[6], phone: r[7], address: r[8],
      allergies: r[9], systemic_diseases: r[10], current_meds: r[11], notes: r[13]
    }, opts.currentYear);
    res.errors.forEach(function (m) { errors.push({ sheet: 'BenhNhan', row: row, message: m }); });
    var p = res.value;
    if (p.national_id) {
      var owner = idOwner[p.national_id];
      // Same CCCD on a re-run of the same file (same STT) is fine; anything else is a duplicate person.
      if (owner && owner.stt !== stt) errors.push({ sheet: 'BenhNhan', row: row, message: 'CCCD ' + p.national_id + ' trùng với ' + owner.label });
      else if (!owner) idOwner[p.national_id] = { stt: stt, label: 'dòng ' + row };
    }
    p.import_stt = stt;
    p.import_folder_name = String(r[12] == null ? '' : r[12]).trim();
    p.visits = [];
    byStt[stt] = p;
    if (existing[stt]) { skippedExisting++; p.skip = true; }
    patients.push(p);
  });

  lkRows.forEach(function (r, i) {
    var row = i + 3;
    if (isBlank([r[0]].concat(r.slice(2, 11)))) return;
    if (isExample(r, 10)) { warnings.push({ sheet: 'LanKham', row: row, message: 'Bỏ qua dòng VÍ DỤ' }); return; }
    var p = byStt[Number(r[0])];
    if (!p) { errors.push({ sheet: 'LanKham', row: row, message: 'STT BN "' + r[0] + '" không có trong sheet BenhNhan' }); return; }
    var res = validateVisit({
      visit_date: r[2], reason: r[3], diagnosis: r[4], teeth: r[5], treatment: r[6], plan: r[7],
      prescription: r[8], next_appointment: r[9], notes: r[10]
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

/** ['2026-06', …, '2026-11'] — the n months ending with today's month. */
function lastMonths(today, n) {
  var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var mm = m - i, yy = y;
    while (mm < 1) { mm += 12; yy--; }
    out.push(yy + '-' + String(mm).padStart(2, '0'));
  }
  return out;
}

function addDays(dateStr, n) {
  var p = dateStr.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

/** 'HH:mm' (24h) or '' (chưa đặt giờ). */
function isValidTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
}

function timeToMin(t) {
  var p = String(t).split(':').map(Number);
  return p[0] * 60 + p[1];
}

/** Excel/Sheets may hand back a time as Date or number of days; normalize to 'HH:mm' or ''. */
function normalizeTime(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim().replace(/[hH.]/, ':');
  var m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{1,2})$/);
  if (!m) return null;
  var t = String(m[1]).padStart(2, '0') + ':' + (m[2] || '00');
  return isValidTime(t) ? t : null;
}

function validateAppointment(d) {
  var e = [];
  var v = {
    patient_id: String(d.patient_id || '').trim(),
    title: text_(d, 'title', e, 'Nội dung'),
    notes: text_(d, 'notes', e, 'Ghi chú'),
    status: d.status ? String(d.status) : 'scheduled'
  };
  if (!v.patient_id) e.push('Chưa chọn bệnh nhân');
  v.appt_date = parseDateLoose(d.appt_date);
  if (!v.appt_date) e.push('Ngày hẹn thiếu hoặc không hợp lệ');
  v.start_time = normalizeTime(d.start_time);
  if (v.start_time === null) e.push('Giờ hẹn không hợp lệ (HH:mm)');
  var dur = d.duration_min == null || d.duration_min === '' ? '' : Number(d.duration_min);
  if (dur !== '' && !(Number.isInteger(dur) && dur >= 5 && dur <= 720)) e.push('Thời lượng phải từ 5 đến 720 phút');
  if (v.start_time && dur === '') e.push('Chưa nhập thời lượng dự kiến');
  v.duration_min = dur;
  if (APPT_STATUSES.indexOf(v.status) < 0) e.push('Trạng thái không hợp lệ');
  return { errors: e, value: v };
}

/** Timed, non-cancelled appointments on the same day whose time ranges overlap `a`. */
function findConflicts(appts, a) {
  if (!a.start_time || !a.duration_min) return [];
  var s = timeToMin(a.start_time), e = s + Number(a.duration_min);
  return appts.filter(function (b) {
    if (b.appt_id === a.appt_id || b.appt_date !== a.appt_date || !b.start_time || !b.duration_min || b.status === 'cancelled') return false;
    var bs = timeToMin(b.start_time), be = bs + Number(b.duration_min);
    return bs < e && s < be;
  });
}

function sortAppointments(list) {
  return list.sort(function (a, b) {
    return String(a.appt_date).localeCompare(String(b.appt_date))
      || (a.start_time ? 1 : 0) - (b.start_time ? 1 : 0) // untimed first within a day (all-day row)
      || String(a.start_time).localeCompare(String(b.start_time));
  });
}

/**
 * Dashboard numbers (clinical only — no money). "import-images" visits are containers for old photos,
 * not real consultations → excluded from visit counts.
 */
function buildDashboard(patients, visits, today, appointments) {
  var byId = {};
  patients.forEach(function (p) { byId[p.patient_id] = p; });
  var real = visits.filter(function (v) { return byId[v.patient_id] && v.source !== 'import-images'; });
  var months = lastMonths(today, 6);
  var monthly = months.map(function (m) { return { month: m, visits: 0 }; });
  var todayVisits = [];
  real.forEach(function (v) {
    var i = months.indexOf(String(v.visit_date).slice(0, 7));
    if (i >= 0) monthly[i].visits++;
    if (v.visit_date === today) todayVisits.push({ patient_id: v.patient_id, full_name: byId[v.patient_id].full_name,
      avatar_id: byId[v.patient_id].avatar_id, allergies: byId[v.patient_id].allergies, visit_id: v.visit_id, reason: v.reason, diagnosis: v.diagnosis });
  });
  var resultIds = {};
  (appointments || []).forEach(function (a) { if (a.result_visit_id) resultIds[a.result_visit_id] = true; });
  // Latest visit before today per patient — what the doctor wants to recall before the patient sits down.
  var lastVisit = {};
  real.forEach(function (v) {
    if (v.visit_date >= today) return;
    var cur = lastVisit[v.patient_id];
    if (!cur || v.visit_date > cur.visit_date) lastVisit[v.patient_id] = v;
  });
  var pub = function (a) {
    var p = byId[a.patient_id], lv = lastVisit[a.patient_id];
    return { appt_id: a.appt_id, patient_id: a.patient_id, full_name: p.full_name, phone: p.phone, avatar_id: p.avatar_id,
      allergies: p.allergies, systemic_diseases: p.systemic_diseases, gender: p.gender, dob: p.dob, birth_year: p.birth_year,
      appt_date: a.appt_date, start_time: a.start_time, duration_min: a.duration_min, title: a.title, notes: a.notes,
      status: a.status, result_visit_id: a.result_visit_id || '',
      last_visit: lv ? { visit_date: lv.visit_date, diagnosis: lv.diagnosis, treatment: lv.treatment, plan: lv.plan, teeth: lv.teeth } : null };
  };
  var mine = (appointments || []).filter(function (a) { return byId[a.patient_id]; });
  var to = addDays(today, 7), since = addDays(today, -30);
  var upcoming = sortAppointments(mine.filter(function (a) {
    return a.status !== 'cancelled' && a.appt_date >= today && a.appt_date <= to;
  })).map(pub);
  // Missed appointments (last 30 days) — patients to call back.
  var missed = sortAppointments(mine.filter(function (a) {
    return a.status === 'no_show' && a.appt_date >= since && a.appt_date <= today;
  })).reverse().map(pub);
  var month = today.slice(0, 7);
  return {
    today: today,
    stats: {
      patients: patients.length,
      newPatientsMonth: patients.filter(function (p) { return String(p.created_at).slice(0, 7) === month; }).length,
      visitsToday: todayVisits.length, visitsMonth: monthly[monthly.length - 1].visits,
      apptToday: upcoming.filter(function (a) { return a.appt_date === today; }).length, appt7: upcoming.length,
      missed30: missed.length
    },
    monthly: monthly, todayVisits: todayVisits, upcoming: upcoming, missed: missed.slice(0, 10),
    // Today's work list: appointments (with/without recorded result) + walk-in visits not tied to an appointment.
    todayAppts: upcoming.filter(function (a) { return a.appt_date === today; }),
    walkIns: todayVisits.filter(function (v) { return !resultIds[v.visit_id]; })
  };
}

if (typeof module !== 'undefined') module.exports = {}; // allow plain require in tooling
