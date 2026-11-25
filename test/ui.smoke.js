// UI smoke test: real client code in jsdom, google.script.run wired to the real server code on GAS fakes.
// Run: npm run test:ui   (needs devDependency jsdom)
process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { createGas } = require('./gas-mock');

const SRC = path.join(__dirname, '../src');
function loadServer(opts) {
  const gas = createGas(opts);
  const ctx = vm.createContext({ ...gas, Date, JSON, Math, Object, Array, String, Number });
  for (const f of ['Lib', 'Repo', 'Main', 'Patients', 'Visits', 'Appointments', 'Images', 'Import', 'Backup'])
    vm.runInContext(fs.readFileSync(path.join(SRC, 'server', f + '.gs'), 'utf8'), ctx);
  ctx.setup();
  ctx.__gas = gas;
  return ctx;
}

const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildHtml(bootJson = '') {
  return fs.readFileSync(path.join(SRC, 'client/Index.html'), 'utf8')
    .replace('<?= boot ?>', escHtml(bootJson)) // HtmlService escapes <?= ?> output the same way
    .replace(/<\?!= include\('client\/([\w.]+)'\); \?>/g, (_, f) => fs.readFileSync(path.join(SRC, 'client', f + '.html'), 'utf8'));
}

function boot(server, { withBoot = false, observer = null, retryDelays = null } = {}) {
  const calls = [];
  const dom = new JSDOM(buildHtml(withBoot ? server.bootPayload_() : ''), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const runner = (ok = () => {}, fail = () => {}) => new Proxy({}, {
        get: (_, fn) => {
          if (fn === 'withSuccessHandler') return h => runner(h, fail);
          if (fn === 'withFailureHandler') return h => runner(ok, h);
          return (...args) => setTimeout(() => {
            calls.push(fn);
            try { ok(JSON.parse(JSON.stringify(server[fn](...JSON.parse(JSON.stringify(args))) ?? null))); }
            catch (e) { fail(new w.Error(e.message)); }
          }, 1);
        },
      });
      w.google = { script: {
        run: runner(),
        history: { push() {}, replace() {}, setChangeHandler() {} },
        url: { getLocation: cb => cb({ hash: '' }) },
      } };
      if (observer) w.IntersectionObserver = observer;
      if (retryDelays) w.__uploadRetryDelays = retryDelays;
      w.confirm = () => true;
      w.scrollTo = () => {};
      w.fetch = () => Promise.reject(new TypeError('Failed to fetch')); // simulate CORS block → server fallback
    },
  });
  return { w: dom.window, d: dom.window.document, calls };
}

const until = async (fn, ms = 4000) => {
  const t = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await new Promise(r => setTimeout(r, 10)); }
};
const nav = (d, path) => d.querySelector(`.nav a[data-path="${path}"]:not(.brand)`).click();
const menu = async (d, label) => { d.getElementById('nav-add').click(); (await until(() => [...d.querySelectorAll('.menu-item')].find(x => x.textContent.includes(label)))).click(); };
const btn = (d, text) => [...d.querySelectorAll('button')].find(b => b.textContent.includes(text));
const set = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input')); };

