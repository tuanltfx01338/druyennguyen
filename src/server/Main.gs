function doGet() {
  var props = PropertiesService.getScriptProperties();
  // Re-run the idempotent setup after an update that adds columns, so headers/formats exist without a manual step.
  if (!props.getProperty('SHEET_ID') || props.getProperty('SCHEMA_VERSION') !== String(SCHEMA_VERSION)) setup();
  return HtmlService.createTemplateFromFile('client/Index').evaluate()
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
  return 'OK';
}

function getStorageQuota() {
  return api_('getStorageQuota', function () {
    var used = DriveApp.getStorageUsed(), limit = DriveApp.getStorageLimit();
    return { used: used, limit: limit, ratio: limit ? used / limit : 0 };
  });
}
