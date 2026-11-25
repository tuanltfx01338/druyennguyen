function doGet() {
  var props = PropertiesService.getScriptProperties();
  // Re-run the idempotent setup after an update that adds columns, so headers/formats exist without a manual step.
  if (!props.getProperty('SHEET_ID') || props.getProperty('SCHEMA_VERSION') !== String(SCHEMA_VERSION)) setup();
  var page = HtmlService.createTemplateFromFile('client/Index');
  page.boot = bootPayload_();
  return page.evaluate()
    .setTitle('Sổ bệnh án Nha khoa')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Idempotent one-time setup: folders, spreadsheet, sheets, weekly backup trigger.
 * Run manually once from the editor (grants OAuth), doGet also calls it if needed.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var p = props.getProperties();

  var root = p.ROOT_ID ? DriveApp.getFolderById(p.ROOT_ID) : DriveApp.createFolder('NhaKhoa');
  var sub = function (parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  };
  var patients = sub(root, 'BenhNhan');
  var imp = sub(root, '_import');
  var backup = sub(root, '_backup');
  var system = sub(root, '_system');

  var ss;
  if (p.SHEET_ID) {
    ss = SpreadsheetApp.openById(p.SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('BenhAn');
    DriveApp.getFileById(ss.getId()).moveTo(root);
  }
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABLES[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // Columns are only ever appended: fill in header cells for new trailing columns.
      var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
      var missing = cols.filter(function (c, i) { return head[i] !== c; });
      if (missing.length) {
        cols.forEach(function (c, i) { if (head[i] !== '' && head[i] != null && head[i] !== c) throw new Error('Sheet ' + name + ' cột ' + (i + 1) + ' là "' + head[i] + '", cần "' + c + '"'); });
        sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      }
    }
    // Text format keeps leading zeros in phone numbers and stops Sheets auto-parsing timestamps.
    cols.forEach(function (c, i) {
      var range = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      if ((DATE_COLS[name] || []).indexOf(c) >= 0) range.setNumberFormat('dd/mm/yyyy');
      else if ((NUMBER_COLS[name] || []).indexOf(c) >= 0) range.setNumberFormat('0');
      else range.setNumberFormat('@');
    });
  });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Trang tính1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  props.setProperties({
    ROOT_ID: root.getId(), SHEET_ID: ss.getId(), PATIENTS_FOLDER_ID: patients.getId(),
    IMPORT_FOLDER_ID: imp.getId(), BACKUP_FOLDER_ID: backup.getId(), SYSTEM_FOLDER_ID: system.getId(),
    SCHEMA_VERSION: String(SCHEMA_VERSION)
  });

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; });
  if (!hasTrigger) {
    ScriptApp.newTrigger('weeklyBackup').timeBased().everyWeeks(1)
      .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();
  }
  Object.keys(TABLES).forEach(invalidateTable_); // headers or the sheet itself may have changed
  return 'OK';
}

function getStorageQuota() {
  return api_('getStorageQuota', storageQuota_);
}
/** Drive quota changes slowly; cache it for an hour so the first screen does not wait on Drive. */
function storageQuota_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('quota');
  if (hit) return JSON.parse(hit);
  var used = DriveApp.getStorageUsed(), limit = DriveApp.getStorageLimit();
  var q = { used: used, limit: limit, ratio: limit ? used / limit : 0 };
  cache.put('quota', JSON.stringify(q), 3600);
  return q;
}
/**
 * Data for the first screen, embedded in the page so "Hôm nay" shows without another round trip.
 * Any failure here only costs that shortcut: the client then loads the dashboard the normal way.
 */
function bootPayload_() {
  var t0 = Date.now();
  try {
    return JSON.stringify({ today: today_(), at: Date.now(), dashboard: buildDashboard(readActive_('Patients'), readActive_('Visits'), today_(), readActive_('Appointments')), quota: storageQuota_() });
  } catch (e) {
    console.error('bootPayload_: ' + e.message);
    return 'null';
  } finally {
    console.log('[perf] doGet boot ' + (Date.now() - t0) + ' ms');
  }
}