test('create patient → visit with 2 original photos (server-chunk fallback) → see thumbs, allergy, no money; search', async () => {
  const server = loadServer();
  const { w, d, calls } = boot(server);
  await until(() => d.querySelector('.stat'));
  await menu(d, 'Bệnh nhân mới');
  await until(() => d.querySelector('[name=full_name]'));
  set(w, d.querySelector('[name=full_name]'), 'Nguyễn Văn An');
  set(w, d.querySelector('[name=allergies]'), 'Penicillin');
  btn(d, 'Lưu').click();
  await until(() => d.querySelector('.med-allergy') && d.querySelector('.med-allergy').textContent.includes('Penicillin'));

  btn(d, 'Ghi lần khám').click();
  await until(() => d.querySelector('[name=visit_date]'));
  assert.equal(d.querySelector('[name=cost]'), null); // no money fields
  set(w, d.querySelector('[name=diagnosis]'), 'Viêm tuỷ R46');

  const big = new w.File([new Uint8Array(5 * 1024 * 1024 + 123)], 'IMG_big.jpg', { type: 'image/jpeg' });
  const small = new w.File([new Uint8Array(1000)], 'xray.png', { type: 'image/png' });
  const input = d.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [big, small], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelectorAll('.upload-list .up').length, 2);

  btn(d, 'Lưu').click();
  await until(() => d.body.textContent.includes('Lịch sử khám (1)'), 10000);
  await until(() => d.querySelectorAll('.thumbs img').length === 2);
  assert.ok(!/nợ|Chi phí|Đã thu/.test(d.getElementById('app').textContent));
  assert.match(d.body.textContent, /Viêm tuỷ R46/);
  assert.equal(calls.filter(c => c === 'uploadChunk').length, 3, '5 MB file in two 4 MB chunks + the small file');
  const imgs = server.readActive_('Images');
  assert.equal(imgs.length, 2);
  assert.equal(Math.max(...imgs.map(i => i.size_bytes)), 5 * 1024 * 1024 + 123); // original size kept

  d.querySelector('.ph-back').click();
  const q = await until(() => d.querySelector('input.search'));
  set(w, q, 'nguyen van an');
  await until(() => [...d.querySelectorAll('.list .item b')].some(b => b.textContent === 'Nguyễn Văn An'));

  // lightbox opens with a preview
  [...d.querySelectorAll('.list .item')].find(a => a.textContent.includes('Nguyễn Văn An')).click();
  await until(() => d.querySelectorAll('.thumbs img').length === 2);
  d.querySelector('.thumb').click();
  await until(() => d.querySelector('.lightbox img[src^="data:image"]'));
  assert.match(d.querySelector('.lightbox .grow').textContent, /^1\/2 · Khám \d{2}\/\d{2}\/\d{4}/);
  btn(d, '✕').click();

  // second visit → "Hình ảnh" tab groups photos by visit, lightbox swipes across all visits
  const pid = server.readActive_('Patients')[0].patient_id;
  const v2 = server.saveVisit({ patient_id: pid, visit_date: '2025-01-10', reason: 'Khám cũ' });
  const ctx = server.getUploadContext(v2);
  const F = server.__gas.__File;
  const f = new F('old.jpg', server.__gas.DriveApp.getFolderById(ctx.folderId), 'image/jpeg', '', 50);
  server.registerImages(v2, [{ id: f.id, label: 'xquang' }]);
  // These writes bypassed this browser (like another device); the page refreshes in the background once its copy is >1 s old.
  await new Promise(r => setTimeout(r, 1100));
  d.querySelector('.ph-back').click();
  await until(() => btn(d, 'Bệnh nhân mới'));
  set(w, await until(() => d.querySelector('input.search')), 'nguyen');
  (await until(() => [...d.querySelectorAll('.list .item')].find(a => a.textContent.includes('Nguyễn Văn An')))).click();
  await until(() => d.body.textContent.includes('Lịch sử khám (2)'));
  assert.equal(d.querySelectorAll('details.visit').length, 2);
  assert.equal(d.querySelectorAll('details.visit[open]').length, 1);
  btn(d, 'Hình ảnh (3)').click();
  await until(() => d.querySelectorAll('.thumbs .thumb').length === 3);
  assert.equal(d.querySelectorAll('section.panel .thumbs').length, 2); // 2 visit groups
  btn(d, 'X-quang (1)').click();
  await until(() => d.querySelectorAll('.thumbs .thumb').length === 1);
  btn(d, 'Tất cả').click();
  await until(() => d.querySelectorAll('.thumbs .thumb').length === 3);
  [...d.querySelectorAll('.thumbs .thumb')][2].click();
  await until(() => /^3\/3 · Khám 10\/01\/2025/.test(d.querySelector('.lightbox .grow').textContent));
  w.close();
});

