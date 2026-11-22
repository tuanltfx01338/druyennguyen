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

test('phones (many) & CCCD', () => {
  assert.equal(L.normalizePhone(903123456), '0903123456');
  assert.equal(L.normalizePhones('0903123456; 912345678 / 0903123456'), '0903123456, 0912345678');
  assert.equal(L.normalizePhones(903123456), '0903123456');
  assert.equal(L.normalizePhones(''), '');
  assert.equal(L.normalizeNationalId('079 085 001 234'), '079085001234');
  assert.equal(L.normalizeNationalId(79085001234), '079085001234'); // Excel dropped the leading 0
  assert.equal(L.normalizeNationalId('12345'), null);
  assert.equal(L.normalizeNationalId(''), '');
});

test('dedupeName', () => {
  assert.equal(L.dedupeName('2026-11-21', []), '2026-11-21');
  assert.equal(L.dedupeName('2026-11-21', ['2026-11-21', '2026-11-21_2']), '2026-11-21_3');
});

test('validatePatient / validateVisit', () => {
  const p = L.validatePatient({ full_name: ' Lê B ', dob: '01/02/1990', gender: 'Nữ', national_id: '079190000001', phone: '0901, 0902' }, 2026);
  assert.equal(p.errors.length, 0);
  assert.equal(p.value.birth_year, 1990);
  assert.equal(p.value.full_name, 'Lê B');
  assert.equal(p.value.national_id, '079190000001');
  assert.ok(L.validatePatient({ full_name: 'A', national_id: '123' }, 2026).errors.includes('Số CCCD phải gồm đúng 12 chữ số'));
  assert.ok(L.validatePatient({ full_name: '', gender: 'X' }, 2026).errors.length === 2);
  assert.ok(L.validatePatient({ full_name: 'A', birth_year: 3000 }, 2026).errors.length === 1);

  const v = L.validateVisit({ visit_date: '2026-11-21', diagnosis: 'Sâu R16', cost: 800000 });
  assert.equal(v.errors.length, 0);
  assert.equal(v.value.cost, undefined); // no money fields kept
  assert.ok(L.validateVisit({ visit_date: '' }).errors.includes('Ngày khám thiếu hoặc không hợp lệ'));
});

test('parseImport: happy path, example rows, errors, dedupe, CCCD unique, year from first visit', () => {
  // A STT, B Ma, C Ten, D NgaySinh, E NamSinh, F Gioi, G CCCD, H SDT, I DiaChi, J DiUng, K Benh, L Thuoc, M ThuMuc, N GhiChu
  const bn = [
    [1, '', 'Nguyễn Văn An', '1985-03-12', '', 'Nam', '079085001234', 903123456, 'HCM', '', '', '', '0001_Nguyen Van An', ''],
    [2, '', 'Trần B', '', 1970, 'Nữ', '', '0901; 0902', '', '', '', '', '', ''],
    [3, '', 'Đã import', '', '', '', '', '', '', '', '', '', '', ''],
    [99, '', 'Ví dụ', '', '', '', '', '', '', '', '', '', '', 'VÍ DỤ – xoá dòng này'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [2, '', 'Trùng', '', '', '', '', '', '', '', '', '', '', ''],
    [4, '', 'Trùng CCCD trong file', '', '', '', '079085001234', '', '', '', '', '', '', ''],
    [5, '', 'Trùng CCCD hồ sơ cũ', '', '', '', '001200000009', '', '', '', '', '', '', ''],
  ];
  // A STT BN, B auto, C NgayKham, D LyDo, E ChanDoan, F Rang, G DieuTri, H KeHoach, I DonThuoc, J HenTaiKham, K GhiChu
  const lk = [
    [1, 'auto', '2024-05-20', 'Đau', '', '46', '', 'Làm sứ', '', '2024-05-27', ''],
    [1, 'auto', '2019-01-02', '', '', '', '', '', '', '', ''],
    [7, 'x', '2024-01-01', '', '', '', '', '', '', '', ''],
    [2, 'x', '', '', '', '', '', '', '', '', ''],
  ];
  const r = L.parseImport(bn, lk, { currentYear: 2026, existingStts: [3],
    existingNationalIds: [{ national_id: '001200000009', patient_id: 'NK25-0001', import_stt: null }] });
  assert.equal(r.patients.length, 5);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.skippedExisting, 1);
  const p1 = r.patients[0];
  assert.equal(p1.phone, '0903123456');
  assert.equal(p1.national_id, '079085001234');
  assert.equal(r.patients[1].phone, '0901, 0902');
  assert.equal(p1.visits.length, 2);
  assert.equal(p1.visits[0].next_appointment, '2024-05-27');
  assert.equal(p1.year, 2019);
  assert.equal(r.patients[1].year, 2026); // no valid visits → current year
  const msgs = r.errors.map(e => `${e.sheet}:${e.row}:${e.message}`);
  assert.ok(msgs.some(m => m.startsWith('BenhNhan:8:') && m.includes('trùng')));
  assert.ok(msgs.some(m => m.startsWith('BenhNhan:9:') && m.includes('trùng với dòng 3')));
  assert.ok(msgs.some(m => m.startsWith('BenhNhan:10:') && m.includes('trùng với hồ sơ NK25-0001')));
  assert.ok(msgs.some(m => m.startsWith('LanKham:5:') && m.includes('không có')));
  assert.ok(msgs.some(m => m.startsWith('LanKham:6:') && m.includes('Ngày khám')));
  assert.equal(r.errors.length, 5);
  // re-running the same file: CCCD owned by the same STT is not a duplicate
  const again = L.parseImport(bn.slice(0, 1), [], { currentYear: 2026, existingStts: [1],
    existingNationalIds: [{ national_id: '079085001234', patient_id: 'NK19-0001', import_stt: 1 }] });
  assert.equal(again.errors.length, 0);
});

