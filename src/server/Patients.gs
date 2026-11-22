function publicPatient_(p) {
  var o = {};
  TABLES.Patients.forEach(function (c) { o[c] = p[c]; });
  delete o.name_search;
  return o;
}

/** q: tên (không dấu), mã BN hoặc SĐT. Rỗng → 20 hồ sơ cập nhật gần nhất. */
function searchPatients(q) {
  return api_('searchPatients', function () {
    var rows = readActive_('Patients');
    q = String(q || '').trim();
    var res;
    if (!q) {
      res = rows.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); }).slice(0, 20);
    } else {
      var id = parsePatientIdQuery(q);
      var nq = normalizeText(q);
      var digits = q.replace(/\D/g, '');
      res = rows.filter(function (p) {
        if (id) return p.patient_id === id;
        if (String(p.name_search).indexOf(nq) >= 0) return true;
        if (digits.length < 4) return false;
        // any of the phone numbers, or the CCCD
        return String(p.phone).split(',').some(function (ph) { return ph.replace(/\D/g, '').indexOf(digits) >= 0; })
          || String(p.national_id).indexOf(digits) >= 0;
      }).sort(function (a, b) { return String(a.name_search).localeCompare(String(b.name_search)); }).slice(0, 50);
    }
    return res.map(function (p) {
      return { patient_id: p.patient_id, full_name: p.full_name, birth_year: p.birth_year, phone: p.phone, allergies: p.allergies,
        national_id: p.national_id, avatar_id: p.avatar_id, dob: p.dob, gender: p.gender };
    });
  });
}

function getPatient(id) {
  return api_('getPatient', function () {
    var p = mustFindActive_('Patients', 'patient_id', id, 'Bệnh nhân');
    var visits = readActive_('Visits').filter(function (v) { return v.patient_id === id; })
      .sort(function (a, b) { return String(b.visit_date).localeCompare(String(a.visit_date)); });
    var imgs = readActive_('Images').filter(function (i) { return i.patient_id === id; });
    visits.forEach(function (v) {
      v.images = imgs.filter(function (i) { return i.visit_id === v.visit_id; }).map(publicImage_);
      delete v._row;
    });
    var appts = readActive_('Appointments').filter(function (a) { return a.patient_id === id; });
    visits.forEach(function (v) {
      v.appointment = appts.filter(function (a) { return a.visit_id === v.visit_id; }).map(publicAppointment_)[0] || null;
    });
    var today = today_();
    var upcoming = sortAppointments(appts.filter(function (a) { return a.appt_date >= today && a.status !== 'cancelled'; }))
      .map(publicAppointment_);
    return { patient: publicPatient_(p), visits: visits, appointments: upcoming };
  });
}

function savePatient(data) {
  return api_('savePatient', function () {
    var res = validatePatient(data || {}, new Date().getFullYear());
    if (res.errors.length) throw new Error(res.errors.join('; '));
    var v = res.value;
    v.name_search = normalizeText(v.full_name);
    return withLock_(function () {
      if (v.national_id) {
        var dup = readActive_('Patients').filter(function (x) { return x.national_id === v.national_id && x.patient_id !== data.patient_id; })[0];
        if (dup) throw new Error('Số CCCD ' + v.national_id + ' đã thuộc hồ sơ ' + dup.patient_id + ' (' + dup.full_name + ')');
      }
      if (data.patient_id) {
        var p = mustFindActive_('Patients', 'patient_id', data.patient_id, 'Bệnh nhân');
        Object.keys(v).forEach(function (k) { p[k] = v[k]; });
        p.updated_at = now_();
        updateRow_('Patients', p);
        return p.patient_id;
      }
      var newId = reserveIds_(new Date().getFullYear(), 1)[0];
      v.patient_id = newId;
      v.folder_id = createPatientFolder_(newId, v.full_name).getId();
      v.created_at = v.updated_at = now_();
      v.deleted = false;
      appendRows_('Patients', [v]);
      return newId;
    });
  });
}

function createPatientFolder_(id, name) {
  return DriveApp.getFolderById(cfg_().PATIENTS_FOLDER_ID).createFolder(id + '_' + folderSafeName(name));
}

/** Soft delete: dữ liệu vẫn còn trong Sheet/Drive. */
function deletePatient(id) {
  return api_('deletePatient', function () {
    return withLock_(function () {
      var p = mustFindActive_('Patients', 'patient_id', id, 'Bệnh nhân');
      p.deleted = true; p.updated_at = now_();
      updateRow_('Patients', p);
      return true;
    });
  });
}

/** Upload target for the portrait (patient folder) + token; avatar is a small JPEG compressed in the browser. */
function getAvatarUploadContext(patientId) {
  return api_('getAvatarUploadContext', function () {
    return withLock_(function () {
      var p = mustFindActive_('Patients', 'patient_id', patientId, 'Bệnh nhân');
      if (!p.folder_id) { p.folder_id = createPatientFolder_(p.patient_id, p.full_name).getId(); updateRow_('Patients', p); }
      return { folderId: p.folder_id, token: ScriptApp.getOAuthToken() };
    });
  });
}

/** Sets the uploaded file as avatar (must sit in the patient folder); the previous portrait goes to Drive trash. */
function setPatientAvatar(patientId, fileId) {
  return api_('setPatientAvatar', function () {
    return withLock_(function () {
      var p = mustFindActive_('Patients', 'patient_id', patientId, 'Bệnh nhân');
      var meta = Drive.Files.get(fileId, { fields: 'id,parents' });
      if ((meta.parents || []).indexOf(p.folder_id) < 0) throw new Error('Ảnh không nằm trong thư mục bệnh nhân');
      if (p.avatar_id && p.avatar_id !== fileId) {
        try { DriveApp.getFileById(p.avatar_id).setTrashed(true); } catch (e) { console.warn('old avatar already gone'); }
      }
      p.avatar_id = fileId; p.updated_at = now_();
      updateRow_('Patients', p);
      return true;
    });
  });
}