test('import wizard: preview shows counts, blocks on errors, commits', async () => {
  const fixture = [
    ['BenhNhan', [['x'], ['STT *', '', 'Họ tên *', '', '', '', 'CCCD'], [1, '', 'Lê Văn C', '', 1980, 'Nam', '079080000123'], [2, '', 'Võ D']]],
    ['LanKham', [['x'], ['STT BN *', '', 'Ngày khám *'], [1, 'Lê Văn C', new Date(2023, 5, 1), 'Cạo vôi']]],
  ];
  const server = loadServer({ importFixture: () => JSON.parse(JSON.stringify(fixture), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v)) });
  const { w, d } = boot(server);
  await until(() => d.querySelector('.stat'));
  await menu(d, 'Nhập dữ liệu cũ');
  const fi = await until(() => d.querySelector('input[type=file][accept=".xlsx"]'));
  Object.defineProperty(fi, 'files', { value: [new w.File([new Uint8Array(10)], 'mau.xlsx')], configurable: true });
  btn(d, 'Xem trước').click();
  const commit = await until(() => btn(d, 'Xác nhận nhập 2 bệnh nhân'));
  assert.match(d.body.textContent, /Lần khám: 1/);
  assert.equal(server.readActive_('Patients').length, 0);
  commit.click();
  await until(() => d.body.textContent.includes('Xong: tạo 2 hồ sơ'));
  assert.deepEqual(server.readActive_('Patients').map(p => p.patient_id).sort(), ['NK23-0001', 'NK' + String(new Date().getFullYear()).slice(-2) + '-0001'].sort());
  w.close();
});

test('dashboard is the landing page: stats, appointments, chart, missed appointments, search jumps to list', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const a = server.savePatient({ full_name: 'Đỗ Minh Khang', phone: '0901000001' });
  const b = server.savePatient({ full_name: 'Vũ Thu Hà' });
  server.saveVisit({ patient_id: a, visit_date: today, reason: 'Đau răng',
    appointment: { appt_date: today, start_time: '09:00', duration_min: 45, title: 'Chữa tuỷ lần 2' } });
  server.saveVisit({ patient_id: b, visit_date: today });
  const yest = server.listAppointments ? (() => { const x = new Date(Date.now() - 2 * 864e5); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; })() : '';
  server.saveAppointment({ patient_id: b, appt_date: yest, start_time: '10:00', duration_min: 30, title: 'Cạo vôi', status: 'no_show' });
  const { w, d } = boot(server);
  await until(() => d.querySelectorAll('.stat').length === 4);
  const stat = label => [...d.querySelectorAll('.stat')].find(x => x.textContent.includes(label)).querySelector('.stat-value').textContent;
  assert.equal(stat('Khám hôm nay'), '2');
  assert.equal(stat('Hẹn hôm nay'), '1');
  assert.equal(stat('Tổng bệnh nhân'), '2');
  assert.match(d.body.textContent, /\+2 mới tháng này/);
  assert.match(d.body.textContent, /Lỡ hẹn 30 ngày qua \(1\).*Vũ Thu Hà.*Cạo vôi/);
  assert.ok(!/nợ|Đã thu|\d đ\b/.test(d.getElementById('app').textContent));
  assert.match(d.querySelector('.today-card').textContent, /09:00.*Đỗ Minh Khang.*Chữa tuỷ lần 2/);
  assert.match(d.querySelector('.hero').textContent, /Bệnh nhân tiếp theo.*09:00.*Đỗ Minh Khang.*Chữa tuỷ lần 2/); // next-patient hero
  assert.equal(d.querySelectorAll('.chart .col').length, 6);
  assert.equal(d.querySelector('.chart .col-val').textContent, '2');
  d.querySelectorAll('.chart .col')[5].click();
  assert.match(d.querySelector('.chart-cap').textContent, /2 lần khám/);
  const search = d.querySelector('input.search');
  search.value = 'vu thu';
  search.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
  await until(() => [...d.querySelectorAll('.list .item b')].some(x => x.textContent === 'Vũ Thu Hà'));
  w.close();
});

