/** Lịch hẹn: mỗi hẹn có ngày, giờ (có thể trống = chưa đặt giờ), thời lượng dự kiến, trạng thái. */

function publicAppointment_(a) {
  var o = {};
  TABLES.Appointments.forEach(function (c) { o[c] = a[c]; });
  return o;
}

function linkedAppointment_(visitId) {
  var a = readActive_('Appointments').filter(function (x) { return x.visit_id === visitId; })[0];
  return a ? publicAppointment_(a) : null;
}

/** Validates + writes (no lock — callers hold it). Returns {appt_id, conflicts:[…]}. */
function upsertAppointment_(data) {
  var res = validateAppointment(data);
  if (res.errors.length) throw new Error(res.errors.join('; '));
  var v = res.value;
  mustFindActive_('Patients', 'patient_id', v.patient_id, 'Bệnh nhân');
  var a;
  if (data.appt_id) {
    a = mustFindActive_('Appointments', 'appt_id', data.appt_id, 'Lịch hẹn');
    Object.keys(v).forEach(function (k) { a[k] = v[k]; });
    a.updated_at = now_();
    updateRow_('Appointments', a);
  } else {
    a = v;
    a.appt_id = Utilities.getUuid();
    a.visit_id = data.visit_id || '';
    a.created_at = a.updated_at = now_();
    a.deleted = false;
    appendRows_('Appointments', [a]);
  }
  var names = {};
  readActive_('Patients').forEach(function (p) { names[p.patient_id] = p.full_name; });
  var conflicts = findConflicts(readActive_('Appointments'), a).map(function (c) {
    return (names[c.patient_id] || c.patient_id) + ' ' + c.start_time;
  });
  return { appt_id: a.appt_id, conflicts: conflicts };
}

/** Appointments with appt_date in [from, to], with patient name/phone. */
function listAppointments(from, to) {
  return api_('listAppointments', function () {
    if (!isValidDateStr(from) || !isValidDateStr(to)) throw new Error('Khoảng ngày không hợp lệ');
    var pats = {};
    readActive_('Patients').forEach(function (p) { pats[p.patient_id] = p; });
    return sortAppointments(readActive_('Appointments').filter(function (a) {
      return pats[a.patient_id] && a.appt_date >= from && a.appt_date <= to;
    })).map(function (a) {
      var o = publicAppointment_(a);
      o.full_name = pats[a.patient_id].full_name;
      o.phone = pats[a.patient_id].phone;
      o.allergies = pats[a.patient_id].allergies;
      o.avatar_id = pats[a.patient_id].avatar_id;
      o.info_pending = pats[a.patient_id].info_pending || '';
      return o;
    });
  });
}

function getAppointment(id) {
  return api_('getAppointment', function () {
    var a = mustFindActive_('Appointments', 'appt_id', id, 'Lịch hẹn');
    var p = mustFindActive_('Patients', 'patient_id', a.patient_id, 'Bệnh nhân');
    return { appointment: publicAppointment_(a), patient: { patient_id: p.patient_id, full_name: p.full_name, phone: p.phone, allergies: p.allergies, avatar_id: p.avatar_id, info_pending: p.info_pending || '' } };
  });
}

/**
 * data.new_patient = { full_name, phone } when the patient is not in the database yet:
 * reuse the patient whose phone matches, otherwise create a placeholder record (info_pending = '1')
 * to be completed at the first visit.
 */
function saveAppointment(data) {
  return api_('saveAppointment', function () {
    data = data || {};
    return withLock_(function () {
      var created = null, reused = null;
      // No patient picked = booking for someone not on file yet, even with nothing typed.
      if (!data.patient_id) {
        // Validate the appointment before creating anyone, so a bad date never leaves an orphan patient.
        var check = validateAppointment(Object.assign({}, data, { patient_id: 'pending' }));
        if (check.errors.length) throw new Error(check.errors.join('; '));
        var q = validateQuickPatient(data.new_patient || {});
        if (q.errors.length) throw new Error(q.errors.join('; '));
        var existing = q.value.phone ? findPatientByPhone(readActive_('Patients'), q.value.phone) : null;
        if (existing) {
          reused = { patient_id: existing.patient_id, full_name: existing.full_name };
          data = Object.assign({}, data, { patient_id: existing.patient_id });
        } else {
          var p = createQuickPatient_(q.value);
          created = { patient_id: p.patient_id, full_name: p.full_name };
          data = Object.assign({}, data, { patient_id: p.patient_id });
        }
      }
      var r = upsertAppointment_(data);
      r.created_patient = created;
      r.reused_patient = reused;
      return r;
    });
  });
}

function setAppointmentStatus(id, status) {
  return api_('setAppointmentStatus', function () {
    if (APPT_STATUSES.indexOf(status) < 0) throw new Error('Trạng thái không hợp lệ');
    return withLock_(function () {
      var a = mustFindActive_('Appointments', 'appt_id', id, 'Lịch hẹn');
      a.status = status; a.updated_at = now_();
      updateRow_('Appointments', a);
      return true;
    });
  });
}

function deleteAppointment(id) {
  return api_('deleteAppointment', function () {
    return withLock_(function () {
      var a = mustFindActive_('Appointments', 'appt_id', id, 'Lịch hẹn');
      a.deleted = true; a.updated_at = now_();
      updateRow_('Appointments', a);
      return true;
    });
  });
}
