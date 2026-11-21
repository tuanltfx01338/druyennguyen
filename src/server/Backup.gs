var BACKUP_KEEP = 8;

/** Weekly trigger (installed by setup): copy the spreadsheet, keep the newest BACKUP_KEEP copies. */
function weeklyBackup() {
  var c = cfg_();
  var folder = DriveApp.getFolderById(c.BACKUP_FOLDER_ID);
  DriveApp.getFileById(c.SHEET_ID).makeCopy('BenhAn_backup_' + today_(), folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
}