test('lastMonths / addDays', () => {
  assert.deepEqual([...L.lastMonths('2026-02-15', 4)], ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
});

test('appointments: time, validation, conflicts, ordering', () => {
  assert.equal(L.normalizeTime('8:30'), '08:30');
  assert.equal(L.normalizeTime('14h15'), '14:15');
  assert.equal(L.normalizeTime('9'), '09:00');
  assert.equal(L.normalizeTime(''), '');
  assert.equal(L.normalizeTime('25:00'), null);
  const ok = L.validateAppointment({ patient_id: 'A', appt_date: '2026-11-21', start_time: '9:00', duration_min: 45, title: 'Lắp sứ' });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.value.start_time, '09:00');
  assert.equal(ok.value.status, 'scheduled');
  assert.equal(L.validateAppointment({ patient_id: 'A', appt_date: '2026-11-21' }).errors.length, 0); // no time = all-day
  const bad = L.validateAppointment({ appt_date: 'x', start_time: '10:00', duration_min: '', status: 'zzz' }).errors;
  assert.deepEqual([...bad], ['Chưa chọn bệnh nhân', 'Ngày hẹn thiếu hoặc không hợp lệ', 'Chưa nhập thời lượng dự kiến', 'Trạng thái không hợp lệ']);
  assert.ok(L.validateAppointment({ patient_id: 'A', appt_date: '2026-11-21', start_time: '10:00', duration_min: 3 }).errors.length === 1);

  const list = [
    { appt_id: 1, appt_date: '2026-11-21', start_time: '09:00', duration_min: 60, status: 'scheduled' },
    { appt_id: 2, appt_date: '2026-11-21', start_time: '10:00', duration_min: 30, status: 'scheduled' },
    { appt_id: 3, appt_date: '2026-11-21', start_time: '09:30', duration_min: 30, status: 'cancelled' },
    { appt_id: 4, appt_date: '2026-11-21', start_time: '', duration_min: '', status: 'scheduled' },
    { appt_id: 5, appt_date: '2026-11-22', start_time: '09:15', duration_min: 30, status: 'scheduled' },
  ];
  const c = L.findConflicts(list, { appt_id: 9, appt_date: '2026-11-21', start_time: '09:45', duration_min: 30 });
  assert.deepEqual(c.map(x => x.appt_id), [1, 2]); // 09:45–10:15 overlaps 1 and 2; cancelled/untimed/other day ignored
  assert.equal(L.findConflicts(list, { appt_id: 9, appt_date: '2026-11-21', start_time: '10:30', duration_min: 15 }).length, 0);
  assert.deepEqual(L.sortAppointments(list.slice().reverse()).map(x => x.appt_id), [4, 1, 3, 2, 5]);
});

