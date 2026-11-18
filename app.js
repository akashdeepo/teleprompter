/* Teleprompter: library, paste, start and end, edit, and the reader.
 *
 * Speed is words a minute over the whole script: the scroll covers the script's height in the
 * time it takes to say its words at that pace. Text size, margins and turning the tablet change
 * the height, so the scroll speed in pixels is worked out again and the pace stays the same.
 * The scroll itself never changes speed; pauses are space (see parse.js).
 *
 * Your place is kept as "this line, this far through it", never as pixels, so it survives
 * turning the tablet, changing the look, editing and reopening.
 */
(function () {
  'use strict';
  var P = window.PromptParse;
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- storage (everything stays on this device) ----------
  function load(k, d) {
    try { var v = localStorage.getItem('rsp.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem('rsp.' + k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function drop(k) { try { localStorage.removeItem('rsp.' + k); } catch (e) { /* nothing to do */ } }

  var DEFAULTS = { size: 52, lineH: 1.6, margin: 8, marker: 33, pauses: 1, countdown: 3, align: 'left',
                   weight: 600, mirrorX: true, mirrorY: false, dim: true, arrows: true, wpm: 105 };
  var S = Object.assign({}, DEFAULTS, load('settings', {}));
  function saveSettings() { save('settings', S); }

  var index = load('index', []);          // [{id, title, named, words, wpm, opened, created}]
  function saveIndex() { if (!save('index', index)) full(); }
  function entry(id) { for (var i = 0; i < index.length; i++) if (index[i].id === id) return index[i]; return null; }
  function script(id) { return id && entry(id) ? load('s.' + id, null) : null; }
  function storeScript(id, s) {
    if (!save('s.' + id, s)) { full(); return false; }
    var e = entry(id);
    if (e) {
      e.words = P.parse(s.body).words;
      if (!e.named) e.title = P.title(s.body);
      saveIndex();
    }
    return true;
  }
  function full() {
    ask({ title: 'The tablet has no room left for scripts', text: 'Delete a script you no longer need, then try again.', alert: true });
  }

  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function when(ts) {
    var d = new Date(ts), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ---------- small dialog ----------
  function ask(o) {
    return new Promise(function (resolve) {
      var inp = $('dlgInput'), ok = $('dlgOk'), cancel = $('dlgCancel');
      $('dlgTitle').textContent = o.title;
      $('dlgText').textContent = o.text || '';
      $('dlgText').hidden = !o.text;
      inp.hidden = o.value === undefined;
      if (!inp.hidden) inp.value = o.value;
      ok.textContent = o.ok || 'OK';
      ok.className = 'btn ' + (o.danger ? 'danger' : 'primary');
      cancel.hidden = !!o.alert;
      $('dialog').hidden = false;
      if (!inp.hidden) { inp.focus(); inp.select(); }
      function done(v) { $('dialog').hidden = true; ok.onclick = cancel.onclick = inp.onkeydown = null; resolve(v); }
      ok.onclick = function () { done(inp.hidden ? true : inp.value); };
      cancel.onclick = function () { done(null); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') ok.onclick(); };
    });
  }

  // ---------- navigation: #/  #/new  #/trim/<id>  #/read/<id>  #/edit/<id> ----------
  var current = null;
  function nav(hash, replace) {
    var d = (history.state && history.state.depth) || 0;
    if (replace) history.replaceState({ depth: d }, '', hash);
    else history.pushState({ depth: d + 1 }, '', hash);
    route();
  }
  function back(fallback) {
    if (history.state && history.state.depth > 0) history.back();
    else nav(fallback || '#/', true);
  }
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var v = parts[0] || 'library', id = parts[1];
    if (current === 'read' && v !== 'read') leaveRead();
    if (current === 'edit' && v !== 'edit') { flushEdit(); E.id = null; }
    if ((v === 'read' || v === 'edit' || v === 'trim') && !script(id)) v = 'library';
    if (['library', 'new', 'trim', 'read', 'edit'].indexOf(v) < 0) v = 'library';
    ['library', 'paste', 'trim', 'edit', 'read'].forEach(function (n) {
      $(n).hidden = n !== (v === 'new' ? 'paste' : v);
    });
    current = v;
    if (v === 'read') openRead(id);
    else if (v === 'edit') openEdit(id);
    else if (v === 'trim') openTrim(id);
    else if (v === 'new') openPaste();
    else renderLibrary();
  }
  window.addEventListener('popstate', route);
  Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (b) {
    b.addEventListener('click', function () { if (current === 'trim') trimBack(); else back('#/'); });
  });

  // ---------- library ----------
  function renderLibrary() {
    index.sort(function (a, b) { return b.opened - a.opened; });
    var list = $('scriptList');
    list.innerHTML = '';
    $('emptyLib').hidden = index.length > 0;
    index.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'script';
      var info = document.createElement('div');
      info.className = 'info';
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = e.title;
      var m = document.createElement('div');
      m.className = 'm';
      m.textContent = e.words + ' words · about ' + Math.max(1, Math.round(e.words / (e.wpm || S.wpm))) +
        ' min at ' + (e.wpm || S.wpm) + ' a minute · opened ' + when(e.opened);
      info.appendChild(t);
      info.appendChild(m);
      row.appendChild(info);
      row.appendChild(iconButton('edit-24-regular', 'Rename', function () {
        ask({ title: 'Rename', value: e.title, ok: 'Rename' }).then(function (v) {
          if (v && v.trim()) { e.title = v.trim(); e.named = true; saveIndex(); renderLibrary(); }
        });
      }));
      row.appendChild(iconButton('delete-24-regular', 'Delete', function () {
        ask({ title: 'Delete this script?', text: e.title, ok: 'Delete', danger: true }).then(function (ok) {
          if (!ok) return;
          index = index.filter(function (x) { return x.id !== e.id; });
          drop('s.' + e.id);
          drop('p.' + e.id);
          saveIndex();
          renderLibrary();
        });
      }));
      row.addEventListener('click', function () { nav('#/read/' + e.id); });
      list.appendChild(row);
    });
  }
  function iconButton(icon, label, fn) {
    var b = document.createElement('button');
    b.className = 'btn icon';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<i class="ic" style="--i:url(icons/' + icon + '.svg)"></i>';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    return b;
  }
  $('newScript').addEventListener('click', function () { nav('#/new'); });

  // ---------- paste ----------
  function openPaste() {
    $('pasteBox').value = '';
    $('pasteNext').disabled = true;
    $('pasteBox').focus();
  }
  $('pasteBox').addEventListener('input', function () { $('pasteNext').disabled = !this.value.trim(); });
  $('pasteNext').addEventListener('click', function () {
    var text = $('pasteBox').value;
    var r = P.detect(text);
    var parts = P.split(text, r.start, r.end);
    var id = Date.now().toString(36);
    var now = Date.now();
    index.push({ id: id, title: P.title(parts.body), named: false, words: 0, wpm: S.wpm, opened: now, created: now });
    if (!storeScript(id, parts)) { index.pop(); return; }
    T.origin = 'new';
    nav('#/trim/' + id, true);         // back from here returns to the library, not the paste box
  });

  // ---------- where reading starts and ends ----------
  var T = { id: null, lines: [], start: 0, end: 0, sel: -1, origin: 'new' };
  function countLines(s) { return s === '' ? 0 : s.split('\n').length; }
  function openTrim(id) {
    var s = script(id);
    T.id = id;
    T.lines = P.join(s).split('\n');
    T.start = countLines(s.head);
    T.end = T.start + countLines(s.body) - 1;
    T.sel = -1;
    $('trimTitle').value = entry(id).title;
    renderTrim(true);
  }
  function renderTrim(scroll) {
    var list = $('trimList');
    list.innerHTML = '';
    var startEl = null;
    T.lines.forEach(function (l, i) {
      if (i === T.start) { startEl = edge('Reading starts'); list.appendChild(startEl); }
      var d = document.createElement('div');
      d.className = 'tl' + (i < T.start || i > T.end ? ' out' : '') + (i === T.sel ? ' sel' : '');
      d.textContent = l || ' ';
      d.setAttribute('data-i', i);
      list.appendChild(d);
      if (i === T.end) list.appendChild(edge('Reading ends'));
    });
    var e = entry(T.id);
    $('trimInfo').textContent = e.words + ' words · about ' + Math.max(1, Math.round(e.words / e.wpm)) + ' min at ' + e.wpm + ' a minute';
    $('trimActions').hidden = T.sel < 0;
    if (scroll && startEl) list.scrollTop = Math.max(0, startEl.offsetTop - list.offsetTop - 80);
  }
  function edge(text) {
    var d = document.createElement('div');
    d.className = 'edge';
    d.textContent = text;
    return d;
  }
  $('trimList').addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.tl') : ev.target;
    if (!t || !t.hasAttribute('data-i')) return;
    var i = +t.getAttribute('data-i');
    T.sel = T.sel === i ? -1 : i;
    var prev = $('trimList').querySelector('.tl.sel');
    if (prev) prev.classList.remove('sel');
    if (T.sel >= 0) t.classList.add('sel');
    $('trimActions').hidden = T.sel < 0;
  });
  function applyTrim(start, end) {
    var top = $('trimList').scrollTop;
    T.start = start;
    T.end = end;
    T.sel = -1;
    storeScript(T.id, P.split(T.lines.join('\n'), start, end));
    $('trimTitle').value = entry(T.id).title;
    renderTrim(false);
    $('trimList').scrollTop = top;
  }
  $('trimStart').addEventListener('click', function () { applyTrim(T.sel, Math.max(T.end, T.sel)); });
  $('trimEnd').addEventListener('click', function () { applyTrim(Math.min(T.start, T.sel), T.sel); });
  $('trimTitle').addEventListener('change', function () {
    var e = entry(T.id), v = this.value.trim();
    if (v) { e.title = v; e.named = true; } else { e.named = false; e.title = P.title(script(T.id).body); this.value = e.title; }
    saveIndex();
  });
  function trimBack() { if (T.origin === 'edit') back('#/read/' + T.id); else back('#/'); }
  $('trimRead').addEventListener('click', function () {
    $('trimTitle').blur();
    if (T.origin === 'edit') back('#/read/' + T.id);
    else nav('#/read/' + T.id, true);
  });

  // ---------- edit ----------
  var E = { id: null, timer: 0, line: 0 };
  function openEdit(id) {
    var s = script(id), box = $('editBox');
    E.id = id;
    $('editTitle').textContent = entry(id).title;
    $('editSaved').textContent = 'Saved';
    // open at the line being read: measure how tall the text above it is, then scroll there
    var lines = s.body.split('\n');
    var at = clamp(E.line, 0, lines.length - 1);
    var offset = lines.slice(0, at).join('\n').length + (at ? 1 : 0);
    // (a textarea never reports its content shorter than itself, so measure it collapsed)
    box.style.flex = 'none';
    box.style.height = '0px';
    box.value = s.body.slice(0, offset) + (lines[at] || '');
    var h = box.scrollHeight;
    box.style.flex = '';
    box.style.height = '';
    box.value = s.body;
    box.scrollTop = Math.max(0, h - box.clientHeight / 3);
    box.setSelectionRange(offset, offset);
  }
  function flushEdit() {
    if (!E.id) return;
    clearTimeout(E.timer);
    E.timer = 0;
    var s = script(E.id);
    if (s && s.body !== $('editBox').value) {
      s.body = $('editBox').value;
      storeScript(E.id, s);
    }
    $('editSaved').textContent = 'Saved';
  }
  $('editBox').addEventListener('input', function () {
    $('editSaved').textContent = 'Saving…';
    clearTimeout(E.timer);
    E.timer = setTimeout(flushEdit, 500);
  });
  function caretLine() {
    var box = $('editBox');
    return box.value.slice(0, box.selectionStart).split('\n').length - 1;
  }
  $('editDone').addEventListener('click', function () {
    flushEdit();
    save('p.' + E.id, { line: caretLine(), frac: 0 });   // back on the line just edited
    back('#/read/' + E.id);
  });
  $('editTrim').addEventListener('click', function () {
    flushEdit();
    save('p.' + E.id, { line: caretLine(), frac: 0 });
    T.origin = 'edit';
    nav('#/trim/' + E.id, true);
  });

  // ---------- keeping the screen on ----------
  var Awake = {
    lock: null, vid: null, want: false,
    on: function () {
      var self = this;
      self.want = true;
      if (navigator.wakeLock && window.isSecureContext) {
        if (self.lock) return;
        navigator.wakeLock.request('screen').then(function (l) {
          self.lock = l;
          l.addEventListener('release', function () { self.lock = null; });
        }, function () { self.video(); });
      } else self.video();
    },
    video: function () {
      if (!this.vid) {
        var v = document.createElement('video');
        v.muted = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.loop = true;
        v.src = window.AWAKE_MP4;
        v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
        document.body.appendChild(v);
        this.vid = v;
      }
      var p = this.vid.play();
      if (p && p.catch) p.catch(function () { /* tried again on the next tap */ });
    },
    off: function () {
      this.want = false;
      if (this.lock) { this.lock.release(); this.lock = null; }
      if (this.vid) this.vid.pause();
    }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (Awake.want) Awake.on(); }
    else if (current === 'read') { pause(); savePos(); }
  });

  function goFull() {
    var d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var f = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!f) return;
    try { var p = f.call(d); if (p && p.catch) p.catch(function () { /* stays in the window */ }); } catch (e) { /* same */ }
  }

  // ---------- the reader ----------
  var R = { id: null, blocks: [], els: [], tops: [], hts: [], words: 0, wpm: S.wpm, y: 0, vel: 0, v: 0,
            maxY: 0, markerPx: 0, lineH: 0, anchor: { i: -1, f: 0 }, playing: false, dragging: false,
            countdown: null, raf: 0, last: 0, glide: null, faded: false, fadeT: 0, uiT: 0, saveT: 0,
            ptr: null, swallow: false, rz: 0 };
  var stage = $('stage'), track = $('track');

  function openRead(id) {
    var e = entry(id), s = script(id);
    R.id = id;
    R.wpm = e.wpm || S.wpm;
    e.opened = Date.now();
    saveIndex();
    var p = P.parse(s.body);
    R.blocks = p.blocks;
    R.words = p.words;
    build();
    var pos = load('p.' + id, null);
    R.anchor = pos && pos.line >= 0 ? anchorFor(pos.line, pos.frac) : { i: -1, f: 0 };
    R.playing = false;
    R.vel = 0;
    R.glide = null;
    $('readTitle').textContent = e.title;
    $('look').hidden = true;
    setPlayIcon();
    applySettings();
    wakeHud();
    Awake.on();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (current === 'read') layout(); });
  }

  function leaveRead() {
    pause();
    savePos();
    Awake.off();
    R.id = null;
  }

  function build() {
    var frag = document.createDocumentFragment();
    R.els = R.blocks.map(function (b) {
      var d = document.createElement('div');
      d.className = 'b ' + (b.kind === 'cue' ? 'cueLine' : b.kind);
      b.segs.forEach(function (s) {
        var n;
        if (s.cue) { n = document.createElement('span'); n.className = 'cue'; n.textContent = s.text; }
        else if (s.bold && b.kind !== 'key') { n = document.createElement('b'); n.textContent = s.text; }
        else n = document.createTextNode(s.text);
        d.appendChild(n);
      });
      frag.appendChild(d);
      return d;
    });
    track.innerHTML = '';
    track.appendChild(frag);
  }

  function anchorFor(line, frac) {
    for (var i = 0; i < R.blocks.length; i++) {
      if (R.blocks[i].src >= line) return { i: i, f: R.blocks[i].src === line ? frac : 0 };
    }
    return { i: R.blocks.length - 1, f: 1 };
  }

  function applySettings() {
    var st = document.documentElement.style;
    st.setProperty('--size', S.size + 'px');
    st.setProperty('--lh', S.lineH);
    st.setProperty('--margin', S.margin + '%');
    st.setProperty('--align', S.align);
    st.setProperty('--weight', S.weight);
    stage.style.transform = 'scale(' + (S.mirrorX ? -1 : 1) + ',' + (S.mirrorY ? -1 : 1) + ')';
    track.className = S.align === 'center' ? 'center' : '';
    $('marks').hidden = !S.arrows;
    layout();
  }

  function layout() {
    if (!R.id) return;
    var vh = stage.clientHeight;
    R.lineH = S.size * S.lineH;
    R.markerPx = vh * S.marker / 100;
    track.style.paddingTop = Math.max(0, R.markerPx - R.lineH / 2) + 'px';
    track.style.paddingBottom = vh + 'px';
    var unit = S.pauses * R.lineH;
    R.els.forEach(function (d, k) { d.style.paddingBottom = (R.blocks[k].gap * unit).toFixed(1) + 'px'; });
    R.tops = [];
    R.hts = [];
    R.els.forEach(function (d, k) { R.tops[k] = d.offsetTop; R.hts[k] = d.offsetHeight; });
    var n = R.els.length;
    var end = n ? R.tops[n - 1] + R.hts[n - 1] : 0;
    R.maxY = Math.max(0, end - R.markerPx);
    speed();
    var m = R.markerPx, L = R.lineH;
    $('shade').style.background = S.dim ? 'linear-gradient(to bottom, rgba(0,0,0,.66) 0px, rgba(0,0,0,.66) ' +
      Math.max(0, m - 1.1 * L) + 'px, rgba(0,0,0,0) ' + Math.max(0, m - 0.55 * L) + 'px, rgba(0,0,0,0) ' +
      (m + 1.6 * L) + 'px, rgba(0,0,0,.2) ' + (m + 3.2 * L) + 'px, rgba(0,0,0,.2) 100%)' : 'none';
    var marks = $('marks').children;
    marks[0].style.top = marks[1].style.top = (m - 14) + 'px';
    $('count').style.top = (m - 75) + 'px';
    var a = R.anchor;
    setY(a.i < 0 ? 0 : R.tops[a.i] + a.f * R.hts[a.i] - R.markerPx);
    updateUi();
  }

  // pixels a second that cover the script in the time its words take at this pace
  function speed() {
    R.v = R.words ? R.maxY / (R.words / R.wpm * 60) : R.lineH * 0.8;
  }

  function setY(y) {
    R.y = clamp(y, 0, R.maxY);
    track.style.transform = 'translate3d(0,' + (-R.y).toFixed(2) + 'px,0)';
    if (R.y < 0.5 || !R.els.length) R.anchor = { i: -1, f: 0 };
    else {
      var c = R.y + R.markerPx, lo = 0, hi = R.tops.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (R.tops[mid] <= c) lo = mid; else hi = mid - 1; }
      R.anchor = { i: lo, f: (c - R.tops[lo]) / (R.hts[lo] || 1) };
    }
    if (!R.uiT) R.uiT = setTimeout(function () { R.uiT = 0; updateUi(); }, 200);
    if (!R.saveT) R.saveT = setTimeout(function () { R.saveT = 0; savePos(); }, 1500);
  }

  function savePos() {
    if (!R.id) return;
    var a = R.anchor;
    save('p.' + R.id, a.i < 0 ? { line: -1, frac: 0 } : { line: R.blocks[a.i].src, frac: Math.round(a.f * 1000) / 1000 });
  }

  function updateUi() {
    if (!R.id) return;
    $('wpm').textContent = R.wpm;
    var v = R.v || 1;
    $('left').textContent = clock((R.maxY - R.y) / v);
    $('total').textContent = 'left of ' + clock(R.maxY / v);
    $('progress').style.width = (R.maxY ? R.y / R.maxY * 100 : 0).toFixed(2) + '%';
  }

  function kick() { if (!R.raf) { R.last = 0; R.raf = requestAnimationFrame(tick); } }
  function tick(now) {
    R.raf = 0;
    var dt = R.last ? Math.min(0.1, (now - R.last) / 1000) : 0;
    R.last = now;
    if (R.glide) {
      var g = R.glide, t = Math.min(1, (now - g.t0) / g.ms);
      setY(g.from + (g.to - g.from) * (1 - Math.pow(1 - t, 3)));
      if (t >= 1) R.glide = null;
    } else if (!R.dragging) {
      var target = R.playing ? R.v : 0;
      var tau = target > R.vel ? 0.35 : 0.18;            // a gentle start, a quicker stop
      R.vel += (target - R.vel) * (1 - Math.exp(-dt / tau));
      if (!R.playing && R.vel < 4) R.vel = 0;           // settled: stops within about half a second
      if (R.vel) setY(R.y + R.vel * dt);
      if (R.playing && R.y >= R.maxY) pause();
    }
    if (R.playing || R.vel || R.glide) R.raf = requestAnimationFrame(tick);
  }

  function glideTo(y) {
    if (!R.playing) R.vel = 0;                         // a paused prompter must not creep on after the glide
    R.glide = { from: R.y, to: clamp(y, 0, R.maxY), t0: performance.now(), ms: 320 };
    kick();
  }

  function play() {
    if (R.playing || R.countdown) return;
    if (R.y >= R.maxY - 1) return;
    goFull();
    Awake.on();
    var n = R.y < 1 ? S.countdown : 0;
    if (n) {
      var c = $('count');
      c.textContent = n;
      c.hidden = false;
      R.countdown = setInterval(function () {
        n--;
        if (n > 0) { c.textContent = n; return; }
        stopCountdown();
        start();
      }, 1000);
      setPlayIcon();
      wakeHud();
    } else start();
  }
  function start() { R.playing = true; setPlayIcon(); wakeHud(); kick(); }
  function stopCountdown() {
    if (R.countdown) { clearInterval(R.countdown); R.countdown = null; }
    $('count').hidden = true;
  }
  function pause() {
    stopCountdown();
    if (R.playing) { R.playing = false; savePos(); }
    setPlayIcon();
    wakeHud();
    kick();
  }
  function toggle() { if (R.playing || R.countdown) pause(); else play(); }
  function setPlayIcon() {
    var on = R.playing || !!R.countdown;
    $('playIcon').style.setProperty('--i', 'url(icons/' + (on ? 'pause' : 'play') + '-24-filled.svg)');
    $('play').title = on ? 'Pause' : 'Play';
  }

  function setWpm(w) {
    R.wpm = clamp(Math.round(w), 40, 260);
    var e = entry(R.id);
    if (e) { e.wpm = R.wpm; saveIndex(); }
    S.wpm = R.wpm;                         // new scripts start at the last pace used
    saveSettings();
    speed();
    updateUi();
  }

  // n lines back (n > 0) or ahead (n < 0)
  // (quick presses add up: each counts from where the last one is heading)
  function stepLines(n) {
    var i = R.glide && R.glide.k !== undefined ? R.glide.k : R.anchor.i;
    if (i < 0) { if (n > 0) return; i = 0; }
    var k = i - n;
    if (k < 0) { glideTo(0); R.glide.k = -1; return; }
    k = Math.min(k, R.blocks.length - 1);
    glideTo(R.tops[k] + R.lineH / 2 - R.markerPx);
    R.glide.k = k;
  }

  // controls fade almost to nothing while reading, so they do not show in the glass;
  // a tap on a faded control only brings them back
  function wakeHud() {
    R.faded = false;
    $('hudTop').classList.remove('faded');
    $('hudBot').classList.remove('faded');
    clearTimeout(R.fadeT);
    if (R.playing || R.countdown) {
      R.fadeT = setTimeout(function () {
        if (!(R.playing || R.countdown)) return;
        R.faded = true;
        $('hudTop').classList.add('faded');
        $('hudBot').classList.add('faded');
      }, 2500);
    }
  }
  ['hudTop', 'hudBot'].forEach(function (h) {
    $(h).addEventListener('pointerdown', function (e) {
      if (R.faded) { R.swallow = true; e.stopPropagation(); e.preventDefault(); }
      wakeHud();
    }, true);
    $(h).addEventListener('click', function (e) {
      if (R.swallow) { R.swallow = false; e.stopPropagation(); e.preventDefault(); }
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }, true);
  });

  // tap the text to pause or play; drag it to move back or ahead
  stage.addEventListener('pointerdown', function (e) {
    if (!$('look').hidden) { closeLook(); return; }
    R.ptr = { id: e.pointerId, y0: e.clientY, from: R.y, moved: false };
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* not needed for touch */ }
  });
  stage.addEventListener('pointermove', function (e) {
    var p = R.ptr;
    if (!p || e.pointerId !== p.id) return;
    var dy = e.clientY - p.y0;
    if (!p.moved) {
      if (Math.abs(dy) < 10) return;
      p.moved = true;
      p.y0 = e.clientY;
      p.from = R.y;
      dy = 0;
      R.dragging = true;
      R.vel = 0;
      R.glide = null;
      wakeHud();
    }
    setY(p.from - dy * (S.mirrorY ? -1 : 1));
  });
  function endPointer(e, tap) {
    var p = R.ptr;
    if (!p || e.pointerId !== p.id) return;
    R.ptr = null;
    R.dragging = false;
    if (!p.moved && tap) toggle();
    else { wakeHud(); kick(); }
  }
  stage.addEventListener('pointerup', function (e) { endPointer(e, true); });
  stage.addEventListener('pointercancel', function (e) { endPointer(e, false); });
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    R.glide = null;
    setY(R.y + e.deltaY * (S.mirrorY ? -1 : 1));
  }, { passive: false });

  function repeatButton(el, fn) {
    var t1 = 0, t2 = 0;
    function stop() { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; }
    el.addEventListener('pointerdown', function (e) {
      if (e.defaultPrevented) return;                   // the tap only woke the controls
      fn();
      stop();
      t1 = setTimeout(function () { t2 = setInterval(fn, 110); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, stop); });
  }
  repeatButton($('slower'), function () { setWpm(R.wpm - 2); });
  repeatButton($('faster'), function () { setWpm(R.wpm + 2); });
  $('play').addEventListener('click', toggle);
  $('backBit').addEventListener('click', function () { stepLines(3); });
  $('toStart').addEventListener('click', function () { pause(); glideTo(0); });
  $('readBack').addEventListener('click', function () { back('#/'); });
  $('readEdit').addEventListener('click', function () {
    pause();
    savePos();
    E.line = R.anchor.i < 0 ? 0 : R.blocks[R.anchor.i].src;
    nav('#/edit/' + R.id);
  });
  $('readLook').addEventListener('click', function () { pause(); $('look').hidden = false; syncLook(); });
  $('lookDone').addEventListener('click', closeLook);
  function closeLook() { $('look').hidden = true; }

  // keyboard, and the Bluetooth page turners and foot pedals that act as one
  document.addEventListener('keydown', function (e) {
    if (current !== 'read' || !$('dialog').hidden) return;
    if (!$('look').hidden) { if (e.key === 'Escape') closeLook(); return; }
    var k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'PageDown' || k === 'MediaPlayPause' || k === 'k') toggle();
    else if (k === 'PageUp' || k === 'ArrowLeft') stepLines(3);
    else if (k === 'ArrowRight') stepLines(-3);
    else if (k === 'ArrowUp' || k === '+' || k === '=') setWpm(R.wpm + 2);
    else if (k === 'ArrowDown' || k === '-') setWpm(R.wpm - 2);
    else if (k === 'Home') { pause(); glideTo(0); }
    else if (k === 'Escape') pause();
    else return;
    e.preventDefault();
    wakeHud();
  });

  // ---------- display settings ----------
  var RANGES = { size: function (v) { return v; }, lineH: function (v) { return (+v).toFixed(2); },
                 margin: function (v) { return v + '%'; }, marker: function (v) { return v + '% from the top'; } };
  function syncLook() {
    Object.keys(RANGES).forEach(function (k) {
      $('s-' + k).value = S[k];
      $('o-' + k).textContent = RANGES[k](S[k]);
    });
    ['pauses', 'countdown', 'align', 'weight'].forEach(function (k) {
      Array.prototype.forEach.call($('s-' + k).children, function (b) {
        b.classList.toggle('on', String(b.getAttribute('data-v')) === String(S[k]));
      });
    });
    ['mirrorX', 'mirrorY', 'dim', 'arrows'].forEach(function (k) { $('s-' + k).classList.toggle('on', !!S[k]); });
  }
  Object.keys(RANGES).forEach(function (k) {
    $('s-' + k).addEventListener('input', function () {
      S[k] = parseFloat(this.value);
      saveSettings();
      $('o-' + k).textContent = RANGES[k](S[k]);
      applySettings();
    });
  });
  ['pauses', 'countdown', 'align', 'weight'].forEach(function (k) {
    $('s-' + k).addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-v');
      if (v === null || v === undefined) return;
      S[k] = k === 'align' ? v : parseFloat(v);
      saveSettings();
      syncLook();
      applySettings();
    });
  });
  ['mirrorX', 'mirrorY', 'dim', 'arrows'].forEach(function (k) {
    $('s-' + k).addEventListener('click', function () {
      S[k] = !S[k];
      saveSettings();
      syncLook();
      applySettings();
    });
  });

  // turning the tablet or entering full screen: same line, same pace
  window.addEventListener('resize', function () {
    if (current !== 'read' || R.rz) return;
    R.rz = requestAnimationFrame(function () { R.rz = 0; layout(); });
  });
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', function () { if (current === 'read') layout(); });
  }
  window.addEventListener('pagehide', function () { savePos(); flushEdit(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* works without it, just not offline */ });
  }

  // for tests and for checking things from the console
  window.Prompter = { R: R, S: S, layout: layout, setWpm: setWpm, play: play, pause: pause };

  route();
})();
