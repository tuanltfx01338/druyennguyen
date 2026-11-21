function getVisit(id) {
  return api_('getVisit', function () {
    var v = mustFindActive_('Visits', 'visit_id', id, 'Lần khám');
    var p = mustFindActive_('Patients', 'patient_id', v.patient_id, 'Bệnh nhân');
    v.images = readActive_('Images').filter(function (i) { return i.visit_id === id; }).map(publicImage_);
    delete v._row;
    return { visit: v, patient: { patient_id: p.patient_id, full_name: p.full_name, allergies: p.allergies } };
  });
}

function saveVisit(data) {
  return api_('saveVisit', function () {
    data = data || {};
    var res = validateVisit(data);
    if (res.errors.length) throw new Error(res.errors.join('; '));
    var v = res.value;
    return withLock_(function () {
      if (data.visit_id) {
        var old = mustFindActive_('Visits', 'visit_id', data.visit_id, 'Lần khám');
        Object.keys(v).forEach(function (k) { old[k] = v[k]; });
        old.updated_at = now_();
        updateRow_('Visits', old);
        touchPatient_(old.patient_id);
        return old.visit_id;
      }
      mustFindActive_('Patients', 'patient_id', data.patient_id, 'Bệnh nhân');
      v.visit_id = Utilities.getUuid();
      v.patient_id = data.patient_id;
      v.source = 'app';
      v.folder_id = ''; // created lazily on first image upload
      v.created_at = v.updated_at = now_();
      v.deleted = false;
      appendRows_('Visits', [v]);
      touchPatient_(v.patient_id);
      return v.visit_id;
    });
  });
}

function touchPatient_(id) {
  var p = findBy_('Patients', 'patient_id', id);
  if (p) { p.updated_at = now_(); updateRow_('Patients', p); }
}

function deleteVisit(id) {
  return api_('deleteVisit', function () {
    return withLock_(function () {
      var v = mustFindActive_('Visits', 'visit_id', id, 'Lần khám');
      v.deleted = true; v.updated_at = now_();
      updateRow_('Visits', v);
      return true;
    });
  });
}

/** Visits within [from, to] (yyyy-mm-dd), with patient name. */
function searchVisitsByDate(from, to) {
  return api_('searchVisitsByDate', function () {
    if (!isValidDateStr(from) || !isValidDateStr(to)) throw new Error('Khoảng ngày không hợp lệ');
    var names = {};
    readActive_('Patients').forEach(function (p) { names[p.patient_id] = p.full_name; });
    return readActive_('Visits').filter(function (v) {
      return names[v.patient_id] && v.visit_date >= from && v.visit_date <= to;
    }).sort(function (a, b) { return String(b.visit_date).localeCompare(String(a.visit_date)); })
      .slice(0, 300).map(function (v) {
        return { visit_id: v.visit_id, patient_id: v.patient_id, full_name: names[v.patient_id],
          visit_date: v.visit_date, diagnosis: v.diagnosis, treatment: v.treatment };
      });
  });
}

/** Appointments from today to today+7, one (latest) per patient. */
function getUpcomingAppointments() {
  return api_('getUpcomingAppointments', function () {
    var from = today_();
    var to = Utilities.formatDate(new Date(Date.now() + 7 * 864e5), TZ, 'yyyy-MM-dd');
    var names = {};
    readActive_('Patients').forEach(function (p) { names[p.patient_id] = p; });
    var byPatient = {};
    readActive_('Visits').forEach(function (v) {
      if (!names[v.patient_id] || !v.next_appointment || v.next_appointment < from || v.next_appointment > to) return;
      var cur = byPatient[v.patient_id];
      if (!cur || v.visit_date > cur.visit_date) byPatient[v.patient_id] = v;
    });
    return Object.keys(byPatient).map(function (pid) {
      var v = byPatient[pid];
      return { patient_id: pid, full_name: names[pid].full_name, phone: names[pid].phone,
        next_appointment: v.next_appointment, plan: v.plan };
    }).sort(function (a, b) { return a.next_appointment.localeCompare(b.next_appointment); });
  });
}
