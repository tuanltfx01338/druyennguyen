function getVisit(id) {
  return api_('getVisit', function () {
    var v = mustFindActive_('Visits', 'visit_id', id, 'Lần khám');
    var p = mustFindActive_('Patients', 'patient_id', v.patient_id, 'Bệnh nhân');
    v.images = readActive_('Images').filter(function (i) { return i.visit_id === id; }).map(publicImage_);
    v.appointment = linkedAppointment_(id);
    delete v._row;
    return { visit: v, patient: { patient_id: p.patient_id, full_name: p.full_name, allergies: p.allergies } };
  });
}

/**
 * data.appointment (optional): {appt_date, start_time, duration_min, title} — the follow-up appointment
 * booked during this visit; creates it or updates the one already linked to the visit.
 */
function saveVisit(data) {
  return api_('saveVisit', function () {
    data = data || {};
    var res = validateVisit(data);
    if (res.errors.length) throw new Error(res.errors.join('; '));
    var v = res.value;
    delete v.next_appointment; // replaced by the Appointments table
    var ap = data.appointment && data.appointment.appt_date ? data.appointment : null;
    return withLock_(function () {
      var visit;
      if (data.visit_id) {
        visit = mustFindActive_('Visits', 'visit_id', data.visit_id, 'Lần khám');
        Object.keys(v).forEach(function (k) { visit[k] = v[k]; });
        visit.updated_at = now_();
        updateRow_('Visits', visit);
      } else {
        mustFindActive_('Patients', 'patient_id', data.patient_id, 'Bệnh nhân');
        visit = v;
        v.visit_id = Utilities.getUuid();
        v.patient_id = data.patient_id;
        v.source = 'app';
        v.folder_id = ''; // created lazily on first image upload
        v.created_at = v.updated_at = now_();
        v.deleted = false;
        appendRows_('Visits', [v]);
      }
      if (ap) {
        var linked = linkedAppointment_(visit.visit_id);
        upsertAppointment_(Object.assign({}, linked || {}, ap, { patient_id: visit.patient_id, visit_id: visit.visit_id,
          appt_id: linked ? linked.appt_id : '', status: linked ? linked.status : 'scheduled' }));
      }
      touchPatient_(visit.patient_id);
      return visit.visit_id;
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

/** Landing page: today's work, appointments, 6-month trend, debts. */
function getDashboard() {
  return api_('getDashboard', function () {
    return buildDashboard(readActive_('Patients'), readActive_('Visits'), today_(), readActive_('Appointments'));
  });
}