test('buildDashboard (no money): counts, appointments, missed', () => {
  const P = [{ patient_id: 'A', full_name: 'An', phone: '1', avatar_id: 'img1', created_at: '2026-11-02 10:00:00' },
    { patient_id: 'B', full_name: 'Bình', phone: '2', created_at: '2025-03-01 10:00:00' }];
  const V = [
    { visit_id: 1, patient_id: 'A', visit_date: '2026-11-21', reason: 'Đau', source: 'app' },
    { visit_id: 2, patient_id: 'A', visit_date: '2026-10-01', source: 'app' },
    { visit_id: 3, patient_id: 'B', visit_date: '2026-06-02', source: 'import' },
    { visit_id: 4, patient_id: 'B', visit_date: '2026-11-21', source: 'import-images' }, // photo container, not a visit
    { visit_id: 5, patient_id: 'GONE', visit_date: '2026-11-21' },                       // deleted patient
  ];
  const A = [
    { appt_id: 'x1', patient_id: 'A', appt_date: '2026-11-21', start_time: '14:00', duration_min: 30, title: 'Lắp sứ', status: 'scheduled' },
    { appt_id: 'x2', patient_id: 'A', appt_date: '2026-11-21', start_time: '08:00', duration_min: 30, status: 'arrived', result_visit_id: 1 },
    { appt_id: 'x3', patient_id: 'B', appt_date: '2026-11-28', start_time: '', status: 'scheduled' },
    { appt_id: 'x4', patient_id: 'B', appt_date: '2026-11-22', start_time: '09:00', duration_min: 30, status: 'cancelled' },
    { appt_id: 'x5', patient_id: 'B', appt_date: '2026-11-29', start_time: '09:00', duration_min: 30, status: 'scheduled' }, // > 7 days
    { appt_id: 'x6', patient_id: 'GONE', appt_date: '2026-11-21', start_time: '09:00', duration_min: 30, status: 'scheduled' },
    { appt_id: 'm1', patient_id: 'B', appt_date: '2026-11-10', start_time: '10:00', duration_min: 30, status: 'no_show' },
    { appt_id: 'm2', patient_id: 'A', appt_date: '2026-11-18', start_time: '10:00', duration_min: 30, status: 'no_show' },
    { appt_id: 'm3', patient_id: 'A', appt_date: '2026-09-01', start_time: '10:00', duration_min: 30, status: 'no_show' },   // > 30 days
  ];
  const d = JSON.parse(JSON.stringify(L.buildDashboard(P, V, '2026-11-21', A)));
  assert.deepEqual(d.monthly.map(m => m.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(d.monthly.map(m => m.visits), [1, 0, 0, 0, 1, 1]);
  assert.deepEqual(d.stats, { patients: 2, newPatientsMonth: 1, visitsToday: 1, visitsMonth: 1, apptToday: 2, appt7: 3, missed30: 2 });
  assert.deepEqual(d.upcoming.map(u => u.appt_id), ['x2', 'x1', 'x3']);
  assert.equal(d.upcoming[1].avatar_id, 'img1');
  assert.deepEqual(d.missed.map(u => u.appt_id), ['m2', 'm1']); // most recent first
  assert.deepEqual(d.todayVisits.map(x => x.visit_id), [1]);
  assert.deepEqual(d.todayAppts.map(x => [x.appt_id, x.result_visit_id]), [['x2', 1], ['x1', '']]);
  assert.equal(d.todayAppts[1].last_visit.visit_date, '2026-10-01'); // last visit before today, not today's
  assert.deepEqual(d.walkIns, []); // visit 1 is the result of appointment x2, not a walk-in
  const d2 = JSON.parse(JSON.stringify(L.buildDashboard(P, V, '2026-11-21', A.filter(a => a.appt_id !== 'x2'))));
  assert.deepEqual(d2.walkIns.map(x => x.visit_id), [1]);
  assert.ok(!JSON.stringify(d).match(/paid|debt|cost/));
});
