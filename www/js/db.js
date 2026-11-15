/*
 * AdviSlot "database".
 * Three tables (Adviser, Student, Consultation) stored in localStorage under "advislot_db".
 * Field names match the Activity 5 data dictionary, plus Consultation.student_notes.
 * Seed data is created once, on first launch, with dates relative to that day.
 */
(function () {
  'use strict';

  var KEY = 'advislot_db';
  var VERSION = 1;
  var PASSWORD = 'advislot123';
  var MEET_LINK = 'meet.google.com/abc-defg-hij';

  var ADVISERS = [
    { adviser_id: 1, full_name: 'Prof. Maria Reyes', email: 'maria.reyes@school.edu.ph', department: 'Computer Engineering', office: 'Faculty Room 2' },
    { adviser_id: 2, full_name: 'Engr. Paolo Santos', email: 'paolo.santos@school.edu.ph', department: 'Computer Engineering', office: 'Faculty Room 3' }
  ];

  var STUDENTS = [
    { student_id: '2022-01234', full_name: 'Juan Dela Cruz', email: 'juan.delacruz@school.edu.ph', program: 'BSCpE 4-A', group_name: 'Group 4', contact_no: '09171234567', adviser_id: 1 },
    { student_id: '2022-01567', full_name: 'Ana Lim', email: 'ana.lim@school.edu.ph', program: 'BSCpE 4-A', group_name: 'Group 4', contact_no: '09181112222', adviser_id: 1 },
    { student_id: '2022-02011', full_name: 'Mark Villanueva', email: 'mark.villanueva@school.edu.ph', program: 'BSCpE 4-B', group_name: 'Group 2', contact_no: null, adviser_id: 1 },
    { student_id: '2022-03100', full_name: 'Bea Ramos', email: 'bea.ramos@school.edu.ph', program: 'BSCpE 4-B', group_name: 'Group 7', contact_no: null, adviser_id: 2 }
  ];

  // Mock sign-in list. Not an Activity 5 table; a real app would use an auth service.
  var ACCOUNTS = STUDENTS.map(function (s) {
    return { email: s.email, password: PASSWORD, role: 'student', id: s.student_id };
  }).concat(ADVISERS.map(function (a) {
    return { email: a.email, password: PASSWORD, role: 'adviser', id: a.adviser_id };
  }));

  // Daily slot pattern: [start, end, mode]
  var DAILY_SLOTS = [
    ['09:00', '09:30', 'Face-to-face'],
    ['10:00', '10:30', 'Online'],
    ['13:00', '13:30', 'Online'],
    ['14:00', '14:30', 'Face-to-face'],
    ['15:00', '15:30', 'Online']
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function isWeekday(d) { var w = d.getDay(); return w !== 0 && w !== 6; }
  function at(d, hhmm) {
    var p = hhmm.split(':');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0], +p[1]);
  }

  function blankRow() {
    return {
      consultation_id: 0, adviser_id: 0, student_id: null,
      consult_date: '', start_time: '', end_time: '', mode: '', venue_or_link: '',
      topic: null, status: 'Open', adviser_notes: null, booked_at: null, student_notes: null
    };
  }

  function seed(now) {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var rows = [];
    var nextId = 1;
    function add(fields) {
      var r = Object.assign(blankRow(), fields, { consultation_id: nextId++ });
      rows.push(r);
      return r;
    }
    var reyes = ADVISERS[0];

    // Group 4 history: Done, Prof. Reyes, 1:00-1:30 PM Face-to-face.
    var history = [
      [18, 'Topic approval', '2022-01234', 'Topic approved.\nStart on Chapter 1 and list your target respondents.'],
      [11, 'Title defense prep', '2022-01567', 'Practice the 5-minute pitch, cut slide 4.\nPrepare answers for the feasibility questions.'],
      [4, 'Chapter 2 revisions', '2022-01234', 'Scope and limitations is too broad, narrow it down.\nAdd at least 3 related studies from 2022 onwards.\nRedo the conceptual framework diagram.']
    ];
    history.forEach(function (h) {
      var d = addDays(today, -h[0]);
      add({
        adviser_id: 1, student_id: h[2], consult_date: isoDate(d),
        start_time: '13:00', end_time: '13:30', mode: 'Face-to-face', venue_or_link: reyes.office,
        topic: h[1], status: 'Done', adviser_notes: h[3],
        booked_at: at(addDays(d, -2), '09:15').toISOString()
      });
    });

    // Adviser demo: last weekday before today, 2:00-2:30 PM, Group 2, Booked, no notes.
    var demo = addDays(today, -1);
    while (!isWeekday(demo)) demo = addDays(demo, -1);
    add({
      adviser_id: 1, student_id: '2022-02011', consult_date: isoDate(demo),
      start_time: '14:00', end_time: '14:30', mode: 'Face-to-face', venue_or_link: reyes.office,
      topic: 'Chapter 3 outline', status: 'Booked',
      booked_at: at(addDays(demo, -3), '10:20').toISOString()
    });

    // Group 2's taken slots: 1st and 3rd weekday after today, 10:00 AM and 3:00 PM with Prof. Reyes.
    var weekdaysAhead = [];
    for (var i = 1; weekdaysAhead.length < 3; i++) {
      var w = addDays(today, i);
      if (isWeekday(w)) weekdaysAhead.push(isoDate(w));
    }
    var takenDays = [weekdaysAhead[0], weekdaysAhead[2]];
    var takenTopics = { '10:00': 'Chapter 1 revisions', '15:00': 'Survey questionnaire check' };

    // Open slots: each adviser, every weekday from today to today + 13. Skip slots already started.
    for (var n = 0; n <= 13; n++) {
      var day = addDays(today, n);
      if (!isWeekday(day)) continue;
      ADVISERS.forEach(function (a) {
        DAILY_SLOTS.forEach(function (s) {
          if (at(day, s[0]) <= now) return;
          var row = add({
            adviser_id: a.adviser_id, consult_date: isoDate(day),
            start_time: s[0], end_time: s[1], mode: s[2],
            venue_or_link: s[2] === 'Online' ? MEET_LINK : a.office
          });
          if (a.adviser_id === 1 && takenDays.indexOf(row.consult_date) !== -1 && takenTopics[s[0]]) {
            row.student_id = '2022-02011';
            row.topic = takenTopics[s[0]];
            row.status = 'Booked';
            row.booked_at = new Date(now.getTime() - 86400000).toISOString();
          }
        });
      });
    }

    return {
      version: VERSION,
      seeded_on: isoDate(today),
      next_id: nextId,
      Adviser: ADVISERS.map(function (a) { return Object.assign({}, a); }),
      Student: STUDENTS.map(function (s) { return Object.assign({}, s); }),
      Consultation: rows
    };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (raw) {
      try {
        var db = JSON.parse(raw);
        if (db && db.version === VERSION) return db;
      } catch (e) { /* fall through and re-seed */ }
    }
    var fresh = seed(new Date());
    save(fresh);
    return fresh;
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked */ }
  }

  window.DB = {
    load: load,
    save: save,
    accounts: ACCOUNTS,
    blankRow: blankRow,
    isoDate: isoDate,
    addDays: addDays,
    isWeekday: isWeekday
  };
})();