test('calendar: day/week/month views, overlap layout, tap slot → new appointment, status from sheet', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const a = server.savePatient({ full_name: 'Đỗ Minh Khang' });
  const b = server.savePatient({ full_name: 'Vũ Thu Hà', allergies: 'Lidocaine' });
  server.saveAppointment({ patient_id: a, appt_date: today, start_time: '09:00', duration_min: 60, title: 'Nhổ R38' });
  server.saveAppointment({ patient_id: b, appt_date: today, start_time: '09:30', duration_min: 30 });
  server.saveAppointment({ patient_id: b, appt_date: today, title: 'Gọi xác nhận' }); // no time → all-day row
  const { w, d } = boot(server);
  await until(() => d.querySelector('.stat'));
  nav(d, 'calendar');
  await until(() => btn(d, 'Ngày'));
  btn(d, 'Ngày').click(); // jsdom window is desktop-wide → default view is week
  await until(() => d.querySelectorAll('.tg-day').length === 1 && d.querySelectorAll('.tg-col .ev').length === 2);
  assert.ok(d.querySelector('.cal-title b').textContent.endsWith(`${t.getDate()}/${t.getMonth() + 1}`));
  const evs = [...d.querySelectorAll('.tg-col .ev')];
  assert.match(evs[0].style.top, /^145px$/);                 // 09:00 → (540 − 360 min) × 0.8px + 1 (grid starts 06:00)
  assert.equal(d.querySelectorAll('.tg-hour').length, 15);   // 06:00–21:00
  assert.match(evs[0].style.width, /calc\(50% - 4px\)/);     // overlapping → side by side
  assert.equal(d.querySelectorAll('.tg-col .ev.conflict').length, 2);  // 09:00–10:00 and 09:30–10:00 overlap → warning style
  assert.match(d.querySelector('.cal-summary').textContent, /2 hẹn bị trùng giờ/);
  assert.equal(d.querySelectorAll('.tg-allday .ev').length, 1);

  evs[1].click();                                             // sheet with conflict warning, allergy, status buttons
  await until(() => d.querySelector('.sheet'));
  assert.match(d.querySelector('.sheet').textContent, /Dị ứng: Lidocaine/);
  assert.match(d.querySelector('.warn-box').textContent, /Trùng giờ với Đỗ Minh Khang \(09:00–10:00\)/);
  btn(d, 'Đã đến').click();
  await until(() => d.querySelector('.tg-col .ev.st-arrived'));

  btn(d, 'Tuần').click();
  await until(() => d.querySelectorAll('.tg-day').length === 7);
  btn(d, 'Tháng').click();
  await until(() => d.querySelectorAll('.mv-cell').length === 42);
  assert.equal(d.querySelector('.mv-cell.today').querySelectorAll('.mv-ev').length, 3);
  d.querySelector('.mv-cell.today').click();                 // month cell → day view
  await until(() => d.querySelectorAll('.tg-day').length === 1);

  // tap an empty slot at 14:00 → form prefilled; pick patient, duration, save
  const col = d.querySelector('.tg-col');
  Object.defineProperty(w.MouseEvent.prototype, 'offsetY', { configurable: true, get() { return (14 - 6) * 48 + 5; } });
  col.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await until(() => d.body.textContent.includes('Lịch hẹn mới'));
  assert.equal(d.querySelector('input[type=time]').value, '14:00');
  const ps = d.querySelector('input[type=search]');
  set(w, ps, 'khang');
  (await until(() => d.querySelector('.list .item'))).click();
  btn(d, "45'").click();
  btn(d, 'Lưu').click();
  await until(() => d.querySelectorAll('.tg-col .ev').length === 3);
  const saved = server.listAppointments(today, today).find(x => x.start_time === '14:00');
  assert.equal(saved.duration_min, 45);
  assert.equal(saved.patient_id, a);
  w.close();
});

test('patient form: portrait avatar, CCCD (unique), several phones; avatar shows in search, picker, calendar', async () => {
  const server = loadServer();
  server.savePatient({ full_name: 'Người có sẵn', national_id: '079090000001' });
  const { w, d } = boot(server);
  await until(() => d.querySelector('.stat'));
  await menu(d, 'Bệnh nhân mới');
  await until(() => d.querySelector('[name=national_id]'));
  set(w, d.querySelector('[name=full_name]'), 'Trịnh Bảo Ngọc');
  set(w, d.querySelector('[name=national_id]'), '079090000001');   // duplicate
  set(w, d.querySelector('.phones input'), '0903000111');
  btn(d, '+ Thêm số điện thoại').click();
  set(w, d.querySelectorAll('.phones input')[1], '0283 822 3344');
  const av = d.querySelector('.av-row input[type=file]');
  const png = new w.File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'chan-dung.png', { type: 'image/png' });
  Object.defineProperty(av, 'files', { value: [png], configurable: true });
  av.dispatchEvent(new w.Event('change'));
  await until(() => d.querySelector('.av-edit img'));
  btn(d, 'Lưu').click();
  await until(() => /đã thuộc hồ sơ/.test(d.getElementById('toast').textContent));
  set(w, d.querySelector('[name=national_id]'), '079 090 000 002');
  btn(d, 'Lưu').click();
  await until(() => d.querySelector('.p-head .avatar img'));
  assert.match(d.querySelector('.p-head').textContent, /CCCD 079090000002/);
  assert.match(d.querySelector('.p-head').textContent, /0903000111.*0283 822 3344/);
  const p = server.searchPatients('ngoc')[0];
  assert.ok(p.avatar_id);
  assert.equal(server.__gas.DriveApp.getFileById(p.avatar_id).getName().startsWith('avatar_'), true);

  btn(d, 'Đặt hẹn').click();                          // picker preselected with avatar
  await until(() => d.querySelector('.picked .avatar img'));
  d.querySelector('.ph-back').click();
  nav(d, 'patients');
  const q = await until(() => d.querySelector('input.search'));
  set(w, q, '000002');                                  // search by CCCD
  await until(() => d.querySelector('.list .item.row-av .avatar img'));
  w.close();
});

