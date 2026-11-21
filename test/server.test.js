// Integration tests of src/server/*.gs against in-memory Apps Script fakes (test/gas-mock.js).
process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGas } = require('./gas-mock');

const ORDER = ['Lib', 'Repo', 'Main', 'Patients', 'Visits', 'Appointments', 'Images', 'Import', 'Backup'];
function load(opts) {
  const gas = createGas(opts);
  const ctx = vm.createContext({ ...gas, Date, JSON, Math, Object, Array, String, Number, Promise });
  for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/server', f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' });
  ctx.setup();
  return { s: ctx, gas, sheet: n => gas.SpreadsheetApp.openById(gas.PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName(n) };
}
const plain = o => JSON.parse(JSON.stringify(o)); // vm-context arrays → host arrays for deepEqual
const year = new Date().getFullYear();
const yy = String(year).slice(-2);

test('setup is idempotent and creates all tables', () => {
  const { s, sheet } = load();
  s.setup();
  for (const t of ['Patients', 'Visits', 'Appointments', 'Images', 'Counters', 'ImportLog']) assert.ok(sheet(t), t);
  assert.equal(sheet('Patients').getLastRow(), 1);
});

test('patients: CCCD unique, many phones, search by CCCD/any phone, avatar', () => {
  const { s, gas } = load();
  const a = s.savePatient({ full_name: 'Lý Quốc Quân', national_id: '079 090 012 345', phone: '0903111222, 0283 8123 456' });
  assert.equal(s.getPatient(a).patient.national_id, '079090012345');
  assert.throws(() => s.savePatient({ full_name: 'Người khác', national_id: '079090012345' }), new RegExp('đã thuộc hồ sơ ' + a));
  s.savePatient({ patient_id: a, full_name: 'Lý Quốc Quân', national_id: '079090012345' }); // updating self is fine
  const b = s.savePatient({ full_name: 'Trẻ em chưa có CCCD' });                           // CCCD optional
  assert.ok(b);
  assert.deepEqual(plain(s.searchPatients('012345')).map(p => p.patient_id), [a]);
  assert.deepEqual(plain(s.searchPatients('8123')).map(p => p.patient_id), []); // phone was removed by the update above
  s.savePatient({ patient_id: a, full_name: 'Lý Quốc Quân', national_id: '079090012345', phone: '0903111222, 0283 8123 456' });
  assert.deepEqual(plain(s.searchPatients('81234')).map(p => p.patient_id), [a]);

  const ctx = s.getAvatarUploadContext(a);
  const F = gas.__File;
  const pic1 = new F('avatar.jpg', gas.DriveApp.getFolderById(ctx.folderId), 'image/jpeg', '', 50000);
  s.setPatientAvatar(a, pic1.id);
  assert.equal(plain(s.searchPatients('quan'))[0].avatar_id, pic1.id);
  const pic2 = new F('avatar2.jpg', gas.DriveApp.getFolderById(ctx.folderId), 'image/jpeg', '', 50000);
  s.setPatientAvatar(a, pic2.id);
  assert.ok(pic1.trashed); // old portrait trashed
  const stray = new F('x.jpg', gas.__root, 'image/jpeg', '', 1);
  assert.throws(() => s.setPatientAvatar(a, stray.id), /không nằm trong/);
  const today = s.today_();
  s.saveAppointment({ patient_id: a, appt_date: today, start_time: '09:00', duration_min: 30 });
  assert.equal(s.listAppointments(today, today)[0].avatar_id, pic2.id);
});

test('patients: create, id sequence, accent-less search, phone, formula injection, update, soft delete', () => {
  const { s, sheet } = load();
  const a = s.savePatient({ full_name: 'Nguyễn Văn An', phone: '0903123456', dob: '1985-03-12', allergies: 'Penicillin' });
  const b = s.savePatient({ full_name: 'Trần Thị Bình', notes: '=HYPERLINK("http://evil")' });
  assert.equal(a, `NK${yy}-0001`);
  assert.equal(b, `NK${yy}-0002`);
  assert.deepEqual(plain(s.searchPatients('nguyen van')).map(p => p.patient_id), [a]);
  assert.deepEqual(plain(s.searchPatients(`nk${yy}-2`)).map(p => p.patient_id), [b]);
  assert.deepEqual(plain(s.searchPatients('3123')).map(p => p.patient_id), [a]);
  const pa = s.getPatient(a).patient;
  assert.equal(pa.phone, '0903123456');
  assert.equal(pa.dob, '1985-03-12');
  assert.equal(pa.birth_year, 1985);
  assert.equal(s.getPatient(b).patient.notes, '=HYPERLINK("http://evil")'); // stored as text, not a formula
  s.savePatient({ patient_id: a, full_name: 'Nguyễn Văn Ân' });
  assert.equal(s.getPatient(a).patient.full_name, 'Nguyễn Văn Ân');
  assert.equal(sheet('Patients').getLastRow(), 3);
  assert.throws(() => s.savePatient({ full_name: '' }), /Thiếu họ tên/);
  s.deletePatient(b);
  assert.equal(s.searchPatients('tran').length, 0);
  assert.throws(() => s.getPatient(b), /không tồn tại/);
});

