// Minimal in-memory fakes of the Apps Script services used by src/server — enough for integration tests.
// Runs in Node (tests) and in the browser (tools/build-demo.js) — so no Node-only APIs.
const b64enc = bytes => {
  const u = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64dec = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
const pad = n => String(n).padStart(2, '0');

function createGas(opts = {}) {
  let idSeq = 0;
  const newId = p => p + '_' + String(++idSeq).padStart(12, '0');
  const items = new Map(); // id -> folder|file

  class Folder {
    constructor(name, parent) { this.id = newId('fld'); this.name = name; this.parent = parent; this.trashed = false; items.set(this.id, this); }
    getId() { return this.id; } getName() { return this.name; }
    children() { return [...items.values()].filter(x => x.parent === this && !x.trashed); }
    createFolder(n) { return new Folder(n, this); }
    getFolders() { return iter(this.children().filter(x => x instanceof Folder)); }
    getFoldersByName(n) { return iter(this.children().filter(x => x instanceof Folder && x.name === n)); }
    getFiles() { return iter(this.children().filter(x => x instanceof File)); }
    getFilesByName(n) { return iter(this.children().filter(x => x instanceof File && x.name === n)); }
    getParents() { return iter(this.parent ? [this.parent] : []); }
    createFile(name, content, mime) { return new File(name, this, mime || 'text/plain', content); }
    setTrashed(t) { this.trashed = t; }
  }
  class File {
    constructor(name, parent, mime, content = '', size, bytes) { this.id = newId('fil'); this.name = name; this.parent = parent; this.mime = mime; this.content = content; this.bytes = bytes || null; this.size = size ?? (bytes ? bytes.length : content.length); this.trashed = false; this.created = new Date(Date.now() + idSeq); items.set(this.id, this); }
    getId() { return this.id; } getName() { return this.name; } getMimeType() { return this.mime; } getSize() { return this.size; }
    getDateCreated() { return this.created; }
    moveTo(f) { this.parent = f; return this; }
    setTrashed(t) { this.trashed = t; }
    getBlob() { return { getDataAsString: () => this.content }; }
    makeCopy(name, folder) { return new File(name, folder, this.mime, this.content); }
  }
  const root = new Folder('My Drive', null);

  // ---- Sheets ----
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); }
      return out;
    }
    setValues(v) {
      if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues size mismatch ${v.length}x${v[0].length} vs ${this.nr}x${this.nc}`);
      v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this;
    }
    setValue(x) { this.sh.set(this.r, this.c, x); return this; }
    setNumberFormat() { return this; } setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; }
    get(r, c) { const v = (this.rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
    set(r, c, x) {
      if (r > this.maxRows) throw new Error('Range outside sheet dimensions');
      // Sheets strips a leading apostrophe and stores the rest as text; formulas would be evaluated.
      if (typeof x === 'string' && x.startsWith("'")) x = x.slice(1);
      else if (typeof x === 'string' && x.startsWith('=')) throw new Error('FORMULA WRITTEN: ' + x);
      (this.rows[r - 1] = this.rows[r - 1] || [])[c - 1] = x;
    }
    getLastRow() { return this.rows.length; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after, n) { this.maxRows += n; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getDataRange() { const nc = Math.max(0, ...this.rows.map(r => r.length)); return new Range(this, 1, 1, this.rows.length, nc); }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(name) { this.file = new File(name, root, 'application/vnd.google-apps.spreadsheet'); this.sheets = [new Sheet('Sheet1')]; spreadsheets.set(this.file.id, this); }
    getId() { return this.file.id; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
    getSheets() { return this.sheets; }
  }
  const spreadsheets = new Map();
  const sessions = new Map();

  const props = {};
  const cache = {};
  const fmt = (d, tz, f) => {
    const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return f === 'yyyy-MM-dd' ? s : `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const gas = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      create: n => new Spreadsheet(n),
      openById: id => { const s = spreadsheets.get(id); if (!s) throw new Error('no spreadsheet ' + id); return s; },
    },
    DriveApp: {
      createFolder: n => root.createFolder(n),
      getFolderById: id => { const f = items.get(id); if (!(f instanceof Folder)) throw new Error('no folder ' + id); return f; },
      getFileById: id => { const f = items.get(id); if (!(f instanceof File)) throw new Error('no file ' + id); return f; },
      getStorageUsed: () => 8e9, getStorageLimit: () => 15e9,
    },
    Drive: {
      Files: {
        get: (id, o) => { const f = items.get(id); if (!f) throw new Error('404'); return { id: f.id, name: f.name, mimeType: f.mime, size: String(f.size), parents: [f.parent.id], thumbnailLink: 'https://lh3.googleusercontent.com/d/' + f.id + '=s220' }; },
        create: (res, blob) => {
          const parent = items.get(res.parents[0]);
          if (res.mimeType === 'application/vnd.google-apps.spreadsheet') {
            const ss = new Spreadsheet(res.name); ss.file.parent = parent;
            ss.sheets = (opts.importFixture ? opts.importFixture() : []).map(([name, rows]) => { const s = new Sheet(name); s.rows = rows; return s; });
            return { id: ss.getId() };
          }
          return { id: new File(res.name, parent, res.mimeType, '').id };
        },
      },
    },
    Utilities: {
      formatDate: fmt,
      getUuid: () => globalThis.crypto.randomUUID(),
      base64Decode: s => b64dec(s),
      base64Encode: b => b64enc(b),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    MimeType: { MICROSOFT_EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', PLAIN_TEXT: 'text/plain' },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: k => props[k] ?? null, setProperties: o => Object.assign(props, o) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])), putAll: o => Object.assign(cache, o) }) },
    ScriptApp: {
      getOAuthToken: () => 'tok', getProjectTriggers: () => [],
      newTrigger: () => { const c = { timeBased: () => c, everyWeeks: () => c, onWeekDay: () => c, atHour: () => c, create: () => ({}) }; return c; },
      WeekDay: { SUNDAY: 'SUNDAY' },
    },
    UrlFetchApp: {
      // Fake Drive resumable upload: POST opens a session, PUT chunks with Content-Range.
      fetch: (url, o) => {
        const resp = (code, body, headers = {}) => ({ getResponseCode: () => code, getHeaders: () => headers, getContentText: () => JSON.stringify(body) });
        if (o.method === 'post') {
          const meta = JSON.parse(o.payload);
          const sid = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + (++idSeq);
          sessions.set(sid, { meta, total: Number(o.headers['X-Upload-Content-Length']), got: 0, mime: o.headers['X-Upload-Content-Type'], parts: [] });
          return resp(200, {}, { Location: sid });
        }
        const ses = sessions.get(url);
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(o.headers['Content-Range']);
        if (!ses || Number(m[1]) !== ses.got || o.payload.length !== Number(m[2]) - Number(m[1]) + 1) return resp(400, {});
        ses.got += o.payload.length;
        ses.parts.push(o.payload);
        if (ses.got < ses.total) return resp(308, {});
        const all = new Uint8Array(ses.total); let off = 0;
        for (const p of ses.parts) { all.set(p, off); off += p.length; }
        const f = new File(ses.meta.name, items.get(ses.meta.parents[0]), ses.mime, '', ses.total, all);
        return resp(200, { id: f.id, name: f.name, mimeType: f.mime, size: String(f.size) });
      },
      // Thumbnail fetch: return the stored bytes of the file named in the link (or a tiny stub).
      fetchAll: reqs => reqs.map(r => {
        const f = items.get((/\/d\/([^=]+)=/.exec(r.url) || [])[1]);
        return { getResponseCode: () => (f ? 200 : 404), getHeaders: () => ({ 'Content-Type': f ? f.mime : '' }), getContent: () => (f && f.bytes) || [1, 2, 3] };
      }),
    },
  };
  gas.__items = items; gas.__root = root; gas.__File = File; gas.__spreadsheets = spreadsheets;
  return gas;
}
if (typeof module !== 'undefined') module.exports = { createGas };