test('record exam result from today\'s list: prefilled form, photos, appointment marked done; walk-in', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const a = server.savePatient({ full_name: 'Đinh Gia Bảo', allergies: 'Aspirin' });
  const b = server.savePatient({ full_name: 'Lâm Mỹ Duyên' });
  const r = server.saveAppointment({ patient_id: a, appt_date: today, start_time: '08:30', duration_min: 60, title: 'Chữa tuỷ R36' });
  const { w, d } = boot(server);
  await until(() => d.querySelector('.today-card'));
  assert.match(d.querySelector('.today-card h3').textContent, /đã ghi 0\/1/);
  btn(d, 'Ghi kết quả').click();
  await until(() => d.querySelector('h1') && d.querySelector('h1').textContent === 'Ghi kết quả khám');
  assert.equal(d.querySelector('[name=reason]').value, 'Chữa tuỷ R36');
  assert.ok(!/null|undefined/.test(d.getElementById('app').textContent));
  assert.equal(d.querySelector('[name=visit_date]').value, today);
  assert.match(d.querySelector('.info').textContent, /Theo lịch hẹn .* 08:30, Chữa tuỷ R36/);
  set(w, d.querySelector('[name=diagnosis]'), 'Viêm tuỷ R36');
  const input = d.querySelector('.upload-list').parentNode.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [new w.File([new Uint8Array(3000)], 'R36.jpg', { type: 'image/jpeg' })], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  btn(d, 'Lưu').click();
  await until(() => d.querySelector('.tabs'), 8000);              // back on the patient record
  const appt = server.getAppointment(r.appt_id).appointment;
  assert.equal(appt.status, 'arrived');
  assert.ok(appt.result_visit_id);
  assert.equal(server.getVisit(appt.result_visit_id).visit.images.length, 1);

  nav(d, '');
  await until(() => d.querySelector('.today-card') && /đã ghi 1\/1/.test(d.querySelector('.today-card h3').textContent));
  assert.ok(btn(d, 'Kết quả'));

  btn(d, 'Khám không hẹn').click();                           // walk-in
  const q = await until(() => d.querySelector('input[type=search]'));
  set(w, q, 'duyen');
  (await until(() => d.querySelector('.list .item'))).click();
  await until(() => d.querySelector('h1') && d.querySelector('h1').textContent === 'Lần khám mới');
  assert.ok(!/null|undefined/.test(d.getElementById('app').textContent)); // patient without allergy: no stray "null"
  set(w, d.querySelector('[name=reason]'), 'Ê buốt');
  btn(d, 'Lưu').click();
  await until(() => d.querySelector('.tabs'));
  nav(d, '');
  await until(() => d.querySelector('.today-card') && /Không hẹn.*Lâm Mỹ Duyên.*Ê buốt/.test(d.querySelector('.today-card').textContent));
  w.close();
});

