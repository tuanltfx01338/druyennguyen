// Run: npm test  (Node >= 18, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/server/Lib.gs'), 'utf8'), ctx);
const L = ctx;

test('normalizeText strips Vietnamese accents and đ', () => {
  assert.equal(L.normalizeText('  Nguyễn   Văn Ấn '), 'nguyen van an');
  assert.equal(L.normalizeText('Đặng Thị Đào'), 'dang thi dao');
  assert.ok(L.normalizeText('Nguyễn Văn A').includes(L.normalizeText('nguyen van a')));
});

test('patient id format & query parsing', () => {
  assert.equal(L.formatPatientId(2026, 1), 'NK26-0001');
  assert.equal(L.formatPatientId(2026, 12345), 'NK26-12345');
  assert.equal(L.parsePatientIdQuery('nk26-1'), 'NK26-0001');
  assert.equal(L.parsePatientIdQuery('NK 26 0012'), 'NK26-0012');
  assert.equal(L.parsePatientIdQuery('nguyen'), null);
});

test('dates', () => {
  assert.equal(L.parseDateLoose('12/03/1985'), '1985-03-12');
  assert.equal(L.parseDateLoose('2024-05-20'), '2024-05-20');
  assert.equal(L.parseDateLoose(''), '');
  assert.equal(L.parseDateLoose('31/02/2024'), null);
  assert.equal(L.parseDateLoose('abc'), null);
});

test('sanitizeCell blocks formula injection', () => {
  assert.equal(L.sanitizeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(L.sanitizeCell('bình thường'), 'bình thường');
  assert.equal(L.sanitizeCell(5), 5);
});

test('phone & money', () => {
  assert.equal(L.normalizePhone(903123456), '0903123456');
  assert.equal(L.normalizePhone('0903123456'), '0903123456');
  assert.equal(L.parseMoney('800.000đ'), 800000);
  assert.equal(L.parseMoney(500000), 500000);
  assert.equal(L.parseMoney(''), '');
  assert.equal(L.parseMoney('abc'), null);
  assert.equal(L.parseMoney(-1), null);
  assert.equal(L.debtOf(800000, 500000), 300000);
  assert.equal(L.debtOf('', ''), 0);
});

test('dedupeName', () => {
  assert.equal(L.dedupeName('2026-11-21', []), '2026-11-21');
  assert.equal(L.dedupeName('2026-11-21', ['2026-11-21', '2026-11-21_2']), '2026-11-21_3');
});

test('validatePatient / validateVisit', () => {
  const p = L.validatePatient({ full_name: ' Lê B ', dob: '01/02/1990', gender: 'Nữ' }, 2026);
  assert.equal(p.errors.length, 0);
  assert.equal(p.value.birth_year, 1990);
  assert.equal(p.value.full_name, 'Lê B');
  assert.ok(L.validatePatient({ full_name: '', gender: 'X' }, 2026).errors.length === 2);
  assert.ok(L.validatePatient({ full_name: 'A', birth_year: 3000 }, 2026).errors.length === 1);

  const v = L.validateVisit({ visit_date: '2026-11-21', cost: '800.000', paid: 500000 });
  assert.equal(v.errors.length, 0);
  assert.equal(v.value.cost, 800000);
  assert.ok(L.validateVisit({ visit_date: '' }).errors.includes('Ngày khám thiếu hoặc không hợp lệ'));
});

test('parseImport: happy path, example rows, errors, dedupe, year from first visit', () => {
  const bn = [
    [1, '', 'Nguyễn Văn An', '1985-03-12', '', 'Nam', 903123456, 'HCM', '', '', '', '0001_Nguyen Van An', ''],
    [2, '', 'Trần B', '', 1970, 'Nữ', '', '', '', '', '', '', ''],
    [3, '', 'Đã import', '', '', '', '', '', '', '', '', '', ''],
    [99, '', 'Ví dụ', '', '', '', '', '', '', '', '', '', 'VÍ DỤ – xoá dòng này'],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    [2, '', 'Trùng', '', '', '', '', '', '', '', '', '', ''],
  ];
  const lk = [
    [1, 'auto', '2024-05-20', 'Đau', '', '46', '', '', '', 800000, 500000, 300000, '', '', ''],
    [1, 'auto', '2019-01-02', '', '', '', '', '', '', '', '', '', '', ''],
    [7, 'x', '2024-01-01', '', '', '', '', '', '', '', '', '', '', ''],
    [2, 'x', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const r = L.parseImport(bn, lk, { currentYear: 2026, existingStts: [3] });
  assert.equal(r.patients.length, 3);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.skippedExisting, 1);
  const p1 = r.patients[0];
  assert.equal(p1.phone, '0903123456');
  assert.equal(p1.visits.length, 2);
  assert.equal(p1.year, 2019);
  assert.equal(r.patients[1].year, 2026); // no valid visits → current year
  const msgs = r.errors.map(e => `${e.sheet}:${e.row}:${e.message}`);
  assert.ok(msgs.some(m => m.startsWith('BenhNhan:8:') && m.includes('trùng')));
  assert.ok(msgs.some(m => m.startsWith('LanKham:5:') && m.includes('không có')));
  assert.ok(msgs.some(m => m.startsWith('LanKham:6:') && m.includes('Ngày khám')));
  assert.equal(r.errors.length, 3);
});

test('lastMonths / addDays', () => {
  assert.deepEqual([...L.lastMonths('2026-02-15', 4)], ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
});

test('buildDashboard', () => {
  const P = [{ patient_id: 'A', full_name: 'An', phone: '1' }, { patient_id: 'B', full_name: 'Bình', phone: '2' }];
  const V = [
    { visit_id: 1, patient_id: 'A', visit_date: '2026-11-21', cost: 1000, paid: 400, reason: 'Đau', next_appointment: '2026-11-21', source: 'app' },
    { visit_id: 2, patient_id: 'A', visit_date: '2026-10-01', cost: 500, paid: 500, next_appointment: '2026-11-25', source: 'app' },
    { visit_id: 3, patient_id: 'B', visit_date: '2026-06-02', cost: 300, paid: 0, next_appointment: '2026-11-28', source: 'import' },
    { visit_id: 4, patient_id: 'B', visit_date: '2026-11-21', source: 'import-images' }, // photo container, not a visit
    { visit_id: 5, patient_id: 'GONE', visit_date: '2026-11-21', cost: 9, paid: 0 },      // deleted patient
    { visit_id: 6, patient_id: 'B', visit_date: '2025-01-01', cost: 100, paid: 0 },       // outside 6 months, still debt
  ];
  const d = JSON.parse(JSON.stringify(L.buildDashboard(P, V, '2026-11-21')));
  assert.deepEqual(d.monthly.map(m => m.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(d.monthly.map(m => m.visits), [1, 0, 0, 0, 1, 1]);
  assert.equal(d.monthly[5].paid, 400);
  assert.deepEqual(d.stats, { patients: 2, visitsToday: 1, visitsMonth: 1, paidMonth: 400, apptToday: 1, appt7: 2, totalDebt: 1000, debtorCount: 2 });
  assert.deepEqual(d.upcoming.map(u => u.patient_id), ['A', 'B']); // A: latest visit's appointment (today), B within 7 days
  assert.equal(d.upcoming[0].next_appointment, '2026-11-21');
  assert.deepEqual(d.debtors.map(x => [x.patient_id, x.debt]), [['A', 600], ['B', 400]]);
  assert.deepEqual(d.todayVisits.map(x => x.visit_id), [1]);
});
