// Browser-only demo shim: fake google.script.* backed by the REAL server code running on the GAS fakes.
// All data is fictional and lives in memory (reload = reset).
(function () {
  const pad = n => String(n).padStart(2, '0');
  const day = off => { const d = new Date(Date.now() + off * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const fixture = () => [
    ['BenhNhan', [['DANH SÁCH'], ['STT *', 'Mã BN (để trống)', 'Họ tên *', 'Ngày sinh'],
      [6, '', 'Đặng Văn Khoa', new Date(1979, 6, 2), '', 'Nam', 912345678, 'Q.3, TP.HCM', '', '', '', '0006_Dang Van Khoa', ''],
      [7, '', 'Bùi Ngọc Lan', '', 1992, 'Nữ', '0938000111', '', 'Lidocaine', '', '', '', '']]],
    ['LanKham', [['NHẬT KÝ'], ['STT BN *', 'Họ tên (tự hiện)', 'Ngày khám *'],
      [6, '', new Date(2022, 2, 14), 'Răng khôn mọc lệch', 'R38 mọc lệch gần', '38', 'Nhổ R38', '', 'Amoxicillin 500mg', 1500000, 1500000, '', '', ''],
      [7, '', new Date(2024, 8, 9), 'Cạo vôi định kỳ', 'Viêm nướu nhẹ', '', 'Cạo vôi, đánh bóng', 'Tái khám 6 tháng', '', 300000, 300000, '', '', '']]],
  ];
  const gas = createGas({ importFixture: fixture });
  const S = window.__SERVER(gas);
  S.setup();

  const colors = ['#e3f2f1', '#fdecea', '#e8eaf6', '#fff8e1', '#e8f5e9'];
  const svg = (title, i) => new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
    `<rect width="800" height="600" fill="${colors[i % colors.length]}"/>` +
    `<path d="M330 170c-60 0-90 50-80 120 8 55 30 90 40 160 6 40 40 45 50 5 10-40 15-80 60-80s50 40 60 80c10 40 44 35 50-5 10-70 32-105 40-160 10-70-20-120-80-120-30 0-45 15-70 15s-40-15-70-15z" fill="#fff" stroke="#0b6e6e" stroke-width="8"/>` +
    `<text x="400" y="560" font-family="Arial" font-size="34" text-anchor="middle" fill="#0b6e6e">${title}</text></svg>`);
  const addImages = (visitId, names) => {
    const ctx = S.getUploadContext(visitId);
    const folder = gas.DriveApp.getFolderById(ctx.folderId);
    const files = names.map(([n, label], i) => ({ id: new gas.__File(n, folder, 'image/svg+xml', '', undefined, svg(n, i)).id, label }));
    S.registerImages(visitId, files);
  };

  const an = S.savePatient({ full_name: 'Nguyễn Văn An', dob: '1985-03-12', gender: 'Nam', phone: '0903123456', address: '12 Lê Lợi, P. Bến Thành, TP.HCM',
    allergies: 'Penicillin', systemic_diseases: 'Cao huyết áp', current_meds: 'Amlodipine 5mg' });
  let v = S.saveVisit({ patient_id: an, visit_date: day(-40), reason: 'Đau răng hàm dưới phải', diagnosis: 'Viêm tuỷ không hồi phục R46', teeth: '46',
    treatment: 'Lấy tuỷ, trám tạm', plan: 'Chữa tuỷ lần 2, làm sứ', prescription: 'Clindamycin 300mg x 15v (dị ứng Penicillin)', cost: 1200000, paid: 1200000 });
  addImages(v, [['xquang-R46-truoc.jpg', 'xquang'], ['R46-truoc.jpg', 'truoc']]);
  v = S.saveVisit({ patient_id: an, visit_date: day(-7), reason: 'Chữa tuỷ lần 2', diagnosis: 'R46 sau lấy tuỷ', teeth: '46',
    treatment: 'Trám bít ống tuỷ', plan: 'Lắp mão sứ', cost: 3500000, paid: 2000000, next_appointment: day(2) });
  addImages(v, [['xquang-R46-sau.jpg', 'xquang'], ['R46-sau.jpg', 'sau'], ['mau-su.jpg', 'khac']]);

  const binh = S.savePatient({ full_name: 'Trần Thị Bình', birth_year: 1990, gender: 'Nữ', phone: '0938123456' });
  v = S.saveVisit({ patient_id: binh, visit_date: day(-1), reason: 'Niềng răng — kiểm tra định kỳ', diagnosis: 'Sai khớp cắn loại II',
    treatment: 'Thay dây cung', plan: 'Tái khám 4 tuần', cost: 500000, paid: 500000, next_appointment: day(5) });
  addImages(v, [['mat-nhai-tren.jpg', 'khac'], ['mat-nhai-duoi.jpg', 'khac']]);

  const minh = S.savePatient({ full_name: 'Lê Hoàng Minh', dob: '2015-09-01', gender: 'Nam', phone: '0909555777', notes: 'Bé sợ khoan, cần trấn an' });
  S.saveVisit({ patient_id: minh, visit_date: day(0), reason: 'Sâu răng sữa', diagnosis: 'Sâu R75', teeth: '75', treatment: 'Trám GIC', cost: 300000, paid: 300000 });

  S.savePatient({ full_name: 'Phạm Thu Hà', birth_year: 1968, gender: 'Nữ', phone: '0918222333', systemic_diseases: 'Tiểu đường type 2' });

  // Old photo folders waiting in _import (1 matches after importing the sample Excel, 1 does not)
  const imp = gas.DriveApp.getFolderById(gas.PropertiesService.getScriptProperties().getProperty('IMPORT_FOLDER_ID'));
  const fk = imp.createFolder('0006_Dang Van Khoa');
  ['khoa-2022-1.jpg', 'khoa-2022-2.jpg'].forEach((n, i) => new gas.__File(n, fk, 'image/svg+xml', '', undefined, svg(n, i)));
  const fx = imp.createFolder('anh_chua_ro_ten');
  new gas.__File('scan-01.jpg', fx, 'image/svg+xml', '', undefined, svg('scan-01.jpg', 3));

  // ---- google.script.* fakes ----
  const runner = (ok = () => {}, fail = () => {}) => new Proxy({}, {
    get: (_, fn) => {
      if (fn === 'withSuccessHandler') return h => runner(h, fail);
      if (fn === 'withFailureHandler') return h => runner(ok, h);
      return (...args) => setTimeout(() => {
        try {
          if (typeof S[fn] !== 'function') throw new Error('Không có hàm ' + String(fn));
          const r = S[fn](...JSON.parse(JSON.stringify(args)));
          ok(r === undefined ? null : JSON.parse(JSON.stringify(r)));
        } catch (e) { fail(new Error(e.message)); }
      }, 120);
    },
  });
  let changeHandler = () => {};
  const stack = [];
  window.google = { script: {
    run: runner(),
    history: {
      push: s => stack.push(s), replace: s => { stack[stack.length - 1] = s; },
      setChangeHandler: f => { changeHandler = f; },
    },
    url: { getLocation: cb => cb({ hash: '' }) },
  } };
  window.demoBack = () => { stack.pop(); changeHandler({ state: stack[stack.length - 1] || { path: '' } }); };
  // Sandbox blocks confirm(); in the demo every confirmation is accepted.
  window.confirm = () => true;
  // Real app uploads straight to Drive first; the demo has no network, so force the server-chunk path.
  const realFetch = window.fetch;
  window.fetch = (url, o) => String(url).startsWith('https://www.googleapis.com/') ? Promise.reject(new TypeError('demo: no network')) : realFetch(url, o);
})();
