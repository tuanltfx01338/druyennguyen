/**
 * Import theo mẫu Mau_nhap_benh_nhan_cu.xlsx:
 * importPreview (dry-run, không ghi) → importCommit (theo lô) → importImagesMatch → importImagesMove (theo lô).
 */
var IMPORT_BATCH = 100;
var MOVE_BATCH = 60;
var TIME_BUDGET_MS = 4.5 * 60 * 1000; // stay under the 6-minute Apps Script limit

function systemFolder_() { return DriveApp.getFolderById(cfg_().SYSTEM_FOLDER_ID); }

function readTemplateSheet_(ss, name, headerChecks) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('File không đúng mẫu: thiếu sheet ' + name);
  var vals = sh.getDataRange().getValues();
  var hdr = vals[1] || [];
  headerChecks.forEach(function (c) {
    if (String(hdr[c[0]] || '').indexOf(c[1]) !== 0) throw new Error('File không đúng mẫu: sheet ' + name + ' cột ' + (c[0] + 1) + ' phải là "' + c[1] + '"');
  });
  return vals.slice(2).map(function (r) {
    return r.map(function (c) { return c instanceof Date ? Utilities.formatDate(c, TZ, 'yyyy-MM-dd') : c; });
  });
}

function importPreview(fileName, b64) {
  return api_('importPreview', function () {
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), MimeType.MICROSOFT_EXCEL, fileName);
    var tmp = Drive.Files.create({ name: 'tmp_import_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS,
      parents: [cfg_().SYSTEM_FOLDER_ID] }, blob);
    var bn, lk;
    try {
      var ss = SpreadsheetApp.openById(tmp.id);
      bn = readTemplateSheet_(ss, 'BenhNhan', [[0, 'STT'], [2, 'Họ tên']]);
      lk = readTemplateSheet_(ss, 'LanKham', [[0, 'STT BN'], [2, 'Ngày khám']]);
    } finally {
      DriveApp.getFileById(tmp.id).setTrashed(true);
    }
    var existing = readAll_('Patients').map(function (p) { return p.import_stt; }).filter(function (s) { return s !== ''; });
    var r = parseImport(bn, lk, { currentYear: new Date().getFullYear(), existingStts: existing });
    var runId = Utilities.getUuid();
    systemFolder_().createFile('import_' + runId + '.json', JSON.stringify(r.patients), MimeType.PLAIN_TEXT);
    var visits = 0;
    r.patients.forEach(function (p) { if (!p.skip) visits += p.visits.length; });
    return {
      runId: runId, errors: r.errors.slice(0, 200), errorCount: r.errors.length, warnings: r.warnings,
      newPatients: r.patients.filter(function (p) { return !p.skip; }).length, newVisits: visits,
      skippedExisting: r.skippedExisting
    };
  });
}

function loadRun_(runId) {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error('runId không hợp lệ');
  var it = systemFolder_().getFilesByName('import_' + runId + '.json');
  if (!it.hasNext()) throw new Error('Không tìm thấy phiên import, hãy xem trước lại');
  return { file: it.next() };
}

/** Writes patients [offset, offset+IMPORT_BATCH). Each patient + its visits in the same batch → safe to re-run. */
function importCommit(runId, offset) {
  return api_('importCommit', function () {
    var run = loadRun_(runId);
    var patients = JSON.parse(run.file.getBlob().getDataAsString());
    offset = Number(offset) || 0;
    var batch = patients.slice(offset, offset + IMPORT_BATCH);
    var created = 0, skipped = 0;
    withLock_(function () {
      var existing = {};
      readAll_('Patients').forEach(function (p) { if (p.import_stt !== '') existing[Number(p.import_stt)] = true; });
      var todo = batch.filter(function (p) { return !existing[p.import_stt]; });
      skipped = batch.length - todo.length;
      var byYear = {};
      todo.forEach(function (p) { (byYear[p.year] = byYear[p.year] || []).push(p); });
      Object.keys(byYear).forEach(function (y) {
        var ids = reserveIds_(Number(y), byYear[y].length);
        byYear[y].forEach(function (p, i) { p.patient_id = ids[i]; });
      });
      var pRows = [], vRows = [], logs = [], ts = now_();
      todo.forEach(function (p) {
        p.folder_id = createPatientFolder_(p.patient_id, p.full_name).getId();
        p.name_search = normalizeText(p.full_name);
        p.created_at = p.updated_at = ts;
        p.deleted = false;
        pRows.push(p);
        p.visits.forEach(function (v) {
          v.visit_id = Utilities.getUuid(); v.patient_id = p.patient_id; v.source = 'import'; v.folder_id = '';
          v.created_at = v.updated_at = ts; v.deleted = false;
          vRows.push(v);
        });
        logs.push({ run_id: runId, at: ts, sheet: 'BenhNhan', row: p.import_stt, status: 'ok', message: p.patient_id });
      });
      appendRows_('Patients', pRows);
      appendRows_('Visits', vRows);
      appendRows_('ImportLog', logs);
      created = todo.length;
    });
    var next = offset + batch.length;
    var done = next >= patients.length;
    if (done) run.file.setTrashed(true);
    return { next: next, total: patients.length, done: done, created: created, skipped: skipped };
  });
}

