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

function buildHtml() {
  return fs.readFileSync(path.join(SRC, 'client/Index.html'), 'utf8')
    .replace(/<\?!= include\('client\/([\w.]+)'\); \?>/g, (_, f) => fs.readFileSync(path.join(SRC, 'client', f + '.html'), 'utf8'));
}

function boot(server) {
  const calls = [];
  const dom = new JSDOM(buildHtml(), {
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
const btn = (d, text) => [...d.querySelectorAll('button')].find(b => b.textContent.includes(text));
const set = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input')); };

test('create patient → visit with 2 original photos (server-chunk fallback) → see thumbs, allergy, no money; search', async () => {
  const server = loadServer();
  const { w, d, calls } = boot(server);
  await until(() => btn(d, '+ Bệnh nhân'));
  await until(() => d.body.textContent.includes('Tổng bệnh nhân'));

  btn(d, '+ Bệnh nhân').click();
  await until(() => d.querySelector('[name=full_name]'));
  set(w, d.querySelector('[name=full_name]'), 'Nguyễn Văn An');
  set(w, d.querySelector('[name=allergies]'), 'Penicillin');
  btn(d, 'Lưu').click();
  await until(() => d.querySelector('.alert') && d.querySelector('.alert').textContent.includes('Penicillin'));

  btn(d, '+ Lần khám').click();
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
  assert.ok(calls.filter(c => c === 'uploadChunk').length >= 4, 'big file sent in 2 MB chunks');
  const imgs = server.readActive_('Images');
  assert.equal(imgs.length, 2);
  assert.equal(Math.max(...imgs.map(i => i.size_bytes)), 5 * 1024 * 1024 + 123); // original size kept

  btn(d, 'Danh sách').click();
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
  btn(d, 'Danh sách').click();
  await until(() => btn(d, '+ Bệnh nhân'));
  set(w, await until(() => d.querySelector('input.search')), 'nguyen');
  (await until(() => [...d.querySelectorAll('.list .item')].find(a => a.textContent.includes('Nguyễn Văn An')))).click();
  await until(() => d.body.textContent.includes('Lịch sử khám (2)'));
  assert.equal(d.querySelectorAll('details.visit').length, 2);
  assert.equal(d.querySelectorAll('details.visit[open]').length, 1);
  btn(d, 'Hình ảnh (3)').click();
  await until(() => d.querySelectorAll('.thumbs .thumb').length === 3);
  assert.equal(d.querySelectorAll('section.card .thumbs').length, 2); // 2 visit groups
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
  await until(() => btn(d, 'Nhập dữ liệu cũ'));
  btn(d, 'Nhập dữ liệu cũ').click();
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
  assert.match(d.body.textContent, /Hôm nay09:00 Đỗ Minh Khang.*45 phút · Chữa tuỷ lần 2/);
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
  [...d.querySelectorAll('.topbar nav a')].find(x => x.textContent === 'Lịch hẹn').click();
  await until(() => btn(d, 'Ngày'));
  btn(d, 'Ngày').click(); // jsdom window is desktop-wide → default view is week
  await until(() => d.querySelectorAll('.tg-day').length === 1 && d.querySelectorAll('.tg-col .ev').length === 2);
  assert.ok(d.querySelector('.cal-title').textContent.includes(today.split('-').reverse().join('/')));
  const evs = [...d.querySelectorAll('.tg-col .ev')];
  assert.match(evs[0].style.top, /^433px$/);                 // 09:00 → 540 min × 0.8px + 1
  assert.match(evs[0].style.width, /calc\(50% - 3px\)/);     // overlapping → side by side
  assert.equal(d.querySelectorAll('.tg-allday .ev').length, 1);

  evs[1].click();                                             // sheet with allergy + status buttons
  await until(() => d.querySelector('.sheet'));
  assert.match(d.querySelector('.sheet').textContent, /Dị ứng: Lidocaine/);
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
  Object.defineProperty(w.MouseEvent.prototype, 'offsetY', { configurable: true, get() { return 14 * 48 + 5; } });
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
  await until(() => btn(d, '+ Bệnh nhân'));
  btn(d, '+ Bệnh nhân').click();
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
  assert.match(d.querySelector('.p-head').textContent, /0903000111 · 0283 822 3344/);
  const p = server.searchPatients('ngoc')[0];
  assert.ok(p.avatar_id);
  assert.equal(server.__gas.DriveApp.getFileById(p.avatar_id).getName().startsWith('avatar_'), true);

  btn(d, '+ Lịch hẹn').click();                       // picker preselected with avatar
  await until(() => d.querySelector('.picked .avatar img'));
  btn(d, 'Lịch hẹn').click();
  [...d.querySelectorAll('.topbar nav a')].find(x => x.textContent === 'Bệnh nhân').click();
  const q = await until(() => d.querySelector('input.search'));
  set(w, q, '000002');                                  // search by CCCD
  await until(() => d.querySelector('.list .item.row-av .avatar img'));
  w.close();
});