test('calendar editing: drag to move, drag edge to resize, quick reschedule in sheet, undo; conflicts clear', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const a = server.savePatient({ full_name: 'Đỗ Minh Khang' });
  const b = server.savePatient({ full_name: 'Vũ Thu Hà' });
  const ra = server.saveAppointment({ patient_id: a, appt_date: today, start_time: '09:00', duration_min: 60 });
  const rb = server.saveAppointment({ patient_id: b, appt_date: today, start_time: '09:30', duration_min: 30 });
  const { w, d } = boot(server);
  await until(() => d.querySelector('.stat'));
  nav(d, 'calendar');
  await until(() => btn(d, 'Ngày'));
  btn(d, 'Ngày').click();
  await until(() => d.querySelectorAll('.tg-col .ev.conflict').length === 2);
  const ptr = (el, type, x, y) => { const e = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' }); Object.defineProperty(e, 'pointerId', { value: 1 }); el.dispatchEvent(e); };
  const evOf = name => [...d.querySelectorAll('.tg-col .ev')].find(x => x.textContent.includes(name));

  // move Vũ Thu Hà down 48px (= 60 min): 09:30 → 10:30
  let ev = evOf('Vũ Thu Hà');
  ptr(ev, 'pointerdown', 50, 100); ptr(ev, 'pointermove', 50, 120); ptr(ev, 'pointermove', 50, 148);
  assert.match(ev.querySelector('.drag-label').textContent, /10:30–11:00/);
  ptr(ev, 'pointerup', 50, 148);
  await until(() => server.getAppointment(rb.appt_id).appointment.start_time === '10:30');
  await until(() => d.querySelectorAll('.tg-col .ev.conflict').length === 0 && /Đã dời Vũ Thu Hà/.test(d.getElementById('toast').textContent));
  assert.match(d.querySelector('.cal-summary').textContent, /Không trùng giờ/);

  // resize Đỗ Minh Khang by dragging the bottom edge +72px (= 90 min): 60' → 150' → overlaps again
  ev = evOf('Đỗ Minh Khang');
  const handle = ev.querySelector('.ev-resize');
  ptr(handle, 'pointerdown', 50, 200); ptr(ev, 'pointermove', 50, 230); ptr(ev, 'pointermove', 50, 272); ptr(ev, 'pointerup', 50, 272);
  await until(() => server.getAppointment(ra.appt_id).appointment.duration_min === 150);
  await until(() => d.querySelectorAll('.tg-col .ev.conflict').length === 2 && d.getElementById('toast').classList.contains('warn'));
  assert.match(d.getElementById('toast').textContent, /trùng giờ với Vũ Thu Hà/);

  // undo from the toast
  d.querySelector('.toast-act').click();
  await until(() => server.getAppointment(ra.appt_id).appointment.duration_min === 60);

  // quick reschedule inside the sheet (no page change)
  await until(() => evOf('Vũ Thu Hà'));
  evOf('Vũ Thu Hà').click();
  await until(() => d.querySelector('.sheet'));
  btn(d, 'Đổi giờ').click();
  const qt = d.querySelector('.quick-edit input[type=time]');
  qt.value = '14:00';
  btn(d, '45\'').click();
  btn(d, 'Lưu giờ mới').click();
  await until(() => server.getAppointment(rb.appt_id).appointment.start_time === '14:00');
  assert.equal(server.getAppointment(rb.appt_id).appointment.duration_min, 45);
  assert.equal(d.querySelector('.cal-title b').textContent.length > 0, true); // still on the calendar
  w.close();
});

test('book an appointment for a patient not in the database: placeholder record, phone dedupe, complete later', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const old = server.savePatient({ full_name: 'Phan Thị Có', phone: '0909123456' });
  const { w, d } = boot(server);
  await until(() => d.querySelector('.stat'));
  await menu(d, 'Lịch hẹn');
  await until(() => d.querySelector('#app').textContent.includes('Lịch hẹn mới') && d.querySelector('input[type=search]'));
  set(w, d.querySelector('input[type=search]'), 'Cao Tuấn');
  (await until(() => btn(d, 'Bệnh nhân mới:'))).click();
  const [name, phone] = await until(() => { const x = d.querySelectorAll('.new-pt input'); return x.length === 2 && x; });
  assert.equal(name.value, 'Cao Tuấn');
  set(w, phone, '0988 777 666');
  d.querySelector('input[type=time]').value = '10:00'; d.querySelector('input[type=time]').dispatchEvent(new w.Event('input'));
  btn(d, "60'").click();
  btn(d, 'Lưu').click();
  await until(() => d.getElementById('toast').textContent.includes('Tạo hồ sơ tạm'));
  const appt = server.listAppointments(today, today).find(x => x.start_time === '10:00');
  assert.equal(appt.info_pending, '1');
  const pid = appt.patient_id;

  // existing phone → app offers the existing record
  await menu(d, 'Lịch hẹn');
  await until(() => d.querySelector('#app').textContent.includes('Lịch hẹn mới') && d.querySelector('input[type=search]'));
  set(w, d.querySelector('input[type=search]'), 'Có');
  (await until(() => btn(d, 'Bệnh nhân mới:'))).click();
  set(w, (await until(() => d.querySelectorAll('.new-pt input')[1])), '0909 123 456');
  (await until(() => btn(d, 'Dùng hồ sơ này'))).click();
  await until(() => d.querySelector('.picked') && d.querySelector('.picked').textContent.includes(old));

  // patient page shows the placeholder note; "Bổ sung" opens the form and saving clears it
  w.eval(`go('p/${pid}')`);
  await until(() => d.querySelector('.med-pending'));
  d.querySelector('.med-pending .link-btn').click();
  await until(() => d.querySelector('#app').textContent.includes('Hồ sơ tạo nhanh khi đặt hẹn'));
  btn(d, 'Lưu').click();
  await until(() => server.getPatient(pid).patient.info_pending === '');
  w.close();
});