test('visits: save, debt, date search, upcoming appointments, delete', () => {
  const { s } = load();
  const p = s.savePatient({ full_name: 'Lê C' });
  const today = s.today_();
  const v1 = s.saveVisit({ patient_id: p, visit_date: '2026-01-05', teeth: '46' });
  const v2 = s.saveVisit({ patient_id: p, visit_date: today, plan: 'Làm sứ',
    appointment: { appt_date: today, start_time: '15:00', duration_min: 60, title: 'Làm sứ' } });
  const g = s.getPatient(p);
  assert.equal(g.visits.length, 2);
  assert.equal(g.visits[0].visit_id, v2); // newest first
  assert.deepEqual(plain(s.searchVisitsByDate('2026-01-01', '2026-01-31')).map(v => v.visit_id), [v1]);
  const up = plain(s.getDashboard().upcoming);
  assert.equal(up.length, 1);
  assert.equal(up[0].title, 'Làm sứ');
  assert.equal(up[0].start_time, '15:00');
  // editing the visit updates its linked appointment instead of creating another
  s.saveVisit({ visit_id: v2, visit_date: today, appointment: { appt_date: today, start_time: '16:00', duration_min: 30, title: 'Làm sứ' } });
  assert.equal(s.listAppointments(today, today).length, 1);
  assert.equal(s.getVisit(v2).visit.appointment.start_time, '16:00');
  assert.equal(s.getPatient(p).visits[0].appointment.start_time, '16:00');
  assert.throws(() => s.saveVisit({ patient_id: p, visit_date: '' }), /Ngày khám/);
  assert.throws(() => s.saveVisit({ patient_id: 'NK00-9999', visit_date: today }), /không tồn tại/);
  s.deleteVisit(v1);
  assert.equal(s.getPatient(p).visits.length, 1);
});

test('appointments: create, list by range, conflicts warn, status, delete, patient view', () => {
  const { s } = load();
  const a = s.savePatient({ full_name: 'Hồ Gia Huy', phone: '0901' });
  const b = s.savePatient({ full_name: 'Ngô Kim Vy' });
  const today = s.today_();
  const r1 = s.saveAppointment({ patient_id: a, appt_date: today, start_time: '09:00', duration_min: 60, title: 'Nhổ R38' });
  assert.equal(r1.conflicts.length, 0);
  const r2 = s.saveAppointment({ patient_id: b, appt_date: today, start_time: '9:30', duration_min: 30 });
  assert.deepEqual(plain(r2.conflicts), ['Hồ Gia Huy 09:00']); // warn, still saved
  s.saveAppointment({ patient_id: b, appt_date: today }); // no time
  const list = plain(s.listAppointments(today, today));
  assert.deepEqual(list.map(x => x.start_time), ['', '09:00', '09:30']);
  assert.equal(list[1].full_name, 'Hồ Gia Huy');
  assert.throws(() => s.saveAppointment({ patient_id: a, appt_date: today, start_time: '10:00' }), /thời lượng/);
  assert.throws(() => s.saveAppointment({ patient_id: 'NK00-0000', appt_date: today }), /không tồn tại/);
  s.saveAppointment({ appt_id: r2.appt_id, patient_id: b, appt_date: today, start_time: '10:00', duration_min: 30 });
  assert.equal(s.getAppointment(r2.appt_id).appointment.start_time, '10:00');
  s.setAppointmentStatus(r1.appt_id, 'arrived');
  assert.equal(s.getAppointment(r1.appt_id).appointment.status, 'arrived');
  assert.throws(() => s.setAppointmentStatus(r1.appt_id, 'x'), /Trạng thái/);
  assert.equal(s.getPatient(b).appointments.length, 2);
  // record the exam result of appointment r1 → linked + arrived
  s.setAppointmentStatus(r1.appt_id, 'scheduled');
  const res = s.saveVisit({ patient_id: a, visit_date: today, reason: 'Nhổ R38', from_appt_id: r1.appt_id });
  const linked = s.getAppointment(r1.appt_id).appointment;
  assert.equal(linked.result_visit_id, res);
  assert.equal(linked.status, 'arrived');
  assert.throws(() => s.saveVisit({ patient_id: b, visit_date: today, from_appt_id: r1.appt_id }), /không thuộc/);
  const dash = s.getDashboard();
  assert.equal(dash.todayAppts.find(x => x.appt_id === r1.appt_id).result_visit_id, res);
  assert.equal(dash.walkIns.length, 0);
  s.deleteAppointment(r2.appt_id);
  assert.equal(s.listAppointments(today, today).length, 2);
  assert.equal(s.getDashboard().stats.apptToday, 2);
});

