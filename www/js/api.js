/*
 * AdviSlot mock API. Behaves like the REST API in the handoff (section 7):
 * every call returns a Promise, waits about 300 ms, then resolves to { status, data }
 * or rejects with { status, message } (422s also carry a `field`).
 * When navigator.onLine is false it rejects with { status: 0, message: "You're offline" }.
 * All checks run here on the "server" side, not only in the forms.
 * The UI talks to this module only, never to the database directly.
 */
(function () {
  'use strict';

  var DELAY = 300;
  var SESSION_KEY = 'advislot_session';
  var SCHOOL_EMAIL = /^[^\s@]+@school\.edu\.ph$/i;
  var PHONE = /^09\d{9}$/;
  var TIME = /^\d{2}:\d{2}$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var MSG_TAKEN = 'This slot was just booked by another group. Please pick another time.';

  // ---------- helpers ----------
  function ok(status, data) { return { status: status, data: data }; }
  function fail(status, message, field) {
    var e = { status: status, message: message };
    if (field) e.field = field;
    return e;
  }

  function respond(handler) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (!navigator.onLine) { reject(fail(0, "You're offline")); return; }
        try {
          resolve(handler(DB.load()));
        } catch (e) {
          if (e && typeof e.status === 'number') reject(e);
          else reject(fail(500, 'Something went wrong. Please try again.'));
        }
      }, DELAY);
    });
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function startOf(c) {
    var d = c.consult_date.split('-'), t = c.start_time.split(':');
    return new Date(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
  }
  function sortKey(c) { return c.consult_date + ' ' + c.start_time; }
  function byTimeAsc(a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : a.consultation_id - b.consultation_id; }
  function byTimeDesc(a, b) { return byTimeAsc(b, a); }

  function findStudent(db, id) { return db.Student.find(function (s) { return s.student_id === id; }) || null; }
  function findAdviser(db, id) { return db.Adviser.find(function (a) { return a.adviser_id === id; }) || null; }
  function findRow(db, id) { return db.Consultation.find(function (c) { return c.consultation_id === Number(id); }) || null; }

  // Group visibility (FR-08): every student with the same group_name and adviser_id.
  function groupIds(db, student) {
    return db.Student.filter(function (s) {
      return s.group_name === student.group_name && s.adviser_id === student.adviser_id;
    }).map(function (s) { return s.student_id; });
  }

  // Consultation + adviser name + booked-by name + group name.
  function view(db, c) {
    var adviser = findAdviser(db, c.adviser_id);
    var student = c.student_id ? findStudent(db, c.student_id) : null;
    return Object.assign({}, c, {
      adviser_name: adviser ? adviser.full_name : '',
      booked_by_name: student ? student.full_name : null,
      group_name: student ? student.group_name : null
    });
  }

  // A slot as another group sees it: time and place only, no topic, notes, or names.
  function publicView(db, c) {
    var v = view(db, c);
    v.student_id = null; v.topic = null; v.student_notes = null; v.adviser_notes = null;
    v.booked_by_name = null; v.group_name = null; v.booked_at = null;
    return v;
  }

  function userFor(db, role, id) {
    if (role === 'student') {
      var s = findStudent(db, id);
      if (!s) return null;
      return Object.assign({}, s, { adviser: Object.assign({}, findAdviser(db, s.adviser_id)) });
    }
    var a = findAdviser(db, id);
    return a ? Object.assign({}, a) : null;
  }

  // NFR-02: must be signed in; optionally a specific role.
  function auth(db, role) {
    var s = readSession();
    var user = s ? userFor(db, s.role, s.id) : null;
    if (!user) throw fail(401, 'Please sign in.');
    if (role && s.role !== role) throw fail(403, "You don't have access to this.");
    return { role: s.role, user: user };
  }

  function todayISO() { return DB.isoDate(new Date()); }

  // ---------- endpoints ----------
  var api = {};

  // POST /api/login { email, password }
  api.login = function (body) {
    return respond(function (db) {
      var email = String((body && body.email) || '').trim().toLowerCase();
      var password = String((body && body.password) || '');
      if (!SCHOOL_EMAIL.test(email)) throw fail(422, 'Enter a valid school email (ex. name@school.edu.ph)', 'email');
      if (!password) throw fail(422, 'Enter your password.', 'password');
      var acc = DB.accounts.find(function (a) { return a.email === email && a.password === password; });
      if (!acc) throw fail(401, 'Wrong email or password.');
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ role: acc.role, id: acc.id })); } catch (e) { /* ignore */ }
      return ok(200, { user: userFor(db, acc.role, acc.id), role: acc.role });
    });
  };

  // Sign out (ends the mock session on this device).
  api.logout = function () {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    return Promise.resolve(ok(200, null));
  };

  // Current session, read on the device so the app opens signed in (and offline).
  api.session = function () {
    var s = readSession();
    if (!s) return null;
    var user = userFor(DB.load(), s.role, s.id);
    return user ? { role: s.role, user: user } : null;
  };

  // GET /api/students/:id/home -> { next, past }
  api.getHome = function (studentId) {
    return respond(function (db) {
      var me = auth(db, 'student');
      if (me.user.student_id !== studentId) throw fail(403, "You don't have access to this.");
      var ids = groupIds(db, me.user);
      var now = new Date();
      var mine = db.Consultation.filter(function (c) {
        return c.adviser_id === me.user.adviser_id && c.student_id && ids.indexOf(c.student_id) !== -1;
      });
      var upcoming = mine.filter(function (c) { return c.status === 'Booked' && startOf(c) > now; }).sort(byTimeAsc);
      var past = mine.filter(function (c) {
        return c.status === 'Done' || c.status === 'No-show' || (c.status === 'Booked' && startOf(c) <= now);
      }).sort(byTimeDesc);
      return ok(200, {
        next: upcoming.length ? view(db, upcoming[0]) : null,
        past: past.map(function (c) { return view(db, c); })
      });
    });
  };

  // GET /api/slots?adviser_id=&from=&to=  (all statuses, sorted by date + time)
  api.getSlots = function (q) {
    q = q || {};
    return respond(function (db) {
      var me = auth(db);
      var adviserId = Number(q.adviser_id);
      if (adviserId !== me.user.adviser_id) throw fail(403, "You don't have access to this.");
      var ids = me.role === 'student' ? groupIds(db, me.user) : null;
      var rows = db.Consultation.filter(function (c) {
        return c.adviser_id === adviserId &&
          (!q.from || c.consult_date >= q.from) &&
          (!q.to || c.consult_date <= q.to);
      }).sort(byTimeAsc);
      return ok(200, rows.map(function (c) {
        if (me.role === 'adviser' || !c.student_id || ids.indexOf(c.student_id) !== -1) return view(db, c);
        return publicView(db, c);
      }));
    });
  };

  // POST /api/bookings { consultation_id, student_id, topic, student_notes }
  api.book = function (body) {
    body = body || {};
    return respond(function (db) {
      var me = auth(db, 'student');
      if (body.student_id !== me.user.student_id) throw fail(403, "You don't have access to this.");
      var topic = String(body.topic || '').trim();
      var notes = String(body.student_notes || '').trim();
      if (!topic) throw fail(422, 'Please add a topic so your adviser can prepare.', 'topic');
      if (topic.length > 150) throw fail(422, 'Topic is too long (max 150 characters).', 'topic');
      if (notes.length > 300) throw fail(422, 'Notes are too long (max 300 characters).', 'student_notes');
      var row = findRow(db, body.consultation_id);
      if (!row || row.adviser_id !== me.user.adviser_id) throw fail(404, 'This slot no longer exists.');
      if (row.status !== 'Open') throw fail(409, MSG_TAKEN);
      if (startOf(row) <= new Date()) throw fail(409, 'This slot has already started. Please pick another time.');
      row.student_id = me.user.student_id;
      row.topic = topic;
      row.student_notes = notes || null;
      row.status = 'Booked';
      row.booked_at = new Date().toISOString();
      DB.save(db);
      return ok(201, view(db, row));
    });
  };

  // POST /api/bookings/:id/cancel -> { cancelled, reopened }
  api.cancel = function (id) {
    return respond(function (db) {
      var me = auth(db, 'student');
      var row = findRow(db, id);
      var ids = groupIds(db, me.user);
      if (!row || row.status !== 'Booked' || ids.indexOf(row.student_id) === -1) throw fail(404, 'Booking not found.');
      if (Date.now() > startOf(row).getTime() - 2 * 3600 * 1000) throw fail(403, 'You can only cancel up to 2 hours before.');
      row.status = 'Cancelled';
      var reopened = Object.assign(DB.blankRow(), {
        consultation_id: db.next_id++,
        adviser_id: row.adviser_id,
        consult_date: row.consult_date,
        start_time: row.start_time,
        end_time: row.end_time,
        mode: row.mode,
        venue_or_link: row.venue_or_link
      });
      db.Consultation.push(reopened);
      DB.save(db);
      return ok(200, { cancelled: view(db, row), reopened: view(db, reopened) });
    });
  };

  // GET /api/consultations/:id -> Consultation + adviser name + booked-by name
  api.getConsultation = function (id) {
    return respond(function (db) {
      var me = auth(db);
      var row = findRow(db, id);
      if (!row) throw fail(404, 'Consultation not found.');
      if (me.role === 'student') {
        var ids = groupIds(db, me.user);
        if (!row.student_id || ids.indexOf(row.student_id) === -1) throw fail(404, 'Consultation not found.');
      } else if (row.adviser_id !== me.user.adviser_id) {
        throw fail(404, 'Consultation not found.');
      }
      return ok(200, view(db, row));
    });
  };

  // POST /api/slots (adviser) { consult_date, start_time, end_time, mode, venue_or_link }
  api.postSlot = function (body) {
    body = body || {};
    return respond(function (db) {
      var me = auth(db, 'adviser');
      var date = String(body.consult_date || '');
      var start = String(body.start_time || '');
      var end = String(body.end_time || '');
      var mode = body.mode;
      var venue = String(body.venue_or_link || '').trim();
      var today = todayISO();
      var last = DB.isoDate(DB.addDays(new Date(), 13));
      if (!DATE.test(date) || date < today) throw fail(422, 'Pick a date from today onward.', 'consult_date');
      if (date > last) throw fail(422, 'Pick a date within the next 14 days.', 'consult_date');
      if (!TIME.test(start)) throw fail(422, 'Pick a start time.', 'start_time');
      if (!TIME.test(end)) throw fail(422, 'Pick an end time.', 'end_time');
      if (end <= start) throw fail(422, 'End time must be later than start time.', 'end_time');
      var probe = { consult_date: date, start_time: start };
      if (startOf(probe) <= new Date()) throw fail(422, 'This time has already passed.', 'start_time');
      if (mode !== 'Face-to-face' && mode !== 'Online') throw fail(422, 'Pick a mode.', 'mode');
      if (!venue) throw fail(422, 'Add a room or meeting link.', 'venue_or_link');
      if (venue.length > 150) throw fail(422, 'Room or link is too long (max 150 characters).', 'venue_or_link');
      var clash = db.Consultation.some(function (c) {
        return c.adviser_id === me.user.adviser_id && c.consult_date === date && c.status !== 'Cancelled' &&
          start < c.end_time && end > c.start_time;
      });
      if (clash) throw fail(422, 'This time overlaps another slot.', 'start_time');
      var row = Object.assign(DB.blankRow(), {
        consultation_id: db.next_id++,
        adviser_id: me.user.adviser_id,
        consult_date: date, start_time: start, end_time: end, mode: mode, venue_or_link: venue
      });
      db.Consultation.push(row);
      DB.save(db);
      return ok(201, view(db, row));
    });
  };

  // PATCH /api/consultations/:id (adviser) { adviser_notes?, status?: "Done" | "No-show" }
  api.updateConsultation = function (id, body) {
    body = body || {};
    return respond(function (db) {
      var me = auth(db, 'adviser');
      var row = findRow(db, id);
      if (!row || row.adviser_id !== me.user.adviser_id) throw fail(404, 'Consultation not found.');
      if (['Booked', 'Done', 'No-show'].indexOf(row.status) === -1) throw fail(422, 'Only booked consultations can be updated.');
      if (body.status !== undefined) {
        if (body.status !== 'Done' && body.status !== 'No-show') throw fail(422, 'Status must be Done or No-show.', 'status');
        if (startOf(row) > new Date()) throw fail(422, 'You can mark this after the session starts.', 'status');
      }
      if (body.adviser_notes !== undefined) {
        var notes = String(body.adviser_notes || '').trim();
        row.adviser_notes = notes || null;
      }
      if (body.status !== undefined) row.status = body.status;
      DB.save(db);
      return ok(200, view(db, row));
    });
  };

  // PATCH /api/students/:id { contact_no }
  api.updateStudent = function (id, body) {
    body = body || {};
    return respond(function (db) {
      var me = auth(db, 'student');
      if (me.user.student_id !== id) throw fail(403, "You don't have access to this.");
      var raw = String(body.contact_no || '').replace(/\s+/g, '');
      if (raw && !PHONE.test(raw)) throw fail(422, 'Enter an 11-digit number starting with 09.', 'contact_no');
      var s = findStudent(db, id);
      s.contact_no = raw || null;
      DB.save(db);
      return ok(200, Object.assign({}, s));
    });
  };

  api.startOf = startOf;
  window.api = api;
})();