test('book with no patient info at all → saved under "Bệnh nhân mới"', async () => {
  const server = loadServer();
  const { d } = boot(server);
  await until(() => d.querySelector('.stat'));
  await menu(d, 'Lịch hẹn');
  await until(() => d.querySelector('#app').textContent.includes('Lịch hẹn mới') && d.querySelector('input[type=search]'));
  btn(d, 'Lưu').click();
  await until(() => d.getElementById('toast').textContent.includes('Tạo hồ sơ tạm'));
  const p = server.searchPatients('Bệnh nhân mới')[0];
  assert.equal(p.full_name, 'Bệnh nhân mới');
  assert.equal(p.info_pending, '1');
});

test('fast paths: boot data shows Hôm nay without a call; revisits come from memory; failed drag is rolled back', async () => {
  const server = loadServer();
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(); const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const pid = server.savePatient({ full_name: 'Lê Nhanh', phone: '0911222333' });
  const r = server.saveAppointment({ patient_id: pid, appt_date: today, start_time: '09:00', duration_min: 30, title: 'Kiểm tra' });
  const { w, d, calls } = boot(server, { withBoot: true });
  await until(() => d.querySelector('.stat'));
  assert.ok(!calls.includes('getDashboard'), 'dashboard came from the page itself');
  assert.ok(!calls.includes('getStorageQuota'), 'quota came from the page itself');
  await until(() => calls.includes('listAppointments') && calls.includes('searchPatients')); // prefetched in the background

  // calendar opens from the prefetched data
  const before = calls.length;
  d.querySelector('nav a[data-path="calendar"]').click();
  await until(() => d.querySelector('.mv'));
  assert.equal(calls.slice(before).filter(c => c === 'listAppointments').length <= 3, true); // only neighbour prefetch/refresh, no blocking load

  // drag that saves: calendar and server agree
  w.eval(`calState.view = 'day'; calState.date = '${today}';`);
  w.eval('pageCalendar()');
  await until(() => d.querySelector('.ev'));
  const mv = (from, to) => w.eval(`moveAppointment(calAppts.find(x => x.appt_id === '${r.appt_id}'), { appt_date: '${today}', start_time: '${to}', duration_min: 30 }, { appt_date: '${today}', start_time: '${from}', duration_min: 30 })`);
  mv('09:00', '07:00');
  await until(() => d.getElementById('toast').textContent.includes('Đã dời'));
  assert.equal(server.getAppointment(r.appt_id).appointment.start_time, '07:00');
  assert.ok(d.querySelector('.ev').textContent.includes('07:00'));
  // drag that fails on the server: put back where it was, with a message
  const realSave = server.saveAppointment;
  server.saveAppointment = () => { throw new Error('Mất kết nối'); };
  mv('07:00', '08:00');
  await until(() => d.getElementById('toast').textContent.includes('Chưa lưu được'));
  assert.ok(d.querySelector('.ev').textContent.includes('07:00'));
  server.saveAppointment = realSave;
  assert.equal(server.getAppointment(r.appt_id).appointment.start_time, '07:00');
  w.close();
});