function importFolder_() { return DriveApp.getFolderById(cfg_().IMPORT_FOLDER_ID); }

function countImages_(folder) {
  var n = 0, files = folder.getFiles();
  while (files.hasNext()) if (String(files.next().getMimeType()).indexOf('image/') === 0) n++;
  var subs = folder.getFolders();
  while (subs.hasNext()) n += countImages_(subs.next());
  return n;
}

function hasAnyFile_(folder) {
  if (folder.getFiles().hasNext()) return true;
  var subs = folder.getFolders();
  while (subs.hasNext()) if (hasAnyFile_(subs.next())) return true;
  return false;
}

/** Matches subfolders of NhaKhoa/_import to patients by the "Thư mục ảnh" column. */
function importImagesMatch() {
  return api_('importImagesMatch', function () {
    var byFolder = {};
    readActive_('Patients').forEach(function (p) {
      if (p.import_folder_name) byFolder[String(p.import_folder_name).trim()] = p;
    });
    var matched = [], unmatched = [], it = importFolder_().getFolders();
    while (it.hasNext()) {
      var f = it.next();
      var item = { folderId: f.getId(), folder: f.getName(), imageCount: countImages_(f) };
      var p = byFolder[f.getName().trim()];
      if (p) { item.patient_id = p.patient_id; item.full_name = p.full_name; matched.push(item); }
      else unmatched.push(item);
    }
    return { matched: matched, unmatched: unmatched };
  });
}

function importVisit_(patientId) {
  var visits = readActive_('Visits').filter(function (v) { return v.patient_id === patientId; });
  var existing = visits.filter(function (v) { return v.source === 'import-images'; })[0];
  if (existing) return existing;
  var dates = visits.map(function (v) { return v.visit_date; }).filter(Boolean).sort();
  var v = { visit_id: Utilities.getUuid(), patient_id: patientId, visit_date: dates[0] || today_(),
    reason: IMPORT_VISIT_REASON, notes: 'Ảnh nhập từ dữ liệu cũ', source: 'import-images', folder_id: '',
    created_at: now_(), updated_at: now_(), deleted: false };
  appendRows_('Visits', [v]);
  return findBy_('Visits', 'visit_id', v.visit_id);
}

/** Moves up to MOVE_BATCH images from one _import subfolder into the patient's "Du lieu cu" visit. */
function importImagesMove(folderId, patientId) {
  return api_('importImagesMove', function () {
    var started = Date.now();
    var src = DriveApp.getFolderById(folderId);
    var parents = src.getParents();
    if (!parents.hasNext() || parents.next().getId() !== cfg_().IMPORT_FOLDER_ID) throw new Error('Thư mục không nằm trong NhaKhoa/_import');
    mustFindActive_('Patients', 'patient_id', patientId, 'Bệnh nhân');
    return withLock_(function () {
      var v = importVisit_(patientId);
      var dest = ensureVisitFolder_(v);
      var rows = [], stack = [src], ts = now_();
      while (stack.length && rows.length < MOVE_BATCH && Date.now() - started < TIME_BUDGET_MS) {
        var f = stack.pop(), files = f.getFiles();
        while (files.hasNext() && rows.length < MOVE_BATCH) {
          var file = files.next();
          if (String(file.getMimeType()).indexOf('image/') !== 0) continue;
          file.moveTo(dest);
          rows.push({ image_id: file.getId(), visit_id: v.visit_id, patient_id: patientId, file_name: file.getName(),
            mime: file.getMimeType(), size_bytes: file.getSize(), label: 'khac', created_at: ts, deleted: false });
        }
        var subs = f.getFolders();
        while (subs.hasNext()) stack.push(subs.next());
      }
      appendRows_('Images', rows);
      var remaining = countImages_(src);
      var leftover = remaining === 0 && hasAnyFile_(src);
      // Only trash the source folder when it is truly empty; non-image files stay for the doctor to review.
      if (remaining === 0 && !leftover) src.setTrashed(true);
      return { moved: rows.length, remaining: remaining, done: remaining === 0, leftoverNonImages: leftover };
    });
  });
}
