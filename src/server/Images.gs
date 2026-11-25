var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

function publicImage_(i) {
  return { image_id: i.image_id, visit_id: i.visit_id, file_name: i.file_name, mime: i.mime,
    size_bytes: i.size_bytes, label: i.label };
}

/** Ensures the visit folder exists (lazy) and returns it. */
function ensureVisitFolder_(v) {
  if (v.folder_id) return DriveApp.getFolderById(v.folder_id);
  var p = mustFindActive_('Patients', 'patient_id', v.patient_id, 'Bệnh nhân');
  if (!p.folder_id) {
    p.folder_id = createPatientFolder_(p.patient_id, p.full_name).getId();
    updateRow_('Patients', p);
  }
  var parent = DriveApp.getFolderById(p.folder_id);
  var names = [], it = parent.getFolders();
  while (it.hasNext()) names.push(it.next().getName());
  var base = v.source === 'import-images' ? 'Du lieu cu' : v.visit_date;
  var folder = parent.createFolder(dedupeName(base, names));
  v.folder_id = folder.getId();
  updateRow_('Visits', v);
  return folder;
}

/** Folder + short-lived OAuth token so the browser uploads originals straight to Drive. */
function getUploadContext(visitId) {
  return api_('getUploadContext', function () {
    return withLock_(function () {
      var v = mustFindActive_('Visits', 'visit_id', visitId, 'Lần khám');
      return { folderId: ensureVisitFolder_(v).getId(), token: ScriptApp.getOAuthToken() };
    });
  });
}

/** Fallback path (if browser → Drive CORS fails): server opens a resumable session. */
function startServerUpload(folderId, name, mime, size) {
  return api_('startServerUpload', function () {
    var res = UrlFetchApp.fetch(DRIVE_UPLOAD_URL + '?uploadType=resumable&fields=id,name,mimeType,size', {
      method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mime || 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
      payload: JSON.stringify({ name: name, parents: [folderId] })
    });
    var loc = res.getHeaders().Location || res.getHeaders().location;
    if (res.getResponseCode() !== 200 || !loc) throw new Error('Không mở được phiên upload (' + res.getResponseCode() + ')');
    return loc;
  });
}

function uploadChunk(sessionUrl, b64, start, total) {
  return api_('uploadChunk', function () {
    if (String(sessionUrl).indexOf(DRIVE_UPLOAD_URL + '?') !== 0) throw new Error('Session URL không hợp lệ');
    var bytes = Utilities.base64Decode(b64);
    var end = start + bytes.length - 1;
    var res = UrlFetchApp.fetch(sessionUrl, {
      method: 'put', contentType: 'application/octet-stream', payload: bytes,
      followRedirects: false, muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes ' + start + '-' + end + '/' + total }
    });
    var code = res.getResponseCode();
    if (code === 308) return { done: false };
    if (code === 200 || code === 201) return { done: true, file: JSON.parse(res.getContentText()) };
    throw new Error('Upload lỗi (' + code + ')');
  });
}

/** Records uploaded files; only accepts files that really sit in the visit folder. */
function registerImages(visitId, files) {
  return api_('registerImages', function () {
    return withLock_(function () {
      var v = mustFindActive_('Visits', 'visit_id', visitId, 'Lần khám');
      var known = {};
      readAll_('Images').forEach(function (i) { known[i.image_id] = true; });
      var rows = (files || []).filter(function (f) { return f && f.id && !known[f.id]; }).map(function (f) {
        var meta = Drive.Files.get(f.id, { fields: 'id,name,mimeType,size,parents' });
        if ((meta.parents || []).indexOf(v.folder_id) < 0) throw new Error('File không nằm trong thư mục lần khám');
        return { image_id: meta.id, visit_id: v.visit_id, patient_id: v.patient_id, file_name: meta.name,
          mime: meta.mimeType, size_bytes: Number(meta.size) || 0,
          label: IMAGE_LABELS.indexOf(f.label) >= 0 ? f.label : 'khac', created_at: now_(), deleted: false };
      });
      appendRows_('Images', rows);
      return rows.map(publicImage_);
    });
  });
}

function setImageLabel(imageId, label) {
  return api_('setImageLabel', function () {
    if (IMAGE_LABELS.indexOf(label) < 0) throw new Error('Nhãn không hợp lệ');
    return withLock_(function () {
      var i = mustFindActive_('Images', 'image_id', imageId, 'Ảnh');
      i.label = label;
      updateRow_('Images', i);
      return true;
    });
  });
}

/** Moves the original to Drive trash (recoverable 30 days) + soft delete. */
function deleteImage(imageId) {
  return api_('deleteImage', function () {
    return withLock_(function () {
      var i = mustFindActive_('Images', 'image_id', imageId, 'Ảnh');
      try { DriveApp.getFileById(imageId).setTrashed(true); } catch (e) { console.warn('deleteImage: file already gone'); }
      i.deleted = true;
      updateRow_('Images', i);
      return true;
    });
  });
}

function fetchDriveThumbs_(ids, size) {
  var token = ScriptApp.getOAuthToken();
  var links = ids.map(function (id) {
    try {
      var l = Drive.Files.get(id, { fields: 'thumbnailLink' }).thumbnailLink;
      return l ? l.replace(/=s\d+(-[a-z]+)?$/, '') + '=s' + size : null;
    } catch (e) { return null; }
  });
  var reqs = links.filter(Boolean).map(function (l) {
    return { url: l, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  });
  var resps = reqs.length ? UrlFetchApp.fetchAll(reqs) : [];
  var out = {}, k = 0;
  ids.forEach(function (id, idx) {
    if (!links[idx]) { out[id] = null; return; }
    var r = resps[k++];
    out[id] = r.getResponseCode() === 200
      ? 'data:' + (r.getHeaders()['Content-Type'] || 'image/jpeg') + ';base64,' + Utilities.base64Encode(r.getContent())
      : null;
  });
  return out;
}

/** Thumbnails generated by Drive (null if Drive has not made one yet, e.g. right after upload). */
// Grid cells are ~96–130 CSS px; 320 px stays sharp on 3× phone screens at roughly half the bytes of 400 px.
var THUMB_PX = 320;
function getThumbs(ids) {
  return api_('getThumbs', function () {
    ids = (ids || []).filter(function (id) { return /^[\w-]{10,}$/.test(id); }).slice(0, 40);
    var cache = CacheService.getScriptCache();
    var cached = cache.getAll(ids.map(function (id) { return 't2_' + id; }));
    var missing = ids.filter(function (id) { return !cached['t2_' + id]; });
    var fresh = missing.length ? fetchDriveThumbs_(missing, THUMB_PX) : {};
    var toCache = {};
    Object.keys(fresh).forEach(function (id) {
      if (fresh[id] && fresh[id].length < 95000) toCache['t2_' + id] = fresh[id];
    });
    if (Object.keys(toCache).length) cache.putAll(toCache, 21600);
    var out = {};
    ids.forEach(function (id) { out[id] = cached['t2_' + id] || fresh[id] || null; });
    return out;
  });
}

/** Large preview (1600px) for the lightbox; original stays untouched on Drive. */
/** size: longest side the screen can show (client sends 800–1600); the original stays untouched in Drive. */
function getPreview(id, size) {
  return api_('getPreview', function () {
    if (!/^[\w-]{10,}$/.test(id)) throw new Error('Mã ảnh không hợp lệ');
    var px = Math.min(1600, Math.max(400, Math.round(Number(size) || 1600)));
    return fetchDriveThumbs_([id], px)[id];
  });
}
