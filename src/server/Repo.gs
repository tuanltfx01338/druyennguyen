/** Sheet access layer: tables are defined in Lib.gs (TABLES). Row 1 = header. */

var TZ = 'Asia/Ho_Chi_Minh';

function cfg_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.SHEET_ID) throw new Error('Chưa khởi tạo. Chạy hàm setup() một lần trong trình soạn thảo Apps Script.');
  return p;
}

var ss_cache_ = null;
function sheet_(name) {
  if (!ss_cache_) ss_cache_ = SpreadsheetApp.openById(cfg_().SHEET_ID);
  return ss_cache_.getSheetByName(name);
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function fromCell_(v) {
  // google.script.run cannot return Date objects → always send 'yyyy-MM-dd'.
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v;
}

function toCell_(table, col, v) {
  if (v == null) return '';
  if ((DATE_COLS[table] || []).indexOf(col) >= 0) {
    if (!v) return '';
    var p = String(v).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  return sanitizeCell(v);
}

/** Reads every row as objects; `_row` = sheet row number. */
/*
 * Table snapshots in CacheService: opening the spreadsheet and reading whole sheets costs ~1 s per call,
 * a cache hit ~50 ms. Every write goes through appendRows_/updateRow_, which flush and switch the table to a
 * new version key, so a snapshot is never served after a write made through the app. Sheet edits made by hand
 * show up after TABLE_CACHE_TTL at the latest (or via the "Làm mới" button, which calls refreshCache).
 * A reader that raced with a writer stores its snapshot under the old version, which nobody reads any more.
 */
var TABLE_CACHE_TTL = 600;
var TABLE_CHUNK_CHARS = 30000;      // CacheService values are capped at 100 KB; 30k chars ≤ 90 KB even if every char is 3-byte UTF-8
var TABLE_CACHE_MAX_CHARS = 1500000;
var UNCACHED_TABLES = { Counters: true, ImportLog: true };
var tableJson_ = {};                // per-execution memo of the JSON text (parsed fresh on each read, so callers may mutate)

function readAll_(table) {
  if (UNCACHED_TABLES[table]) return readSheet_(table);
  return JSON.parse(tableJson_[table] || loadTableJson_(table));
}
function loadTableJson_(table) {
  var cache = CacheService.getScriptCache();
  var verKey = 'tv:' + table;
  var ver = cache.get(verKey);
  if (ver) {
    var base = 'tc:' + table + ':' + ver;
    var n = Number(cache.get(base) || 0);
    if (n) {
      var keys = [];
      for (var i = 0; i < n; i++) keys.push(base + ':' + i);
      var parts = cache.getAll(keys);
      if (keys.every(function (k) { return parts[k] != null; })) {
        return (tableJson_[table] = keys.map(function (k) { return parts[k]; }).join(''));
      }
    }
  } else {
    ver = newCacheVer_();
    cache.put(verKey, ver, 21600);
  }
  var json = JSON.stringify(readSheet_(table));
  tableJson_[table] = json;
  if (json.length <= TABLE_CACHE_MAX_CHARS) {
    var out = {}, count = Math.max(1, Math.ceil(json.length / TABLE_CHUNK_CHARS));
    var b = 'tc:' + table + ':' + ver;
    for (var j = 0; j < count; j++) out[b + ':' + j] = json.slice(j * TABLE_CHUNK_CHARS, (j + 1) * TABLE_CHUNK_CHARS);
    out[b] = String(count);
    try { cache.putAll(out, TABLE_CACHE_TTL); } catch (e) { console.warn('table cache put failed for ' + table + ': ' + e.message); }
  }
  return json;
}
function invalidateTable_(table) {
  delete tableJson_[table];
  if (UNCACHED_TABLES[table]) return;
  SpreadsheetApp.flush(); // a reader that starts after the version switch must see the new rows
  CacheService.getScriptCache().put('tv:' + table, newCacheVer_(), 21600);
}
function newCacheVer_() { return Utilities.getUuid().slice(0, 8); }

/** "Làm mới" in the app: drop all table snapshots (e.g. after editing the Sheet by hand). */
function refreshCache() {
  return api_('refreshCache', function () {
    Object.keys(TABLES).forEach(invalidateTable_);
    return true;
  });
}

function readSheet_(table) {
  var sh = sheet_(table);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = TABLES[table];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = fromCell_(r[j]); });
    return o;
  });
}

function readActive_(table) {
  return readAll_(table).filter(function (o) { return !isTrue(o.deleted); });
}

function toRow_(table, obj) {
  return TABLES[table].map(function (c) { return toCell_(table, c, obj[c]); });
}

function appendRows_(table, objs) {
  if (!objs.length) return;
  var sh = sheet_(table);
  var rows = objs.map(function (o) { return toRow_(table, o); });
  var start = sh.getLastRow() + 1;
  // getRange beyond the grid throws; inserted rows inherit the text/date formats set in setup().
  var need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 500);
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  invalidateTable_(table);
}

function updateRow_(table, obj) {
  if (!obj._row) throw new Error('updateRow_: missing _row');
  sheet_(table).getRange(obj._row, 1, 1, TABLES[table].length).setValues([toRow_(table, obj)]);
  invalidateTable_(table);
}

function findBy_(table, col, value) {
  var rows = readAll_(table);
  for (var i = 0; i < rows.length; i++) if (rows[i][col] === value) return rows[i];
  return null;
}

function mustFindActive_(table, col, value, label) {
  var o = findBy_(table, col, value);
  if (!o || isTrue(o.deleted)) throw new Error(label + ' không tồn tại: ' + value);
  return o;
}

/** Reserves `n` sequential patient ids for `year` under a script lock. */
function reserveIds_(year, n) {
  var sh = sheet_('Counters');
  var rows = readAll_('Counters');
  var row = rows.filter(function (r) { return Number(r.year) === year; })[0];
  var last = row ? Number(row.last_seq) : 0;
  if (row) sh.getRange(row._row, 2).setValue(last + n);
  else appendRows_('Counters', [{ year: year, last_seq: last + n }]);
  var ids = [];
  for (var i = 1; i <= n; i++) ids.push(formatPatientId(year, last + i));
  return ids;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Hệ thống đang bận, thử lại sau ít giây.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Wraps public API: user-facing message, log without patient data. */
function api_(name, fn) {
  var t0 = Date.now();
  try {
    return fn();
  } catch (e) {
    console.error(name + ': ' + (e && e.message));
    throw new Error(e && e.message ? e.message : 'Lỗi không xác định');
  } finally {
    // Visible in Apps Script → Executions: server-side time of each call, to compare before/after tuning.
    console.log('[perf] ' + name + ' ' + (Date.now() - t0) + ' ms');
  }
}