test('images: lazy folder, same-day folder dedupe, register only files inside the visit folder, delete', () => {
  const { s, gas } = load();
  const p = s.savePatient({ full_name: 'Phạm D' });
  const v1 = s.saveVisit({ patient_id: p, visit_date: '2026-11-21' });
  const v2 = s.saveVisit({ patient_id: p, visit_date: '2026-11-21' });
  const c1 = s.getUploadContext(v1), c2 = s.getUploadContext(v2);
  assert.equal(c1.token, 'tok');
  assert.equal(gas.DriveApp.getFolderById(c1.folderId).getName(), '2026-11-21');
  assert.equal(gas.DriveApp.getFolderById(c2.folderId).getName(), '2026-11-21_2');
  assert.equal(s.getUploadContext(v1).folderId, c1.folderId); // stable
  const F = gas.__File;
  const f1 = new F('IMG_1.jpg', gas.DriveApp.getFolderById(c1.folderId), 'image/jpeg', '', 4_000_000);
  const stray = new F('other.jpg', gas.__root, 'image/jpeg', '', 10);
  const reg = plain(s.registerImages(v1, [{ id: f1.id, label: 'xquang' }]));
  assert.equal(reg[0].label, 'xquang');
  assert.equal(reg[0].size_bytes, 4_000_000);
  assert.equal(s.registerImages(v1, [{ id: f1.id }]).length, 0); // idempotent
  assert.throws(() => s.registerImages(v1, [{ id: stray.id }]), /không nằm trong/);
  assert.equal(s.getVisit(v1).visit.images.length, 1);
  s.setImageLabel(f1.id, 'sau');
  assert.equal(s.getVisit(v1).visit.images[0].label, 'sau');
  const thumbs = s.getThumbs([f1.id]);
  assert.ok(String(thumbs[f1.id]).startsWith('data:image/jpeg;base64,'));
  s.deleteImage(f1.id);
  assert.ok(f1.trashed);
  assert.equal(s.getVisit(v1).visit.images.length, 0);
});