test('thumbnails load lazily: only photos near the screen are requested', async () => {
  const server = loadServer();
  const pid = server.savePatient({ full_name: 'Ảnh Nhiều' });
  const F = server.__gas.__File;
  const visitIds = [];
  for (let k = 0; k < 3; k++) {
    const v = server.saveVisit({ patient_id: pid, visit_date: `2025-0${k + 1}-10`, reason: 'Khám ' + k });
    const ctx = server.getUploadContext(v);
    const files = [0, 1].map(n => new F(`a${k}${n}.jpg`, server.__gas.DriveApp.getFolderById(ctx.folderId), 'image/jpeg', '', 10));
    server.registerImages(v, files.map(f => ({ id: f.id, label: 'khac' })));
    visitIds.push(v);
  }
  const observed = [];
  let fire;
  class FakeIO { constructor(cb) { fire = els => cb(els.map(target => ({ isIntersecting: true, target }))); } observe(el) { observed.push(el); } unobserve() {} }
  const { w, d, calls } = boot(server, { observer: FakeIO });
  await until(() => d.querySelector('.stat'));
  w.eval(`go('p/${pid}')`);
  await until(() => d.querySelectorAll('details.visit').length === 3);
  await new Promise(r => setTimeout(r, 120));
  assert.equal(calls.filter(c => c === 'getThumbs').length, 0, 'nothing requested before it is on screen');
  assert.equal(observed.length, 2, 'only the open (latest) visit is watched');
  fire(observed.slice());
  await until(() => d.querySelectorAll('.thumbs img').length === 2);
  assert.equal(calls.filter(c => c === 'getThumbs').length, 1, 'one batched request');
  w.close();
});

test('large photo on a dropping connection: resumes from where it stopped, never restarts', async () => {
  const server = loadServer();
  const pid = server.savePatient({ full_name: 'Mạng Yếu' });
  const vid = server.saveVisit({ patient_id: pid, visit_date: '2025-02-01', reason: 'Chụp phim' });
  const sent = [];                // start offsets of pieces that reached Drive
  let failNext = 0;               // simulate dropped connections
  const realChunk = server.uploadChunk;
  const { w, d } = boot(server, { retryDelays: [5, 5] });
  await until(() => d.querySelector('.stat'));
  w.eval(`go('v/${vid}')`);
  const input = await until(() => d.querySelector('input[type=file]'));
  const MB = 1024 * 1024;
  const big = new w.File([new Uint8Array(13 * MB)], 'pano.jpg', { type: 'image/jpeg' }); // 4 pieces of 4 MB
  // 1) one drop after the first piece → retried automatically, carries on
  let calls = 0;
  server.uploadChunk = (uri, b64, start, total) => {
    calls++;
    if (calls === 2 && failNext === 0) { failNext = -1; throw new Error('NetworkError: connection lost'); }
    if (failNext > 0) { failNext--; throw new Error('NetworkError: connection lost'); }
    sent.push(start);
    return realChunk(uri, b64, start, total);
  };
  Object.defineProperty(input, 'files', { value: [big], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await until(() => d.querySelector('.up.done'), 8000);
  assert.deepEqual(sent, [0, 4 * MB, 8 * MB, 12 * MB], 'each piece sent once; the dropped one resent, nothing from 0 again');

  // 2) long outage: retries run out → "Dừng ở 31%", then "Tải tiếp ảnh lỗi" continues from there
  sent.length = 0; calls = 0;
  server.uploadChunk = (uri, b64, start, total) => {
    calls++;
    if (calls >= 2 && failNext !== -2) throw new Error('NetworkError: connection lost');
    sent.push(start);
    return realChunk(uri, b64, start, total);
  };
  const big2 = new w.File([new Uint8Array(13 * MB)], 'pano2.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [big2], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await until(() => d.querySelector('.up.error'), 8000);
  assert.match(d.querySelector('.up.error').textContent, /Dừng ở 31%/);
  failNext = -2;                  // network back
  btn(d, 'Tải tiếp ảnh lỗi').click();
  await until(() => d.querySelectorAll('.up.done').length === 2, 8000);
  assert.deepEqual(sent, [0, 4 * MB, 8 * MB, 12 * MB], 'resumed at 4 MB, did not restart');
  const imgs = server.getVisit(vid).visit.images;
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every(i => Number(i.size_bytes) === 13 * MB), 'originals complete');
  w.close();
});
