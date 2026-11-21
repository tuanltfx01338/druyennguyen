// Browser-only demo shim: fake google.script.* backed by the REAL server code running on the GAS fakes.
// All data is fictional and lives in memory (reload = reset).
(function () {
  const pad = n => String(n).padStart(2, '0');
  const day = off => { const d = new Date(Date.now() + off * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const fixture = () => [
    ['BenhNhan', [['DANH SÁCH'], ['STT *', 'Mã BN (để trống)', 'Họ tên *', 'Ngày sinh', 'Năm sinh', 'Giới tính', 'CCCD', 'SĐT'],
      [6, '', 'Đặng Văn Khoa', new Date(1979, 6, 2), '', 'Nam', '079079123456', 912345678, 'Q.3, TP.HCM', '', '', '', '0006_Dang Van Khoa', ''],
      [7, '', 'Bùi Ngọc Lan', '', 1992, 'Nữ', '079192654321', '0938000111, 0908000222', '', 'Lidocaine', '', '', '', '']]],
    ['LanKham', [['NHẬT KÝ'], ['STT BN *', 'Họ tên (tự hiện)', 'Ngày khám *'],
      [6, '', new Date(2022, 2, 14), 'Răng khôn mọc lệch', 'R38 mọc lệch gần', '38', 'Nhổ R38', '', 'Amoxicillin 500mg', '', ''],
      [7, '', new Date(2024, 8, 9), 'Cạo vôi định kỳ', 'Viêm nướu nhẹ', '', 'Cạo vôi, đánh bóng', 'Tái khám 6 tháng', '', new Date(2025, 2, 9), '']]],
  ];
  const gas = createGas({ importFixture: fixture });
  const S = window.__SERVER(gas);
  S.setup();

  // ---------- fictional dataset (deterministic) ----------
  let seed = 20261121;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const chance = p => rnd() < p;
  const thisYear = new Date().getFullYear();
  const dateOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const colors = ['#e3f2f1', '#fdecea', '#e8eaf6', '#fff8e1', '#e8f5e9'];
  const toothPath = 'M330 170c-60 0-90 50-80 120 8 55 30 90 40 160 6 40 40 45 50 5 10-40 15-80 60-80s50 40 60 80c10 40 44 35 50-5 10-70 32-105 40-160 10-70-20-120-80-120-30 0-45 15-70 15s-40-15-70-15z';
  const svg = (title, i, label) => new TextEncoder().encode(label === 'xquang'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#111"/>` +
      `<path d="${toothPath}" fill="#cfd8dc" opacity=".85" transform="translate(${(i % 3) * 30 - 30} 0)"/><path d="M380 260v190M420 260v190" stroke="#fff" stroke-width="6" opacity=".6"/>` +
      `<text x="400" y="560" font-family="Arial" font-size="30" text-anchor="middle" fill="#90a4ae">X-QUANG · ${title}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="${colors[i % colors.length]}"/>` +
      `<path d="${toothPath}" fill="${label === 'truoc' ? '#f3e5ab' : '#fff'}" stroke="#0b6e6e" stroke-width="8"/>` +
      `<text x="400" y="560" font-family="Arial" font-size="30" text-anchor="middle" fill="#0b6e6e">${title}</text></svg>`);
  let imgNo = 0;
  const addImages = (visitId, specs) => {
    if (!specs.length) return;
    const ctx = S.getUploadContext(visitId);
    const folder = gas.DriveApp.getFolderById(ctx.folderId);
    const files = specs.map(([n, label]) => {
      const bytes = svg(n, imgNo++, label);
      const f = new gas.__File(n, folder, 'image/svg+xml', '', 2_000_000 + Math.floor(rnd() * 3_000_000), bytes);
      f.bytes = bytes;
      return { id: f.id, label };
    });
    S.registerImages(visitId, files);
  };
  // Fictional portrait: head-and-shoulders silhouette on a soft background.
  const BG = ['#cfe8e5', '#d7dcf2', '#f2e0d5', '#d9ecd0', '#f3d9df', '#e5e0f0'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c98e66', '#f5d6bc'];
  const HAIR = ['#2b2118', '#3d2b1f', '#1c1c1c', '#5a3e2b', '#8d8d8d'];
  const portrait = (female, i) => new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${BG[i % BG.length]}"/>` +
    `<path d="M60 400c10-90 70-130 140-130s130 40 140 130z" fill="${['#00897b', '#5c6bc0', '#8d6e63', '#455a64'][i % 4]}"/>` +
    `<rect x="172" y="230" width="56" height="50" fill="${SKIN[i % SKIN.length]}"/>` +
    (female ? `<path d="M110 200c0-90 40-130 90-130s90 40 90 130v80h-40v-90H150v90h-40z" fill="${HAIR[i % HAIR.length]}"/>` : '') +
    `<ellipse cx="200" cy="170" rx="62" ry="74" fill="${SKIN[i % SKIN.length]}"/>` +
    `<path d="M138 150c0-50 30-72 62-72s62 22 62 72c-20-22-40-28-62-28s-42 6-62 28z" fill="${HAIR[i % HAIR.length]}"/>` +
    `<circle cx="178" cy="172" r="5" fill="#333"/><circle cx="222" cy="172" r="5" fill="#333"/><path d="M182 205q18 12 36 0" stroke="#a0522d" stroke-width="4" fill="none"/></svg>`);
  let pNo = 0;
  const cccd = (by, female) => '079' + (by >= 2000 ? (female ? 3 : 2) : (female ? 1 : 0)) + String(by).slice(-2) + String(100000 + Math.floor(rnd() * 899999));

  // Patient created "in" a given year → code NKyy-nnnn of that year (as the real app would have produced then).
  const addPatient = (d, year) => {
    const id = S.reserveIds_(year, 1)[0];
    S.appendRows_('Patients', [Object.assign({ gender: '', phone: '', address: '', allergies: '', systemic_diseases: '', current_meds: '', notes: '', dob: '' }, d, {
      patient_id: id, name_search: S.normalizeText(d.full_name), birth_year: d.dob ? Number(d.dob.slice(0, 4)) : (d.birth_year || ''),
      folder_id: S.createPatientFolder_(id, d.full_name).getId(), created_at: d.created_at || `${year}-${pad(1 + Math.floor(rnd() * (year === thisYear ? new Date().getMonth() + 1 : 12)))}-01 09:00:00`, updated_at: S.now_(), deleted: false })]);
    if (d.photo === true || chance(0.75)) {
      const ctx = S.getAvatarUploadContext(id);
      const f = new gas.__File(`avatar_${id}.svg`, gas.DriveApp.getFolderById(ctx.folderId), 'image/svg+xml', '', undefined, portrait(d.gender === 'Nữ', pNo++));
      S.setPatientAvatar(id, f.id);
    }
    return id;
  };

  const FDI = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47];
  const PROCS = [
    t => ({ reason: 'Cạo vôi định kỳ', diagnosis: 'Viêm nướu nhẹ, vôi răng độ 2', treatment: 'Cạo vôi, đánh bóng', plan: 'Tái khám 6 tháng', imgs: [] }),
    t => ({ reason: 'Ê buốt khi ăn ngọt', diagnosis: `Sâu ngà R${t}`, teeth: String(t), treatment: `Trám composite R${t}`, imgs: ['truoc', 'sau'] }),
    t => ({ reason: 'Đau nhức về đêm', diagnosis: `Viêm tuỷ không hồi phục R${t}`, teeth: String(t), treatment: `Lấy tuỷ R${t}, trám tạm`, plan: 'Chữa tuỷ lần 2', prescription: 'Paracetamol 500mg x 10v', imgs: ['xquang'] }),
    t => { const k = pick([38, 48]); return { reason: 'Răng khôn mọc lệch', diagnosis: `R${k} mọc lệch gần, viêm lợi trùm`, teeth: String(k), treatment: `Tiểu phẫu nhổ R${k}`, plan: 'Cắt chỉ sau 7 ngày', prescription: 'Amoxicillin 500mg x 15v; Paracetamol 500mg x 10v', imgs: ['xquang', 'khac'] }; },
    t => ({ reason: 'Mất răng, muốn trồng lại', diagnosis: `Mất R${t}`, teeth: String(t), treatment: `Cấy implant R${t} giai đoạn 1`, plan: 'Gắn mão sau 3 tháng', prescription: 'Amoxicillin 500mg x 15v', imgs: ['xquang', 'truoc'] }),
    t => ({ reason: 'Răng ố vàng', diagnosis: 'Nhiễm màu ngoại sinh', treatment: 'Tẩy trắng tại phòng khám', imgs: ['truoc', 'sau'] }),
    t => ({ reason: 'Niềng răng — tái khám', diagnosis: 'Sai khớp cắn loại II', treatment: 'Thay dây cung, chỉnh thun', plan: 'Tái khám 4 tuần', imgs: ['khac', 'khac'] }),
    t => ({ reason: 'Bọc răng sứ', diagnosis: `R${t} vỡ lớn sau chữa tuỷ`, teeth: String(t), treatment: 'Mài cùi, lấy dấu, gắn sứ tạm', plan: 'Gắn sứ chính thức sau 5 ngày', imgs: ['truoc', 'sau', 'xquang'] }),
  ];
  const KID_PROC = () => { const t = pick([54, 55, 64, 65, 74, 75, 84, 85]); return { reason: 'Sâu răng sữa', diagnosis: `Sâu R${t}`, teeth: String(t), treatment: 'Trám GIC', imgs: ['truoc'] }; };

  const DUR = [15, 30, 30, 45, 60, 60, 90, 120];
  const randTime = () => minToT(8 * 60 + 15 * Math.floor(rnd() * 44)); // 08:00–18:45
  const minToT = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const addVisit = (pid, date, proc, opts = {}) => {
    const next = opts.next_appointment;
    delete opts.next_appointment;
    const appointment = next ? { appt_date: next, start_time: opts.next_time || randTime(), duration_min: opts.next_dur || pick(DUR), title: proc.plan || 'Tái khám' } : null;
    const vid = S.saveVisit(Object.assign({ patient_id: pid, visit_date: date, appointment }, proc, opts));
    addImages(vid, (opts.imgs || proc.imgs).map((l, i) => [`${l}-${date}-${i + 1}.jpg`, l]));
    return vid;
  };

  // Curated patients (easy to find in the demo)
  const an = addPatient({ full_name: 'Nguyễn Văn An', dob: '1985-03-12', gender: 'Nam', national_id: '079085001234', phone: '0903123456, 0283 822 1234', photo: true, address: '12 Lê Lợi, P. Bến Thành, TP.HCM',
    allergies: 'Penicillin', systemic_diseases: 'Cao huyết áp', current_meds: 'Amlodipine 5mg' }, thisYear - 1);
  addVisit(an, day(-300), PROCS[0](0));
  addVisit(an, day(-40), { reason: 'Đau răng hàm dưới phải', diagnosis: 'Viêm tuỷ không hồi phục R46', teeth: '46', treatment: 'Lấy tuỷ, trám tạm',
    plan: 'Chữa tuỷ lần 2, làm sứ', prescription: 'Clindamycin 300mg x 15v (dị ứng Penicillin)', imgs: ['xquang', 'truoc'] });
  addVisit(an, day(-7), { reason: 'Chữa tuỷ lần 2', diagnosis: 'R46 sau lấy tuỷ', teeth: '46', treatment: 'Trám bít ống tuỷ', plan: 'Lắp mão sứ',
    cost: 3500000, imgs: ['xquang', 'sau', 'khac'] }, { next_appointment: day(2), next_time: '09:00', next_dur: 60 });

  const binh = addPatient({ full_name: 'Trần Thị Bình', birth_year: 1990, gender: 'Nữ', national_id: '079190004567', phone: '0938123456', address: 'Q. Phú Nhuận, TP.HCM' }, thisYear - 2);
  for (let k = 0; k < 6; k++) addVisit(binh, day(-28 * (6 - k) - 1), PROCS[6](0), k === 5 ? { next_appointment: day(5) } : {});

  const minh = addPatient({ full_name: 'Lê Hoàng Minh', dob: `${thisYear - 9}-09-01`, gender: 'Nam', phone: '0909555777', notes: 'Bé sợ khoan, cần trấn an. Liên hệ mẹ: chị Thảo' }, thisYear);
  addVisit(minh, day(0), KID_PROC());

  addPatient({ full_name: 'Phạm Thu Hà', birth_year: 1968, gender: 'Nữ', national_id: '079168007890', phone: '0918222333, 0977111222', created_at: S.now_(), systemic_diseases: 'Tiểu đường type 2', current_meds: 'Metformin 850mg' }, thisYear);

  // Random patients
  const SUR = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
  const MID_M = ['Văn', 'Hữu', 'Minh', 'Quốc', 'Đức', 'Hoàng', 'Thanh', 'Gia'];
  const MID_F = ['Thị', 'Ngọc', 'Thu', 'Thanh', 'Mỹ', 'Bảo', 'Kim', 'Phương'];
  const GIV_M = ['Bình', 'Cường', 'Dũng', 'Hải', 'Khang', 'Long', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Tài', 'Thắng', 'Tuấn', 'Vinh', 'Khoa', 'Huy'];
  const GIV_F = ['Anh', 'Châu', 'Diệp', 'Giang', 'Hạnh', 'Lan', 'Linh', 'Mai', 'Ngân', 'Oanh', 'Phương', 'Trang', 'Uyên', 'Vy', 'Thảo', 'Yến'];
  const AREAS = ['Q.1', 'Q.3', 'Q.10', 'Q. Bình Thạnh', 'Q. Phú Nhuận', 'Q. Gò Vấp', 'Q.7', 'TP. Thủ Đức', 'Q. Tân Bình'];
  const STREETS = ['Nguyễn Trãi', 'Lê Văn Sỹ', 'Cách Mạng Tháng 8', 'Phan Xích Long', 'Nguyễn Đình Chiểu', 'Võ Văn Tần', 'Điện Biên Phủ', 'Hai Bà Trưng'];
  const SYS = [['Cao huyết áp', 'Amlodipine 5mg'], ['Tiểu đường type 2', 'Metformin 500mg'], ['Hen suyễn', 'Ventolin xịt khi cần'], ['Đang mang thai 5 tháng', '']];
  const ALG = ['Penicillin', 'Lidocaine', 'Aspirin', 'Ibuprofen'];
  const used = new Set();
  for (let n = 0; n < 40; n++) {
    const male = chance(0.5);
    let name;
    do { name = `${pick(SUR)} ${pick(male ? MID_M : MID_F)} ${pick(male ? GIV_M : GIV_F)}`; } while (used.has(name));
    used.add(name);
    const kid = chance(0.12);
    const by = kid ? thisYear - 6 - Math.floor(rnd() * 8) : 1950 + Math.floor(rnd() * 55);
    const sys = chance(0.25) ? pick(SYS) : ['', ''];
    const first = new Date(Date.now() - Math.floor(rnd() * 900) * 864e5); // first visit within ~2.5 years
    const pid = addPatient({
      full_name: name, gender: male ? 'Nam' : 'Nữ',
      dob: chance(0.6) ? `${by}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}` : '', birth_year: by,
      phone: ['09' + String(10000000 + Math.floor(rnd() * 89999999))].concat(chance(0.25) ? ['08' + String(10000000 + Math.floor(rnd() * 89999999))] : []).join(', '),
      national_id: kid ? '' : cccd(by, !male),
      address: chance(0.8) ? `${1 + Math.floor(rnd() * 300)} ${pick(STREETS)}, ${pick(AREAS)}, TP.HCM` : '',
      allergies: chance(0.18) ? pick(ALG) : '', systemic_diseases: kid ? '' : sys[0], current_meds: kid ? '' : sys[1],
    }, first.getFullYear());
    if (chance(0.08)) continue; // a few patients registered without any visit yet
    let d = first;
    const visits = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < visits && d <= new Date(); k++) {
      const isLast = k === visits - 1 || new Date(d.getTime() + 40 * 864e5) > new Date();
      addVisit(pid, dateOf(d), kid ? KID_PROC() : pick(PROCS)(pick(FDI)),
        isLast && chance(0.35) ? { next_appointment: day(Math.floor(rnd() * 8)) } : {});
      d = new Date(d.getTime() + (20 + Math.floor(rnd() * 200)) * 864e5);
    }
  }

  // Calendar: appointments from 2 weeks ago to 5 weeks ahead (timed, some untimed, mixed statuses)
  const pids = S.readActive_('Patients').map(p => p.patient_id);
  const TITLES = ['Khám tổng quát', 'Cạo vôi', 'Trám răng', 'Chữa tuỷ lần 2', 'Lắp mão sứ', 'Tái khám niềng', 'Cắt chỉ', 'Tư vấn implant', 'Tẩy trắng', 'Nhổ răng khôn'];
  for (let off = -14; off <= 35; off++) {
    const dt = day(off);
    const dow = new Date(Date.now() + off * 864e5).getDay();
    const n = dow === 0 ? (chance(0.3) ? 1 : 0) : 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const timed = chance(0.92);
      const status = off < 0 ? (chance(0.8) ? 'arrived' : chance(0.5) ? 'no_show' : 'cancelled') : (chance(0.05) ? 'cancelled' : 'scheduled');
      const r = S.saveAppointment({ patient_id: pick(pids), appt_date: dt, start_time: timed ? randTime() : '', duration_min: timed ? pick(DUR) : '',
        title: pick(TITLES), notes: chance(0.15) ? 'Nhắc BN nhịn ăn 2 giờ trước' : '', status });
      void r;
    }
  }

  // Old photo folders waiting in _import (1 matches after importing the sample Excel, 1 does not)
  const imp = gas.DriveApp.getFolderById(gas.PropertiesService.getScriptProperties().getProperty('IMPORT_FOLDER_ID'));
  const fk = imp.createFolder('0006_Dang Van Khoa');
  [['khoa-2022-1.jpg', 'xquang'], ['khoa-2022-2.jpg', 'khac']].forEach(([n, l], i) => new gas.__File(n, fk, 'image/svg+xml', '', undefined, svg(n, i, l)));
  const fx = imp.createFolder('anh_chua_ro_ten');
  new gas.__File('scan-01.jpg', fx, 'image/svg+xml', '', undefined, svg('scan-01.jpg', 3, 'khac'));

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
