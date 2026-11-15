/*
 * AdviSlot UI: screens, navigation, validation, offline banner, reminders.
 * Talks to the data only through window.api (js/api.js).
 * Device-only storage here: preferences (reminders_on, photo), and the offline cache.
 */
(function () {
  'use strict';

  // ---------- Capacitor plugins (optional, so the app also runs in a desktop browser) ----------
  var Cap = window.Capacitor;
  var isNative = false;
  try { isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform()); } catch (e) { isNative = false; }
  function plugin(name) {
    try { return (isNative && Cap.Plugins && Cap.Plugins[name]) || null; } catch (e) { return null; }
  }

  var $app = document.getElementById('app');
  var $nav = document.getElementById('nav');
  var $sheet = document.getElementById('sheet');
  var $toast = document.getElementById('toast');
  var $offline = document.getElementById('offline');
  function $(sel) { return $app.querySelector(sel); }

  // ---------- state ----------
  var me = null;          // { role, user } from api.session()
  var stack = [];         // navigation stack: [{ name, params }]
  var seq = 0;            // render token, ignores late responses for screens we already left
  var netHandler = null;  // screen-specific online/offline handler (forms keep what was typed)
  var ui = { bookDay: null };

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parseDate(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return DB.isoDate(d); }
  function t12(hhmm) {
    var p = hhmm.split(':'), h = +p[0];
    return { text: ((h % 12) || 12) + ':' + p[1], ampm: h < 12 ? 'AM' : 'PM' };
  }
  function timeRange(s, e) {
    var a = t12(s), b = t12(e);
    return a.ampm === b.ampm ? a.text + ' – ' + b.text + ' ' + b.ampm : a.text + ' ' + a.ampm + ' – ' + b.text + ' ' + b.ampm;
  }
  function clock(d) { var h = d.getHours(); return ((h % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function dayShort(isoDate) { var d = parseDate(isoDate); return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function dayLong(isoDate) { return dayShort(isoDate) + ', ' + parseDate(isoDate).getFullYear(); }
  function startOf(c) { return api.startOf(c); }
  function phoneDisplay(n) { return n ? n.slice(0, 4) + ' ' + n.slice(4, 7) + ' ' + n.slice(7) : 'Not set'; }
  function firstName(full) { return String(full).split(/\s+/)[0]; }
  function initials(full) {
    var w = String(full).split(/\s+/).filter(function (x) { return x && !/\.$/.test(x); });
    return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase();
  }
  function shortTitle(full) { // "Prof. Maria Reyes" -> "Prof. Reyes"
    var w = String(full).split(/\s+/);
    return (/\.$/.test(w[0]) ? w[0] + ' ' : '') + w[w.length - 1];
  }
  function noteLines(text) { return String(text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function online() { return navigator.onLine; }

  // ---------- icons (inline SVG, decorative) ----------
  function svg(body, size, extra) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' +
      (extra || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  var P = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
  };
  var ICON = {
    back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 20),
    chev: svg('<path d="M9 6l6 6-6 6"/>', 18),
    check: svg(P.check, 12, 3),
    checkBig: svg(P.check, 32, 3),
    checkToast: svg(P.check, 18, 2.5),
    lock: svg(P.lock, 12, 2.5),
    lockField: svg(P.lock, 18),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 12, 3),
    slash: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 18.4L18.4 5.6"/>', 12, 2.5),
    ring: svg('<circle cx="12" cy="12" r="6.5"/>', 11, 3),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>', 16),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 18, 2.5),
    cal: svg(P.cal, 18),
    home: svg('<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>', 22),
    book: svg(P.cal + '<path d="M12 13v5M9.5 15.5h5"/>', 22),
    post: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>', 22),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>', 22)
  };

  // Status pills: always a word and an icon (NFR-04).
  var PILLS = {
    'Open': ['', 'Open', 'ring'],
    'Taken': ['pill-taken', 'Taken', 'lock'],
    'Booked': ['', 'Booked', 'check'],
    'Done': ['pill-done', 'Done', 'check'],
    'Cancelled': ['pill-cancelled', 'Cancelled', 'x'],
    'No-show': ['pill-noshow', 'No-show', 'slash']
  };
  function pill(status, suffix) {
    var p = PILLS[status] || PILLS.Open;
    return '<span class="pill ' + p[0] + '">' + ICON[p[2]] + esc(p[1] + (suffix ? ' · ' + suffix : '')) + '</span>';
  }

  // ---------- device storage: prefs + offline cache (not the database) ----------
  var PREFS_KEY = 'advislot_prefs';
  var CACHE_KEY = 'advislot_cache';
  var DEVICE_KEY = 'advislot_device';
  function readJSON(k, fallback) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
  function userKey() {
    if (!me) return 'none';
    return me.role + ':' + (me.role === 'student' ? me.user.student_id : me.user.adviser_id);
  }
  function prefs() {
    var p = readJSON(PREFS_KEY, {})[userKey()] || {};
    if (p.reminders_on === undefined) p.reminders_on = true; // default on
    if (!p.reminders) p.reminders = {};
    return p;
  }
  function setPrefs(p) { var all = readJSON(PREFS_KEY, {}); all[userKey()] = p; writeJSON(PREFS_KEY, all); }
  function cacheGet(key) { return readJSON(CACHE_KEY, {})[userKey() + '|' + key]; }
  function cacheSet(key, data) { var all = readJSON(CACHE_KEY, {}); all[userKey() + '|' + key] = data; writeJSON(CACHE_KEY, all); }

  // Calls the API; on success caches the response, when offline falls back to the last cached copy.
  function load(key, call) {
    return call().then(function (res) {
      cacheSet(key, res.data);
      return { data: res.data, offline: false, missing: false };
    }, function (err) {
      if (err && err.status === 0) {
        var c = cacheGet(key);
        return { data: c === undefined ? null : c, offline: true, missing: c === undefined };
      }
      throw err;
    });
  }

  // ---------- toast + bottom sheet ----------
  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    $toast.innerHTML = (opts.error ? ICON.alert : ICON.checkToast) + '<span>' + esc(msg) + '</span>';
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.hidden = true; }, opts.ms || 2800);
  }

  function openSheet(o) {
    $sheet.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<h2 class="h-sheet" id="sheet-title">' + esc(o.title) + '</h2>' +
      (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
      '<button type="button" class="btn btn-primary" data-sheet="yes">' + esc(o.yes) + '</button>' +
      '<button type="button" class="btn btn-outline" data-sheet="no">' + esc(o.no) + '</button>' +
      '</div>';
    $sheet.hidden = false;
    var yes = $sheet.querySelector('[data-sheet="yes"]');
    yes.addEventListener('click', function () { o.onYes(yes); });
    $sheet.querySelector('[data-sheet="no"]').addEventListener('click', closeSheet);
    yes.focus();
  }
  function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; }
  $sheet.addEventListener('click', function (e) { if (e.target === $sheet) closeSheet(); });

  // ---------- reminders (FR-10), local notifications only ----------
  var Reminders = {
    ln: function () { return plugin('LocalNotifications'); },
    // Ask for notification permission once.
    allowed: function () {
      var ln = this.ln();
      if (!ln) return Promise.resolve(false);
      return ln.checkPermissions().then(function (s) {
        if (s.display === 'granted') return true;
        var dev = readJSON(DEVICE_KEY, {});
        if (dev.notif_asked) return false;
        dev.notif_asked = true;
        writeJSON(DEVICE_KEY, dev);
        return ln.requestPermissions().then(function (r) { return r.display === 'granted'; });
      }).catch(function () { return false; });
    },
    schedule: function (c) {
      var at = startOf(c).getTime() - 3600 * 1000;
      if (at <= Date.now()) return Promise.resolve();
      var pr = prefs();
      pr.reminders[c.consultation_id] = {
        at: at,
        title: 'Consultation in 1 hour',
        body: timeRange(c.start_time, c.end_time) + ' with ' + c.adviser_name + ' · ' + c.venue_or_link
      };
      setPrefs(pr);
      return pr.reminders_on ? this.fire([c.consultation_id]) : Promise.resolve();
    },
    fire: function (ids) {
      var ln = this.ln();
      if (!ln) return Promise.resolve();
      var pr = prefs();
      var list = ids.map(function (id) { return [Number(id), pr.reminders[id]]; })
        .filter(function (x) { return x[1] && x[1].at > Date.now(); });
      if (!list.length) return Promise.resolve();
      return this.allowed().then(function (yes) {
        if (!yes) return;
        return ln.schedule({
          notifications: list.map(function (x) {
            return { id: x[0], title: x[1].title, body: x[1].body, schedule: { at: new Date(x[1].at), allowWhileIdle: true } };
          })
        });
      }).catch(function () { /* reminders are a nice-to-have */ });
    },
    cancel: function (id) {
      var pr = prefs();
      delete pr.reminders[id];
      setPrefs(pr);
      var ln = this.ln();
      if (!ln) return Promise.resolve();
      return ln.cancel({ notifications: [{ id: Number(id) }] }).catch(function () {});
    },
    // Turned off, or signing out: remove everything scheduled with the OS.
    pauseAll: function () {
      var ln = this.ln();
      if (!ln) return Promise.resolve();
      return ln.getPending().then(function (p) {
        if (p.notifications && p.notifications.length) {
          return ln.cancel({ notifications: p.notifications.map(function (n) { return { id: n.id }; }) });
        }
      }).catch(function () {});
    },
    // Turned on, or signed in again: schedule this user's saved reminders that are still ahead.
    resumeAll: function () {
      var pr = prefs();
      Object.keys(pr.reminders).forEach(function (id) { if (pr.reminders[id].at <= Date.now()) delete pr.reminders[id]; });
      setPrefs(pr);
      return pr.reminders_on ? this.fire(Object.keys(pr.reminders)) : Promise.resolve();
    }
  };

  // ---------- navigation ----------
  var STUDENT_TABS = [['home', 'Home', 'home'], ['book', 'Book', 'book'], ['profile', 'Profile', 'user']];
  var ADVISER_TABS = [['a-home', 'Home', 'home'], ['a-post', 'Post', 'post'], ['a-profile', 'Profile', 'user']];
  var STUDENT_SCREENS = ['home', 'book', 'form', 'confirmed', 'details', 'profile', 'edit'];
  var ADVISER_SCREENS = ['a-home', 'a-post', 'a-details', 'a-profile'];

  function homeName() { return me && me.role === 'adviser' ? 'a-home' : 'home'; }
  function screenRole(name) {
    if (STUDENT_SCREENS.indexOf(name) !== -1) return 'student';
    if (ADVISER_SCREENS.indexOf(name) !== -1) return 'adviser';
    return null;
  }

  function go(name, params, mode) {
    var entry = { name: name, params: params || {} };
    if (mode === 'reset') stack = [entry];
    else if (mode === 'replace' && stack.length) stack[stack.length - 1] = entry;
    else stack.push(entry);
    render();
  }

  // Android back = in-app back. On Home or Sign In it exits the app.
  function back() {
    if (!$sheet.hidden) { closeSheet(); return; }
    if (stack.length > 1) { stack.pop(); render(); return; }
    var cur = stack.length ? stack[0].name : 'signin';
    if (cur === 'signin' || cur === 'home' || cur === 'a-home') {
      var app = plugin('App');
      if (app) { try { app.exitApp(); } catch (e) { /* ignore */ } }
      return;
    }
    go(homeName(), {}, 'reset');
  }

  // Session check before every screen (NFR-02).
  function render() {
    closeSheet();
    me = api.session();
    var top = stack[stack.length - 1];
    if (!me) {
      stack = [{ name: 'signin', params: {} }];
    } else if (!top || screenRole(top.name) !== me.role) {
      stack = [{ name: homeName(), params: {} }];
    }
    top = stack[stack.length - 1];
    var t = ++seq;
    netHandler = null;
    renderNav(top.name);
    window.scrollTo(0, 0);
    SCREENS[top.name](top.params, t);
  }

  function renderNav(name) {
    var tabs = !me ? [] : me.role === 'adviser' ? ADVISER_TABS : STUDENT_TABS;
    var show = tabs.some(function (t) { return t[0] === name; });
    document.body.classList.toggle('has-nav', show);
    $nav.hidden = !show;
    if (!show) { $nav.innerHTML = ''; return; }
    $nav.innerHTML = '<div class="nav-inner">' + tabs.map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '"' + (t[0] === name ? ' aria-current="page"' : '') + '>' +
        ICON[t[2]] + '<span>' + t[1] + '</span></button>';
    }).join('') + '</div>';
  }
  $nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) go(b.getAttribute('data-tab'), {}, 'reset');
  });

  // Shared click targets inside screens.
  $app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-back],[data-details],[data-go-book],[data-go-post]');
    if (!el || el.disabled) return;
    if (el.hasAttribute('data-back')) back();
    else if (el.hasAttribute('data-details')) go(me.role === 'adviser' ? 'a-details' : 'details', { id: Number(el.getAttribute('data-details')) });
    else if (el.hasAttribute('data-go-book')) go('book', {}, 'reset');
    else if (el.hasAttribute('data-go-post')) go('a-post', {}, 'reset');
  });

  // ---------- offline (NFR-05) ----------
  function updateBanner() {
    var off = !online();
    $offline.hidden = !off;
    document.body.classList.toggle('offline-on', off);
  }
  function onNetChange() {
    updateBanner();
    if (netHandler) netHandler(online());
    else if (stack.length) render(); // read screens reload (or fall back to cache)
  }
  window.addEventListener('online', onNetChange);
  window.addEventListener('offline', onNetChange);

  // ---------- shared fragments ----------
  function paint(html) { $app.innerHTML = html; }
  function topbar(title) {
    return '<header class="topbar"><button type="button" class="back" data-back aria-label="Back"><span>' + ICON.back +
      '</span></button><h1 class="h-bar">' + esc(title) + '</h1></header>';
  }
  function avatar(person, size, photo) {
    var src = photo !== undefined ? photo : prefs().photo;
    var style = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.32) + 'px';
    return '<span class="avatar" style="' + style + '" aria-hidden="true">' +
      (src ? '<img src="' + esc(src) + '" alt="">' : esc(initials(person.full_name))) + '</span>';
  }
  function kv(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  function errHTML(msg) { return ICON.alert + '<span>' + esc(msg) + '</span>'; }
  function notice(msg) { return '<div class="notice">' + ICON.alert + '<span>' + esc(msg) + '</span></div>'; }
  function showFieldError(input, box, msg) {
    if (input) { input.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); }
    box.innerHTML = errHTML(msg);
    box.hidden = false;
  }
  function clearFieldError(input, box) {
    if (input) { input.classList.remove('invalid'); input.removeAttribute('aria-invalid'); }
    box.hidden = true;
    box.innerHTML = '';
  }
  function trackFilled(input) {
    var f = function () { input.classList.toggle('filled', input.value.length > 0); };
    input.addEventListener('input', f);
    f();
  }
  function loadError(box, err) {
    if (err && err.status === 401) { stack = []; render(); return; }
    box.innerHTML = '<p class="empty-msg">' + esc((err && err.message) || 'Something went wrong.') + '</p>';
  }
  function dateBlock(isoDate) {
    var d = parseDate(isoDate);
    return '<span class="dateblock"><b>' + pad(d.getDate()) + '</b><small>' + MONTHS[d.getMonth()] + '</small></span>';
  }
  function notesHTML(text, emptyText) {
    var lines = noteLines(text);
    if (!lines.length) return '<p class="muted mt-8">' + esc(emptyText) + '</p>';
    if (lines.length === 1) return '<p class="prewrap mt-8">' + esc(lines[0]) + '</p>';
    return '<ul class="notes-list">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
  }
  function bookingWindow() { // today to today + 13, weekdays only (FR-03)
    var today = new Date(), out = [];
    for (var n = 0; n <= 13; n++) {
      var d = DB.addDays(today, n);
      if (DB.isWeekday(d)) out.push(iso(d));
    }
    return out;
  }

  var SCREENS = {};

  // ================= S1 Sign In =================
  var EMAIL_RE = /^[^\s@]+@school\.edu\.ph$/i;
  SCREENS.signin = function () {
    paint(
      '<section class="screen">' +
      '<div class="wordmark" role="img" aria-label="AdviSlot">ADVI<span>/</span>SLOT</div>' +
      '<h1 class="h-hero signin-hero">No more chasing your adviser.</h1>' +
      '<p class="sub mt-12">Sign in with your school account.</p>' +
      '<form id="signin-form" novalidate class="mt-8">' +
        '<div class="field"><label for="email">School email</label>' +
          '<input id="email" class="input" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="name@school.edu.ph" aria-describedby="email-err">' +
          '<div id="email-err" class="field-error" hidden></div></div>' +
        '<div class="field"><label for="password">Password</label>' +
          '<div class="input-wrap"><input id="password" class="input" type="password" autocomplete="current-password" placeholder="••••••••" aria-describedby="password-err">' +
          '<button type="button" class="in-btn" id="toggle-pw" aria-label="Show password">Show</button></div>' +
          '<div id="password-err" class="field-error" hidden></div></div>' +
        '<div class="row-end"><button type="button" class="link" id="forgot">Forgot password?</button></div>' +
        '<button type="submit" class="btn btn-primary" id="signin-btn">Sign in</button>' +
      '</form>' +
      '<footer class="signin-foot">For students and faculty only.<small>Demo: juan.delacruz@school.edu.ph / advislot123</small></footer>' +
      '</section>'
    );
    var email = $('#email'), pw = $('#password'), emailErr = $('#email-err'), pwErr = $('#password-err');
    var btn = $('#signin-btn'), toggle = $('#toggle-pw');
    trackFilled(email); trackFilled(pw);
    email.addEventListener('input', function () { clearFieldError(email, emailErr); });
    pw.addEventListener('input', function () { clearFieldError(pw, pwErr); });

    toggle.addEventListener('click', function () {
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    function emailValid() {
      if (EMAIL_RE.test(email.value.trim())) return true;
      showFieldError(email, emailErr, 'Enter a valid school email (ex. name@school.edu.ph)');
      return false;
    }

    $('#forgot').addEventListener('click', function () {
      clearFieldError(email, emailErr);
      if (!emailValid()) { email.focus(); return; }
      toast('We sent a reset link to ' + email.value.trim() + '.');
    });

    $('#signin-form').addEventListener('submit', function (e) {
      e.preventDefault();
      clearFieldError(email, emailErr); clearFieldError(pw, pwErr);
      var good = emailValid();
      if (!pw.value) { showFieldError(pw, pwErr, 'Enter your password.'); good = false; }
      if (!good) { (email.classList.contains('invalid') ? email : pw).focus(); return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      api.login({ email: email.value.trim(), password: pw.value }).then(function () {
        me = api.session();
        Reminders.resumeAll();
        go(homeName(), {}, 'reset');
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        if (err.status === 422 && err.field === 'email') showFieldError(email, emailErr, err.message);
        else if (err.status === 0) showFieldError(pw, pwErr, "You're offline. Connect to the internet to sign in.");
        else showFieldError(pw, pwErr, err.message || 'Wrong email or password.');
      });
    });
  };

  // ================= S2 Home (Revised 1) =================
  SCREENS.home = function (p, t) {
    var u = me.user;
    paint(
      '<section class="screen">' +
      '<header class="greet"><div><h1 class="hi">Hi, ' + esc(firstName(u.full_name)) + '</h1>' +
      '<p class="sub">' + esc(u.program) + ' · ' + esc(u.group_name) + '</p></div>' + avatar(u, 44) + '</header>' +
      '<div id="home-body"><p class="loading">Loading…</p></div>' +
      '</section>'
    );
    load('home', function () { return api.getHome(u.student_id); }).then(function (r) {
      if (t !== seq) return;
      var box = $('#home-body');
      if (r.missing) { box.innerHTML = '<p class="empty-msg">Connect to the internet to load your consultations.</p>'; return; }
      var d = r.data;
      box.innerHTML =
        '<p class="eyebrow mt-24">Next consultation</p>' +
        '<div class="mt-8">' + (d.next ? nextCard(d.next) :
          '<div class="card-soft"><h2 class="h-card">No upcoming consultation</h2><p class="muted mt-8">Book a slot and it will show here.</p></div>') + '</div>' +
        '<button type="button" class="btn btn-outline mt-16" data-go-book>' + ICON.plus + 'Book a slot</button>' +
        '<p class="eyebrow mt-32">Past consultations and notes</p>' +
        '<div class="rows mt-8">' + (d.past.length ? d.past.map(pastRow).join('') :
          '<p class="empty-msg">No past consultations yet.</p>') + '</div>';
    }).catch(function (err) { if (t === seq) loadError($('#home-body'), err); });
  };

  function nextCard(c) {
    return '<button type="button" class="card-ink" data-details="' + c.consultation_id + '">' +
      pill('Booked') +
      '<span class="h-date" style="display:block;margin-top:14px">' + esc(dayShort(c.consult_date)) + '</span>' +
      '<span class="bold" style="display:block;font-size:16px;margin-top:8px">' + esc(timeRange(c.start_time, c.end_time)) + '</span>' +
      '<span class="meta" style="display:block">' + esc(c.adviser_name) + ' · ' + esc(c.venue_or_link) + '</span>' +
      '<span class="meta" style="display:block">Topic: ' + esc(c.topic) + '</span>' +
      '<span class="cta"><span>View details</span>' + ICON.chev + '</span>' +
      '</button>';
  }

  function pastRow(c) {
    var lines = noteLines(c.adviser_notes);
    return '<button type="button" class="row" data-details="' + c.consultation_id + '">' +
      dateBlock(c.consult_date) +
      '<span class="grow"><span class="title" style="display:block">' + esc(c.topic) + '</span>' +
      '<span class="line" style="display:block">' + (lines.length ? esc('“' + lines.join(' ') + '”') : 'No notes yet') + '</span></span>' +
      '<span class="chev">' + ICON.chev + '</span></button>';
  }

  // ================= S3 Book a Slot =================
  SCREENS.book = function (p, t) {
    var u = me.user, a = u.adviser;
    var days = bookingWindow();
    if (days.indexOf(ui.bookDay) === -1) ui.bookDay = days[0];
    paint(
      '<section class="screen">' +
      '<h1 class="h-title">Book a slot</h1>' +
      '<div class="card-soft adviser-card mt-16">' + avatar(a, 40, null) +
      '<div><div class="bold">' + esc(a.full_name) + '</div><div class="muted">Your adviser · 30-min slots</div></div></div>' +
      '<p class="eyebrow mt-24" id="month"></p>' +
      '<div class="strip mt-8" id="strip" role="group" aria-label="Pick a day">' + days.map(function (day) {
        var d = parseDate(day);
        return '<button type="button" class="day" data-day="' + day + '" aria-pressed="false" aria-label="' + esc(dayShort(day)) + '">' +
          '<small>' + DAYS[d.getDay()] + '</small><b>' + d.getDate() + '</b></button>';
      }).join('') + '</div>' +
      '<div id="slots"><p class="loading">Loading…</p></div>' +
      '</section>'
    );
    var result = null;

    function markDay() {
      var d = parseDate(ui.bookDay);
      $('#month').textContent = MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear();
      [].forEach.call($app.querySelectorAll('.day'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-day') === ui.bookDay));
      });
      var sel = $('.day[aria-pressed="true"]');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function draw() {
      var box = $('#slots');
      var off = result.offline;
      var now = new Date();
      var rows = (result.data || []).filter(function (c) {
        return c.consult_date === ui.bookDay && (c.status === 'Open' || c.status === 'Booked') && startOf(c) > now;
      });
      var openCount = rows.filter(function (c) { return c.status === 'Open'; }).length;
      var html = '<div class="day-head"><span class="bold">' + esc(dayShort(ui.bookDay)) + '</span>' +
        (result.missing ? '' : '<span class="muted">' + openCount + ' open</span>') + '</div>';
      if (off) html += '<div class="mt-12">' + notice('Connect to the internet to book.') + '</div>';
      if (!result.missing) {
        if (!openCount) html += '<p class="empty-msg">No open slots on this day. Try another day.</p>';
        html += '<div class="rows">' + rows.map(function (c) { return slotRow(c, off); }).join('') + '</div>';
      }
      box.innerHTML = html;
    }

    $('#strip').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      ui.bookDay = b.getAttribute('data-day');
      markDay();
      if (result) draw();
    });
    $('#slots').addEventListener('click', function (e) {
      var b = e.target.closest('[data-slot]');
      if (!b || b.disabled || !result) return;
      var id = Number(b.getAttribute('data-slot'));
      var slot = result.data.find(function (c) { return c.consultation_id === id; });
      if (slot) go('form', { slot: slot });
    });
    markDay();

    var from = days[0], to = iso(DB.addDays(new Date(), 13));
    load('slots', function () { return api.getSlots({ adviser_id: a.adviser_id, from: from, to: to }); }).then(function (r) {
      if (t !== seq) return;
      result = r;
      draw();
    }).catch(function (err) { if (t === seq) loadError($('#slots'), err); });
  };

  function slotRow(c, off) {
    var info = '<span class="grow"><span class="time" style="display:block">' + esc(timeRange(c.start_time, c.end_time)) + '</span>' +
      '<span class="line" style="display:block">' + esc(c.mode) + '</span></span>';
    if (c.status === 'Open') {
      return '<button type="button" class="row slot" data-slot="' + c.consultation_id + '"' + (off ? ' disabled' : '') + '>' +
        info + pill('Open') + '<span class="chev">' + ICON.chev + '</span></button>';
    }
    if (c.group_name && c.group_name === me.user.group_name) { // own group's booking
      return '<button type="button" class="row slot" data-details="' + c.consultation_id + '">' +
        info + pill('Booked') + '<span class="chev">' + ICON.chev + '</span></button>';
    }
    return '<div class="row slot taken" aria-disabled="true">' + info + pill('Taken') + '</div>';
  }

  // ================= S4 Booking Form =================
  SCREENS.form = function (p, t) {
    var c = p.slot, u = me.user;
    paint(
      '<section class="screen">' + topbar('Confirm booking') +
      '<div class="card-soft mt-16">' +
        '<div class="h-date">' + esc(dayShort(c.consult_date)) + '</div>' +
        '<div class="bold mt-8">' + esc(timeRange(c.start_time, c.end_time)) + ' · ' + esc(c.mode) + '</div>' +
        '<div class="muted">' + esc(c.adviser_name) + ' · ' + esc(c.venue_or_link) + '</div>' +
      '</div>' +
      '<div class="field"><label for="group">Group</label>' +
        '<div class="input-wrap"><input id="group" class="input" value="' + esc(u.group_name) + '" readonly aria-readonly="true">' +
        '<span class="in-icon">' + ICON.lockField + '</span></div></div>' +
      '<div class="field"><label for="topic">Topic <span class="opt">(required)</span></label>' +
        '<input id="topic" class="input" type="text" autocomplete="off" aria-describedby="topic-help">' +
        '<div class="helper-row" id="topic-help" aria-live="polite"><span id="topic-msg">What do you want to discuss?</span><span class="count" id="topic-count">0/150</span></div></div>' +
      '<div class="field"><label for="snotes">Notes for adviser <span class="opt">(optional)</span></label>' +
        '<textarea id="snotes" class="input" rows="3" maxlength="300" placeholder="Ex. We\'ll bring the printed Chapter 3."></textarea></div>' +
      '<div id="net" class="mt-16" hidden>' + notice('Connect to the internet to book.') + '</div>' +
      '<div class="stack mt-24">' +
        '<button type="button" class="btn btn-primary" id="confirm">Confirm booking</button>' +
        '<button type="button" class="btn btn-text" id="cancel">Cancel</button>' +
      '</div>' +
      '<p class="foot push-bottom">You can cancel up to 2 hours before the slot.</p>' +
      '</section>'
    );
    var topic = $('#topic'), count = $('#topic-count'), msg = $('#topic-msg'), help = $('#topic-help');
    var btn = $('#confirm'), snotes = $('#snotes');
    var emptyErr = false, serverErr = null, busy = false;
    trackFilled(topic); trackFilled(snotes);

    function state() {
      var len = topic.value.length;
      count.textContent = len + '/150';
      var err = len > 150 ? 'Topic is too long (max 150 characters).' :
        emptyErr ? 'Please add a topic so your adviser can prepare.' : serverErr;
      topic.classList.toggle('invalid', !!err);
      if (err) topic.setAttribute('aria-invalid', 'true'); else topic.removeAttribute('aria-invalid');
      help.classList.toggle('error', !!err);
      msg.innerHTML = err ? errHTML(err) : 'What do you want to discuss?';
      msg.style.display = err ? 'flex' : '';
      msg.style.gap = '6px';
      $('#net').hidden = online();
      btn.disabled = busy || len > 150 || !online();
    }
    topic.addEventListener('input', function () {
      if (topic.value.trim()) emptyErr = false;
      serverErr = null;
      state();
    });
    netHandler = state;
    state();

    $('#cancel').addEventListener('click', back);
    btn.addEventListener('click', function () {
      if (!topic.value.trim()) { emptyErr = true; state(); topic.focus(); return; }
      if (topic.value.length > 150 || !online()) { state(); return; }
      busy = true; btn.textContent = 'Booking…'; state();
      api.book({
        consultation_id: c.consultation_id,
        student_id: u.student_id,
        topic: topic.value,
        student_notes: snotes.value
      }).then(function (res) {
        Reminders.schedule(res.data);
        stack = [{ name: 'home', params: {} }, { name: 'confirmed', params: { c: res.data } }];
        render();
      }).catch(function (err) {
        if (t !== seq) return;
        busy = false; btn.textContent = 'Confirm booking';
        if (err.status === 409) { toast(err.message, { error: true, ms: 4500 }); back(); return; }
        if (err.status === 422 && err.field === 'topic') serverErr = err.message;
        else if (err.status !== 0) toast(err.message, { error: true });
        state();
      });
    });
  };

  // ================= S5 Booking Confirmed (Revised 2) =================
  SCREENS.confirmed = function (p) {
    var c = p.c;
    var remindAt = new Date(startOf(c).getTime() - 3600 * 1000);
    var showReminder = prefs().reminders_on && remindAt > new Date();
    paint(
      '<section class="screen">' +
      '<div class="mt-24"><span class="check-circle">' + ICON.checkBig + '</span></div>' +
      '<h1 class="h-hero mt-24">Booked!</h1>' +
      '<p class="sub mt-8">Your slot is saved. Other groups now see it as Taken.</p>' +
      '<div class="card-soft mt-24">' +
        '<div class="h-date">' + esc(dayShort(c.consult_date)) + '</div>' +
        '<div class="bold mt-8">' + esc(timeRange(c.start_time, c.end_time)) + ' · ' + esc(c.mode) + '</div>' +
        '<div class="muted">' + esc(c.adviser_name) + ' · ' + esc(c.venue_or_link) + '</div>' +
        '<hr class="hr"><div class="muted">Topic</div><div class="bold">' + esc(c.topic) + '</div>' +
      '</div>' +
      (showReminder ? '<p class="reminder-line">' + ICON.cal + 'Reminder 1 hour before (' + esc(clock(remindAt)) + ')</p>' : '') +
      '<div class="push-bottom">' +
        '<button type="button" class="btn btn-primary" id="to-home">Back to home</button>' +
        '<button type="button" class="btn btn-outline" id="to-details">View details</button>' +
      '</div></section>'
    );
    $('#to-home').addEventListener('click', function () { go('home', {}, 'reset'); });
    $('#to-details').addEventListener('click', function () { go('details', { id: c.consultation_id }, 'replace'); });
  };

  // ================= S6 Consultation Details (Revised 3) =================
  function fromCache(key, id) { // offline fallback: find the row in an earlier list response
    var d = cacheGet(key);
    if (!d) return null;
    var list = Array.isArray(d) ? d : [d.next].concat(d.past || []);
    return list.find(function (c) { return c && c.consultation_id === id; }) || null;
  }

  SCREENS.details = function (p, t) {
    paint('<section class="screen">' + topbar('Consultation') + '<div id="d" class="fill"><p class="loading">Loading…</p></div></section>');
    load('c:' + p.id, function () { return api.getConsultation(p.id); }).then(function (r) {
      if (t !== seq) return;
      var c = r.data || fromCache('home', p.id);
      if (!c) { $('#d').innerHTML = '<p class="empty-msg">Connect to the internet to load this consultation.</p>'; return; }
      drawDetails(c, r.offline);
    }).catch(function (err) { if (t === seq) loadError($('#d'), err); });
  };

  function drawDetails(c, off) {
    var now = new Date(), start = startOf(c);
    var upcoming = c.status === 'Booked' && start > now;
    var deadline = new Date(start.getTime() - 2 * 3600 * 1000);
    var canCancel = now <= deadline;
    var actions;
    if (upcoming) {
      if (!canCancel) {
        actions = '<div class="stack mt-24"><button type="button" class="btn btn-outline" disabled>Cancel booking</button>' +
          '<p class="muted center">You can only cancel up to 2 hours before.</p></div>';
      } else {
        actions = '<div class="stack mt-24"><div class="notice"><span>You can cancel until <b>' + esc(clock(deadline)) + ', ' +
          esc(dayShort(iso(deadline))) + '</b> (2 hours before).</span></div>' +
          (off ? notice('Connect to the internet to cancel.') : '') +
          '<button type="button" class="btn btn-outline" id="cancel-booking"' + (off ? ' disabled' : '') + '>Cancel booking</button></div>';
      }
    } else {
      actions = '<div class="push-bottom"><button type="button" class="btn btn-primary" data-go-book>Book follow-up</button></div>';
    }
    $('#d').innerHTML =
      '<div class="mt-16">' + pill(c.status) + '</div>' +
      '<h2 class="h-title mt-12 prewrap">' + esc(c.topic) + '</h2>' +
      '<dl class="kv">' +
        kv('Date', dayLong(c.consult_date)) + kv('Time', timeRange(c.start_time, c.end_time)) +
        kv('Mode', c.mode + ' · ' + c.venue_or_link) + kv('Adviser', c.adviser_name) + kv('Booked by', c.booked_by_name || '—') +
      '</dl>' +
      (c.student_notes ? '<div class="mt-16"><p class="eyebrow">Notes for adviser</p><p class="prewrap mt-8">' + esc(c.student_notes) + '</p></div>' : '') +
      '<div class="card-soft mt-16"><p class="eyebrow">Adviser notes</p>' +
        notesHTML(c.adviser_notes, 'No notes yet. Your adviser adds notes after the session.') + '</div>' +
      actions;

    var cancelBtn = $('#cancel-booking');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      openSheet({
        title: 'Cancel this consultation?',
        text: 'The slot will open up again for other groups.',
        yes: 'Yes, cancel it',
        no: 'Keep booking',
        onYes: function (b) {
          b.disabled = true; b.textContent = 'Cancelling…';
          api.cancel(c.consultation_id).then(function () {
            Reminders.cancel(c.consultation_id);
            toast('Booking cancelled');
            go('home', {}, 'reset');
          }).catch(function (err) {
            toast(err.status === 0 ? 'Connect to the internet to cancel.' : err.message, { error: true });
            render();
          });
        }
      });
    });
  }

  // ================= S7 Profile =================
  SCREENS.profile = function () {
    var u = me.user, pr = prefs();
    paint(
      '<section class="screen">' +
      '<h1 class="h-title">Profile</h1>' +
      '<div class="who">' + avatar(u, 64) + '<div><div class="name">' + esc(u.full_name) + '</div>' +
        '<div class="muted">' + esc(u.program) + ' · ' + esc(u.group_name) + '</div></div></div>' +
      '<dl class="kv lined mt-16">' + kv('Student ID', u.student_id) + kv('School email', u.email) +
        kv('Contact no.', phoneDisplay(u.contact_no)) + kv('Adviser', u.adviser.full_name) + '</dl>' +
      '<p class="eyebrow mt-24">Settings</p>' +
      '<div class="card-soft setting mt-8"><div><div class="bold" id="rem-label">Consultation reminders</div><div class="muted">1 hour before</div></div>' +
        '<div class="switch-wrap"><span id="rem-text">' + (pr.reminders_on ? 'On' : 'Off') + '</span>' +
        '<button type="button" class="switch" id="rem" role="switch" aria-checked="' + pr.reminders_on + '" aria-labelledby="rem-label"></button></div></div>' +
      '<button type="button" class="btn btn-outline mt-24" id="edit">Edit profile</button>' +
      '<button type="button" class="btn btn-text mt-8" id="signout">Sign out</button>' +
      '</section>'
    );
    $('#rem').addEventListener('click', function () {
      var p2 = prefs();
      p2.reminders_on = !p2.reminders_on;
      setPrefs(p2);
      this.setAttribute('aria-checked', String(p2.reminders_on));
      $('#rem-text').textContent = p2.reminders_on ? 'On' : 'Off';
      if (p2.reminders_on) Reminders.resumeAll(); else Reminders.pauseAll();
    });
    $('#edit').addEventListener('click', function () { go('edit'); });
    $('#signout').addEventListener('click', confirmSignOut);
  };

  function confirmSignOut() {
    openSheet({
      title: 'Sign out of AdviSlot?',
      text: '',
      yes: 'Sign out',
      no: 'Cancel',
      onYes: function () {
        Reminders.pauseAll();
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        api.logout().then(function () {
          ui.bookDay = null;
          stack = [{ name: 'signin', params: {} }];
          render();
        });
      }
    });
  }

  // ================= S8 Edit Profile =================
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = reject;
      fr.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var max = 256, scale = Math.min(1, max / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * scale));
          cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  SCREENS.edit = function () {
    var u = me.user;
    var photo = prefs().photo || null;
    paint(
      '<section class="screen">' + topbar('Edit profile') +
      '<div class="photo-row"><span id="ph">' + avatar(u, 80, photo) + '</span>' +
        '<button type="button" class="btn btn-outline" id="change-photo">Change photo</button>' +
        '<input type="file" id="photo" accept="image/*" hidden aria-label="Choose a photo"></div>' +
      '<div class="field"><label for="contact">Contact number <span class="opt">(optional)</span></label>' +
        '<input id="contact" class="input" type="tel" inputmode="tel" autocomplete="tel" placeholder="09XX XXX XXXX" value="' +
        esc(u.contact_no ? phoneDisplay(u.contact_no) : '') + '" aria-describedby="contact-err">' +
        '<div id="contact-err" class="field-error" hidden></div></div>' +
      '<div id="net" class="mt-16" hidden>' + notice('Connect to the internet to save.') + '</div>' +
      '<div class="stack mt-24">' +
        '<button type="button" class="btn btn-primary" id="save">Save</button>' +
        '<button type="button" class="btn btn-text" id="cancel">Cancel</button>' +
      '</div></section>'
    );
    var contact = $('#contact'), err = $('#contact-err'), save = $('#save'), file = $('#photo');
    trackFilled(contact);
    contact.addEventListener('input', function () { clearFieldError(contact, err); });
    $('#change-photo').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      if (!file.files || !file.files[0]) return;
      shrinkPhoto(file.files[0]).then(function (url) {
        photo = url;
        $('#ph').innerHTML = avatar(u, 80, photo);
      }).catch(function () { toast('That photo could not be opened. Try another one.', { error: true }); });
    });
    function net(on) { $('#net').hidden = on; save.disabled = !on; }
    netHandler = net;
    net(online());
    $('#cancel').addEventListener('click', back);
    save.addEventListener('click', function () {
      var raw = contact.value.replace(/\s+/g, '');
      if (raw && !/^09\d{9}$/.test(raw)) { showFieldError(contact, err, 'Enter an 11-digit number starting with 09.'); contact.focus(); return; }
      save.disabled = true; save.textContent = 'Saving…';
      api.updateStudent(u.student_id, { contact_no: raw }).then(function () {
        var pr = prefs();
        pr.photo = photo;
        setPrefs(pr);
        toast('Profile updated');
        back();
      }).catch(function (e) {
        save.textContent = 'Save';
        net(online());
        if (e.status === 422) showFieldError(contact, err, e.message);
        else if (e.status !== 0) toast(e.message, { error: true });
      });
    });
  };

  // ================= A1 Adviser Home =================
  SCREENS['a-home'] = function (p, t) {
    var u = me.user;
    paint(
      '<section class="screen">' +
      '<header class="greet"><div><h1 class="hi">Hi, ' + esc(shortTitle(u.full_name)) + '</h1>' +
      '<p class="sub">' + esc(u.department) + '</p></div>' + avatar(u, 44) + '</header>' +
      '<button type="button" class="btn btn-primary mt-24" data-go-post>' + ICON.plus + 'Post a slot</button>' +
      '<div id="a-body"><p class="loading">Loading…</p></div>' +
      '</section>'
    );
    load('a-slots', function () { return api.getSlots({ adviser_id: u.adviser_id }); }).then(function (r) {
      if (t !== seq) return;
      var box = $('#a-body');
      if (r.missing) { box.innerHTML = '<p class="empty-msg">Connect to the internet to load your slots.</p>'; return; }
      var now = new Date();
      var needs = r.data.filter(function (c) { return c.status === 'Booked' && startOf(c) <= now; }).reverse();
      var upcoming = r.data.filter(function (c) { return (c.status === 'Open' || c.status === 'Booked') && startOf(c) > now; });
      var html = '<p class="eyebrow mt-32">Needs notes</p><div class="rows mt-8">' +
        (needs.length ? needs.map(function (c) {
          return '<button type="button" class="row" data-details="' + c.consultation_id + '">' + dateBlock(c.consult_date) +
            '<span class="grow"><span class="title" style="display:block">' + esc(c.topic) + '</span>' +
            '<span class="line" style="display:block">' + esc(c.group_name) + ' · ' + esc(timeRange(c.start_time, c.end_time)) + '</span></span>' +
            '<span class="chev">' + ICON.chev + '</span></button>';
        }).join('') : '<p class="empty-msg">No consultations waiting for notes.</p>') + '</div>' +
        '<p class="eyebrow mt-32">Upcoming</p>';
      if (!upcoming.length) html += '<p class="empty-msg">No upcoming slots. Post one above.</p>';
      var lastDate = null;
      upcoming.forEach(function (c) {
        if (c.consult_date !== lastDate) {
          if (lastDate) html += '</div>';
          html += '<div class="group-head bold">' + esc(dayShort(c.consult_date)) + '</div><div class="rows">';
          lastDate = c.consult_date;
        }
        var booked = c.status === 'Booked';
        html += '<button type="button" class="row" data-details="' + c.consultation_id + '">' +
          '<span class="grow"><span class="time bold" style="display:block">' + esc(timeRange(c.start_time, c.end_time)) + '</span>' +
          '<span class="line" style="display:block">' + esc(booked ? c.topic : c.mode) + '</span></span>' +
          pill(c.status, booked ? c.group_name : '') + '<span class="chev">' + ICON.chev + '</span></button>';
      });
      if (lastDate) html += '</div>';
      box.innerHTML = html;
    }).catch(function (err) { if (t === seq) loadError($('#a-body'), err); });
  };

  // ================= A2 Post a Slot =================
  SCREENS['a-post'] = function () {
    var u = me.user;
    var today = iso(new Date()), max = iso(DB.addDays(new Date(), 13));
    var mode = 'Face-to-face';
    paint(
      '<section class="screen">' +
      '<h1 class="h-title">Post a slot</h1>' +
      '<form id="post-form" novalidate>' +
        '<div class="field"><label for="f-date">Date</label>' +
          '<input id="f-date" class="input" type="date" min="' + today + '" max="' + max + '" aria-describedby="e-date">' +
          '<div id="e-date" class="field-error" hidden></div></div>' +
        '<div class="two mt-16">' +
          '<div class="field"><label for="f-start">Start time</label><input id="f-start" class="input" type="time" aria-describedby="e-start">' +
            '<div id="e-start" class="field-error" hidden></div></div>' +
          '<div class="field"><label for="f-end">End time</label><input id="f-end" class="input" type="time" aria-describedby="e-end">' +
            '<div id="e-end" class="field-error" hidden></div></div>' +
        '</div>' +
        '<div class="field"><span class="label" id="mode-label">Mode</span>' +
          '<div class="seg" role="radiogroup" aria-labelledby="mode-label">' +
          '<button type="button" role="radio" aria-checked="true" data-mode="Face-to-face">Face-to-face</button>' +
          '<button type="button" role="radio" aria-checked="false" data-mode="Online">Online</button></div></div>' +
        '<div class="field"><label for="f-venue">Venue or link</label>' +
          '<input id="f-venue" class="input" type="text" maxlength="150" autocomplete="off" value="' + esc(u.office) + '" placeholder="Room or meeting link" aria-describedby="e-venue">' +
          '<div id="e-venue" class="field-error" hidden></div></div>' +
        '<div id="net" class="mt-16" hidden>' + notice('Connect to the internet to post.') + '</div>' +
        '<button type="submit" class="btn btn-primary mt-24" id="post-btn">Post slot</button>' +
      '</form></section>'
    );
    var f = { consult_date: $('#f-date'), start_time: $('#f-start'), end_time: $('#f-end'), venue_or_link: $('#f-venue') };
    var e = { consult_date: $('#e-date'), start_time: $('#e-start'), end_time: $('#e-end'), venue_or_link: $('#e-venue') };
    var btn = $('#post-btn');
    Object.keys(f).forEach(function (k) {
      trackFilled(f[k]);
      f[k].addEventListener('input', function () { clearFieldError(f[k], e[k]); });
      f[k].addEventListener('change', function () { f[k].classList.toggle('filled', !!f[k].value); });
    });
    $app.querySelector('.seg').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-mode]');
      if (!b) return;
      mode = b.getAttribute('data-mode');
      [].forEach.call($app.querySelectorAll('[data-mode]'), function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
      var v = f.venue_or_link;
      if (mode === 'Face-to-face' && !v.value.trim()) v.value = u.office;
      if (mode === 'Online' && v.value === u.office) v.value = '';
      v.classList.toggle('filled', !!v.value);
      clearFieldError(v, e.venue_or_link);
    });
    function net(on) { $('#net').hidden = on; btn.disabled = !on; }
    netHandler = net;
    net(online());

    function check(v) { // same rules the API applies
      var now = new Date();
      if (!v.consult_date || v.consult_date < today) return ['consult_date', 'Pick a date from today onward.'];
      if (v.consult_date > max) return ['consult_date', 'Pick a date within the next 14 days.'];
      if (!v.start_time) return ['start_time', 'Pick a start time.'];
      if (!v.end_time) return ['end_time', 'Pick an end time.'];
      if (v.end_time <= v.start_time) return ['end_time', 'End time must be later than start time.'];
      if (startOf(v) <= now) return ['start_time', 'This time has already passed.'];
      if (!v.venue_or_link.trim()) return ['venue_or_link', 'Add a room or meeting link.'];
      if (v.venue_or_link.trim().length > 150) return ['venue_or_link', 'Room or link is too long (max 150 characters).'];
      return null;
    }

    $('#post-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      Object.keys(f).forEach(function (k) { clearFieldError(f[k], e[k]); });
      var v = {
        consult_date: f.consult_date.value, start_time: f.start_time.value, end_time: f.end_time.value,
        mode: mode, venue_or_link: f.venue_or_link.value
      };
      var bad = check(v);
      if (bad) { showFieldError(f[bad[0]], e[bad[0]], bad[1]); f[bad[0]].focus(); return; }
      btn.disabled = true; btn.textContent = 'Posting…';
      api.postSlot(v).then(function () {
        toast('Slot posted');
        go('a-home', {}, 'reset');
      }).catch(function (err) {
        btn.textContent = 'Post slot';
        net(online());
        if (err.status === 422 && f[err.field]) showFieldError(f[err.field], e[err.field], err.message);
        else if (err.status !== 0) toast(err.message, { error: true });
      });
    });
  };

  // ================= A3 Adviser Details =================
  SCREENS['a-details'] = function (p, t) {
    paint('<section class="screen">' + topbar('Consultation') + '<div id="d" class="fill"><p class="loading">Loading…</p></div></section>');
    load('c:' + p.id, function () { return api.getConsultation(p.id); }).then(function (r) {
      if (t !== seq) return;
      var c = r.data || fromCache('a-slots', p.id);
      if (!c) { $('#d').innerHTML = '<p class="empty-msg">Connect to the internet to load this consultation.</p>'; return; }
      drawAdviserDetails(c, t);
    }).catch(function (err) { if (t === seq) loadError($('#d'), err); });
  };

  function drawAdviserDetails(c, t) {
    var isOpen = c.status === 'Open';
    var started = startOf(c) <= new Date();
    var html =
      '<div class="mt-16">' + pill(c.status) + '</div>' +
      '<h2 class="h-title mt-12 prewrap">' + esc(isOpen ? 'Open slot' : c.topic) + '</h2>' +
      '<dl class="kv">' +
        kv('Date', dayLong(c.consult_date)) + kv('Time', timeRange(c.start_time, c.end_time)) +
        kv('Mode', c.mode + ' · ' + c.venue_or_link) +
        (isOpen ? '' : kv('Group', c.group_name) + kv('Booked by', c.booked_by_name)) +
      '</dl>';
    if (!isOpen) {
      html +=
        (c.student_notes ? '<div class="mt-16"><p class="eyebrow">Notes for adviser</p><p class="prewrap mt-8">' + esc(c.student_notes) + '</p></div>' : '') +
        '<div class="field mt-24"><label for="anotes" class="eyebrow">Adviser notes</label>' +
          '<textarea id="anotes" class="input" rows="5" placeholder="One point per line. Ex. Narrow down the scope.">' + esc(c.adviser_notes || '') + '</textarea></div>' +
        '<div id="net" class="mt-16" hidden>' + notice('Connect to the internet to save.') + '</div>' +
        '<div class="stack mt-16">' +
          '<button type="button" class="btn btn-primary" id="save-notes">Save notes</button>' +
          (c.status === 'Booked' && started ?
            '<button type="button" class="btn btn-outline" data-mark="Done">Mark as done</button>' +
            '<button type="button" class="btn btn-outline" data-mark="No-show">Mark as no-show</button>' : '') +
        '</div>';
    }
    $('#d').innerHTML = html;
    if (isOpen) return;

    var notes = $('#anotes');
    var buttons = [].slice.call($app.querySelectorAll('#save-notes,[data-mark]'));
    trackFilled(notes);
    function net(on) { $('#net').hidden = on; buttons.forEach(function (b) { b.disabled = !on; }); }
    netHandler = net;
    net(online());

    function send(body, done) {
      buttons.forEach(function (b) { b.disabled = true; });
      api.updateConsultation(c.consultation_id, body).then(function (res) {
        toast(done);
        if (body.status) { if (t === seq) render(); return; }
        c = res.data;
        net(online());
      }).catch(function (err) {
        net(online());
        if (err.status !== 0) toast(err.message, { error: true });
      });
    }
    $('#save-notes').addEventListener('click', function () { send({ adviser_notes: notes.value }, 'Notes saved'); });
    [].forEach.call($app.querySelectorAll('[data-mark]'), function (b) {
      b.addEventListener('click', function () {
        var status = b.getAttribute('data-mark');
        send({ adviser_notes: notes.value, status: status }, status === 'Done' ? 'Marked as done' : 'Marked as no-show');
      });
    });
  }

  // ================= A4 Adviser Profile =================
  SCREENS['a-profile'] = function () {
    var u = me.user;
    paint(
      '<section class="screen">' +
      '<h1 class="h-title">Profile</h1>' +
      '<div class="who">' + avatar(u, 64) + '<div><div class="name">' + esc(u.full_name) + '</div>' +
        '<div class="muted">' + esc(u.department) + '</div></div></div>' +
      '<dl class="kv lined mt-16">' + kv('School email', u.email) + kv('Department', u.department) + kv('Office', u.office) + '</dl>' +
      '<button type="button" class="btn btn-text mt-24" id="signout">Sign out</button>' +
      '</section>'
    );
    $('#signout').addEventListener('click', confirmSignOut);
  };

  // ---------- start ----------
  function start() {
    updateBanner();
    var bars = plugin('SystemBars');
    if (bars) { try { bars.setStyle({ style: 'LIGHT' }); } catch (e) { /* ignore */ } }
    var app = plugin('App');
    if (app) { try { app.addListener('backButton', back); } catch (e) { /* ignore */ } }
    me = api.session();
    stack = [{ name: me ? homeName() : 'signin', params: {} }];
    render();
  }
  start();
})();