test('import: preview (dry-run, no writes) → commit in batches → re-run creates no duplicates → images move', () => {
  const hdrBN = ['STT *', 'Mã BN (để trống)', 'Họ tên *', 'Ngày sinh', 'Năm sinh', 'Giới tính', 'CCCD'];
  const hdrLK = ['STT BN *', 'Họ tên (tự hiện)', 'Ngày khám *'];
  const bnRows = [['DANH SÁCH'], hdrBN,
    [1, '', 'Nguyễn Văn An', new Date(1985, 2, 12), '', 'Nam', '079085001234', 903123456, '', '', '', '', '0001_Nguyen Van An', '', 2],
    [2, '', 'Trần B', '', 1970, 'Nữ', '', '', '', '', '', '', '', '', 0]];
  const lkRows = [['NHẬT KÝ'], hdrLK,
    [1, 'Nguyễn Văn An', new Date(2019, 0, 2), 'Đau', '', '46', '', '', '', '', ''],
    [1, 'Nguyễn Văn An', new Date(2024, 4, 20), '', '', '', '', 'Làm sứ', '', new Date(2024, 4, 27), '']];
  const { s, gas, sheet } = load({ importFixture: () => [['BenhNhan', bnRows.map(r => r.slice())], ['LanKham', lkRows.map(r => r.slice())]] });

  const pv = s.importPreview('x.xlsx', Buffer.from('xlsx').toString('base64'));
  assert.equal(pv.errorCount, 0);
  assert.equal(pv.newPatients, 2);
  assert.equal(pv.newVisits, 2);
  assert.equal(sheet('Patients').getLastRow(), 1); // dry-run wrote nothing

  const c = s.importCommit(pv.runId, 0);
  assert.equal(c.done, true);
  assert.equal(c.created, 2);
  const an = plain(s.searchPatients('nguyen van an'))[0];
  assert.equal(an.patient_id, 'NK19-0001'); // year of first visit
  assert.equal(an.phone, '0903123456');
  assert.equal(an.national_id, '079085001234');
  assert.equal(plain(s.searchPatients('tran b'))[0].patient_id, `NK${yy}-0001`); // no visits → current year
  assert.equal(s.getPatient(an.patient_id).visits.length, 2);
  const imported = plain(s.listAppointments('2024-01-01', '2024-12-31'));
  assert.equal(imported.length, 1);
  assert.deepEqual([imported[0].appt_date, imported[0].start_time, imported[0].title, imported[0].status], ['2024-05-27', '', 'Làm sứ', 'arrived']);

  const pv2 = s.importPreview('x.xlsx', Buffer.from('xlsx').toString('base64'));
  assert.equal(pv2.newPatients, 0);
  assert.equal(pv2.skippedExisting, 2);
  assert.equal(s.importCommit(pv2.runId, 0).created, 0);
  assert.equal(sheet('Patients').getLastRow(), 3);

  // images
  const imp = gas.DriveApp.getFolderById(gas.PropertiesService.getScriptProperties().getProperty('IMPORT_FOLDER_ID'));
  const fA = imp.createFolder('0001_Nguyen Van An');
  const sub = fA.createFolder('2019');
  const F = gas.__File;
  const i1 = new F('a.jpg', fA, 'image/jpeg', '', 100), i2 = new F('b.png', sub, 'image/png', '', 200);
  new F('notes.pdf', fA, 'application/pdf', '', 5);
  imp.createFolder('lung_tung');
  const m = plain(s.importImagesMatch());
  assert.equal(m.matched.length, 1);
  assert.equal(m.matched[0].imageCount, 2);
  assert.equal(m.unmatched.length, 1);
  const r = s.importImagesMove(m.matched[0].folderId, an.patient_id);
  assert.equal(r.moved, 2);
  assert.equal(r.done, true);
  assert.equal(r.leftoverNonImages, true);
  assert.equal(fA.trashed, false); // PDF stays for review
  const visits = s.getPatient(an.patient_id).visits;
  const old = visits.find(v => v.source === 'import-images');
  assert.equal(old.images.length, 2);
  assert.equal(old.visit_date, '2019-01-02');
  assert.equal(i1.parent.getName(), 'Du lieu cu');
  assert.equal(i2.parent.getName(), 'Du lieu cu');
});

test('import: template errors are reported per row and block nothing silently', () => {
  const bnRows = [['x'], ['STT *', '', 'Họ tên *', '', '', '', 'CCCD'], [1, '', '', '', '', 'X'], [1, '', 'Dup']];
  const lkRows = [['x'], ['STT BN *', '', 'Ngày khám *'], [5, '', '2024-01-01']];
  const { s } = load({ importFixture: () => [['BenhNhan', bnRows], ['LanKham', lkRows]] });
  const pv = s.importPreview('x.xlsx', '');
  assert.ok(pv.errorCount >= 3);
  const wrong = load({ importFixture: () => [['BenhNhan', [['x'], ['STT *', '', 'Họ tên *', '', '', '', 'SĐT']]], ['LanKham', lkRows]] }); // old template
  assert.throws(() => wrong.s.importPreview('x.xlsx', ''), /không đúng mẫu/);
});

test('appending past the initial 1000-row grid grows the sheet', () => {
  const { s, sheet } = load();
  const p = s.savePatient({ full_name: 'Many' });
  for (let i = 0; i < 1005; i++) s.saveVisit({ patient_id: p, visit_date: '2026-01-01' });
  assert.equal(sheet('Visits').getLastRow(), 1006);
});

test('weeklyBackup keeps the newest 8 copies', () => {
  const { s, gas } = load();
  for (let i = 0; i < 10; i++) s.weeklyBackup();
  const bk = gas.DriveApp.getFolderById(gas.PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID'));
  let n = 0; const it = bk.getFiles(); while (it.hasNext()) { it.next(); n++; }
  assert.equal(n, 8);
});
