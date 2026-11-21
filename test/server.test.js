// Integration tests of src/server/*.gs against in-memory Apps Script fakes (test/gas-mock.js).
process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGas } = require('./gas-mock');

const ORDER = ['Lib', 'Repo', 'Main', 'Patients', 'Visits', 'Images', 'Import', 'Backup'];
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
  for (const t of ['Patients', 'Visits', 'Images', 'Counters', 'ImportLog']) assert.ok(sheet(t), t);
  assert.equal(sheet('Patients').getLastRow(), 1);
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
  const v1 = s.saveVisit({ patient_id: p, visit_date: '2026-01-05', cost: '800.000', paid: 500000, teeth: '46' });
  const v2 = s.saveVisit({ patient_id: p, visit_date: today, next_appointment: today, plan: 'Làm sứ' });
  const g = s.getPatient(p);
  assert.equal(g.visits.length, 2);
  assert.equal(g.visits[0].visit_id, v2); // newest first
  assert.equal(g.total_debt, 300000);
  assert.deepEqual(plain(s.searchVisitsByDate('2026-01-01', '2026-01-31')).map(v => v.visit_id), [v1]);
  const up = plain(s.getUpcomingAppointments());
  assert.equal(up.length, 1);
  assert.equal(up[0].plan, 'Làm sứ');
  assert.throws(() => s.saveVisit({ patient_id: p, visit_date: '' }), /Ngày khám/);
  assert.throws(() => s.saveVisit({ patient_id: 'NK00-9999', visit_date: today }), /không tồn tại/);
  s.deleteVisit(v1);
  assert.equal(s.getPatient(p).visits.length, 1);
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
  const hdrBN = ['STT *', 'Mã BN (để trống)', 'Họ tên *', 'Ngày sinh'];
  const hdrLK = ['STT BN *', 'Họ tên (tự hiện)', 'Ngày khám *'];
  const bnRows = [['DANH SÁCH'], hdrBN,
    [1, '', 'Nguyễn Văn An', new Date(1985, 2, 12), '', 'Nam', 903123456, '', '', '', '', '0001_Nguyen Van An', '', 2],
    [2, '', 'Trần B', '', 1970, 'Nữ', '', '', '', '', '', '', '', 0]];
  const lkRows = [['NHẬT KÝ'], hdrLK,
    [1, 'Nguyễn Văn An', new Date(2019, 0, 2), 'Đau', '', '46', '', '', '', 800000, 500000, 300000, '', ''],
    [1, 'Nguyễn Văn An', new Date(2024, 4, 20), '', '', '', '', '', '', '', '', '', new Date(2024, 4, 27), '']];
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
  assert.equal(plain(s.searchPatients('tran b'))[0].patient_id, `NK${yy}-0001`); // no visits → current year
  assert.equal(s.getPatient(an.patient_id).visits.length, 2);

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
  const bnRows = [['x'], ['STT *', '', 'Họ tên *'], [1, '', '', '', '', 'X'], [1, '', 'Dup']];
  const lkRows = [['x'], ['STT BN *', '', 'Ngày khám *'], [5, '', '2024-01-01']];
  const { s } = load({ importFixture: () => [['BenhNhan', bnRows], ['LanKham', lkRows]] });
  const pv = s.importPreview('x.xlsx', '');
  assert.ok(pv.errorCount >= 3);
  const wrong = load({ importFixture: () => [['BenhNhan', [['x'], ['Tên', '', '']]], ['LanKham', lkRows]] });
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
