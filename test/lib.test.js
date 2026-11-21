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
