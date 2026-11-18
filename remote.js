/* Phone remote.
 *
 * The tablet shows a QR code holding a link with a random pairing code. The phone that opens it
 * becomes a remote. The two connect directly (a WebRTC data channel: on the same Wi-Fi the taps
 * never leave the house). To find each other they swap one "offer" and one "answer" through
 * ntfy.sh, a free public message relay, on a topic named after the code, with nothing stored
 * there (cache=no). Only connection details go through it, never a script.
 *
 * The tablet keeps listening on its code whenever the app is open, so a phone that was paired
 * once reconnects by itself. "New code" un-pairs every phone. Runs before app.js, and only uses
 * window.Prompter inside functions.
 */
(function () {
  'use strict';
  var RELAY = 'https://ntfy.sh/';
  var ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  var ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';      // no 0/o, 1/l/i to misread
  function $(id) { return document.getElementById(id); }
  function P() { return window.Prompter; }

  function loadMine() { try { return JSON.parse(localStorage.getItem('rsp.remote')) || {}; } catch (e) { return {}; } }
  function saveMine(v) { try { localStorage.setItem('rsp.remote', JSON.stringify(v)); } catch (e) { /* stays for this visit */ } }
  function newCode(n) {
    var out = '', a = new Uint32Array(n || 8);
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) out += ALPHABET[a[i] % ALPHABET.length];
    return out;
  }
  function pretty(code) { return code.slice(0, 4) + '-' + code.slice(4); }
  function clean(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ---------- the relay, used only to swap connection details ----------
  function topic(code) { return RELAY + 'rs-teleprompter-' + code; }
  function publish(code, msg) {
    return fetch(topic(code) + '?cache=no', { method: 'POST', body: JSON.stringify(msg) });
  }
  function listen(code, onMsg, onOpen) {
    var es = new EventSource(topic(code) + '/sse');
    es.onopen = function () { if (onOpen) onOpen(); };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (m.event === 'message') onMsg(JSON.parse(m.message));
      } catch (x) { /* someone else's message on the topic: ignore */ }
    };
    return es;
  }
  // send connection details only once they are complete (simpler than sending them piecemeal)
  function gathered(pc) {
    return new Promise(function (done) {
      if (pc.iceGatheringState === 'complete') return done();
      var t = setTimeout(done, 3000);
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); }
      });
    });
  }
  function closePc(pc) { try { if (pc) pc.close(); } catch (e) { /* already closed */ } }

  // =====================================================================
  // The tablet: answers phones, carries out their taps, tells them what it shows
  // =====================================================================
  var H = { code: null, es: null, pc: null, ch: null, linked: false, sendT: 0, lastSections: '' };

  function hostStart() {
    var mine = loadMine();
    if (!mine.code) { mine.code = newCode(); saveMine(mine); }
    if (H.es && H.code === mine.code) return;
    hostStop();
    H.code = mine.code;
    H.es = listen(H.code, function (msg) { if (msg.type === 'offer' && msg.sdp && msg.from) answer(msg); });
  }
  function hostStop() {
    if (H.es) H.es.close();
    closePc(H.pc);
    H.es = H.pc = H.ch = null;
    setLinked(false);
  }
  function answer(msg) {
    closePc(H.pc);                                        // the newest phone takes over
    var pc = H.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.ondatachannel = function (e) { hostChannel(pc, e.channel); };
    pc.onconnectionstatechange = function () {
      if (pc === H.pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) setLinked(false);
    };
    pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
      .then(function () { return pc.createAnswer(); })
      .then(function (a) { return pc.setLocalDescription(a); })
      .then(function () { return gathered(pc); })
      .then(function () { return publish(H.code, { type: 'answer', to: msg.from, sdp: pc.localDescription.sdp }); })
      .catch(function () { /* the phone tries again by itself */ });
  }
  function hostChannel(pc, ch) {
    ch.onopen = function () {
      if (pc !== H.pc) return;
      H.ch = ch;
      H.lastSections = '';
      setLinked(true);
      sendState();
    };
    ch.onclose = function () { if (H.ch === ch) { H.ch = null; setLinked(false); } };
    ch.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'cmd' && P()) P().command(m.c, m.i);
      if (m.t === 'hello') { H.lastSections = ''; sendState(); }
    };
  }
  function sendState() {
    if (!H.ch || H.ch.readyState !== 'open' || !P()) return;
    var s = P().state();
    var secs = JSON.stringify(s.sections || []);
    if (secs === H.lastSections) delete s.sections;      // the list only travels when it changes
    else H.lastSections = secs;
    s.t = 'state';
    try { H.ch.send(JSON.stringify(s)); } catch (e) { /* closing */ }
  }
  window.addEventListener('prompter-state', function () {
    if (!H.ch || H.sendT) return;
    H.sendT = setTimeout(function () { H.sendT = 0; sendState(); }, 120);
  });
  function setLinked(on) {
    H.linked = on;
    $('remoteDot').hidden = !on;
    pairStatus();
  }
  function pairStatus() {
    var el = $('pairStatus');
    el.textContent = H.linked ? 'Phone connected' : 'Waiting for the phone…';
    el.className = 'pairStatus' + (H.linked ? ' on' : '');
  }
  // the Remote sheet on the reading screen
  function pairing() {
    hostStart();
    var url = location.href.split('#')[0] + '#/remote/' + H.code;
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    $('pairCode').textContent = pretty(H.code);
    $('pairUrl').textContent = location.host + location.pathname.replace(/index\.html$/, '');
    pairStatus();
  }
  $('pairNew').addEventListener('click', function () {
    var mine = loadMine();
    mine.code = newCode();
    saveMine(mine);
    hostStop();
    pairing();
  });
  $('pairOff').addEventListener('click', function () {
    var mine = loadMine();
    delete mine.code;
    saveMine(mine);
    hostStop();
    $('remoteSheet').hidden = true;
  });

  // =====================================================================
  // The phone: the remote screen (#/remote/<code>)
  // =====================================================================
  var C = { code: null, me: null, es: null, pc: null, ch: null, linked: false, tries: 0, waitT: 0, retryT: 0, sections: [] };

  function view(code) {
    leave();
    code = clean(code);
    var mine = loadMine();
    if (!code) {
      $('rmJoin').hidden = false;
      $('rmPanel').hidden = true;
      $('rmCode').value = mine.last ? pretty(mine.last) : '';
      status('', '');
      return;
    }
    mine.last = code;
    saveMine(mine);
    C.code = code;
    C.me = newCode(10);
    $('rmJoin').hidden = true;
    $('rmPanel').hidden = false;
    render({ open: false, waiting: true });
    if (P()) P().awake(true);
    status('Connecting…', '');
    C.es = listen(code, function (msg) {
      if (msg.type === 'answer' && msg.to === C.me && C.pc && C.pc.signalingState === 'have-local-offer') {
        C.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(function () { /* retried */ });
      }
    }, function () { if (!C.linked && !C.pc) offer(); });
  }
  function offer() {
    closePc(C.pc);
    clearTimeout(C.waitT);
    var pc = C.pc = new RTCPeerConnection({ iceServers: ICE });
    var ch = pc.createDataChannel('remote');
    ch.onopen = function () {
      if (pc !== C.pc) return;
      C.ch = ch;
      C.tries = 0;
      clearTimeout(C.waitT);
      setClientLinked(true);
      ch.send(JSON.stringify({ t: 'hello' }));
    };
    ch.onclose = function () { if (C.ch === ch) { C.ch = null; lost(); } };
    ch.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'state') render(m);
    };
    pc.onconnectionstatechange = function () { if (pc === C.pc && pc.connectionState === 'failed') lost(); };
    pc.createOffer()
      .then(function (o) { return pc.setLocalDescription(o); })
      .then(function () { return gathered(pc); })
      .then(function () { if (pc === C.pc) return publish(C.code, { type: 'offer', from: C.me, sdp: pc.localDescription.sdp }); })
      .catch(function () { /* the timer below tries again */ });
    C.waitT = setTimeout(function () {
      if (C.linked || pc !== C.pc) return;
      C.tries++;
      status('Looking for the tablet…', '');
      note(C.tries >= 2 ? 'Is the teleprompter open on the tablet? Both need the internet to find each other.' : '');
      offer();
    }, 10000);
  }
  function lost() {
    if (!C.code) return;
    setClientLinked(false);
    status('Reconnecting…', '');
    clearTimeout(C.retryT);
    C.retryT = setTimeout(function () { if (C.code && !C.linked) offer(); }, 1500);
  }
  function leave() {
    clearTimeout(C.waitT);
    clearTimeout(C.retryT);
    if (C.es) C.es.close();
    closePc(C.pc);
    C.code = C.es = C.pc = C.ch = null;
    C.linked = false;
    if (P()) P().awake(false);
  }
  function setClientLinked(on) {
    C.linked = on;
    status(on ? 'Connected' : 'Connecting…', on ? 'on' : '');
    if (on) note('');
  }
  function status(text, cls) {
    var el = $('rmStatus');
    el.textContent = text;
    el.hidden = !text;
    el.className = 'pill' + (cls ? ' ' + cls : '');
  }
  function note(text) { $('rmNote').textContent = text; $('rmNote').hidden = !text; }

  function render(s) {
    var clock = P() ? P().clock : function (x) { return Math.round(x) + ' s'; };
    var ready = !!s.open && C.linked;
    ['rmBack', 'rmPlay', 'rmFwd', 'rmSlower', 'rmFaster', 'rmStart'].forEach(function (id) { $(id).disabled = !ready; });
    if (!s.open) {
      $('rmTitle').textContent = s.waiting ? 'Connecting to the tablet' : 'Open a script on the tablet';
      $('rmLine').textContent = s.waiting ? '' : 'The controls work once a script is open for reading.';
      $('rmBar').style.width = '0';
      $('rmTime').textContent = '';
      $('rmWpm').textContent = '–';
      $('rmSections').hidden = true;
      C.sections = [];
      return;
    }
    $('rmTitle').textContent = s.title;
    $('rmLine').textContent = s.line;
    $('rmBar').style.width = (s.frac * 100).toFixed(1) + '%';
    $('rmTime').textContent = clock(s.left) + ' left of ' + clock(s.total);
    $('rmWpm').textContent = s.wpm;
    var on = s.playing || s.counting;
    $('rmPlayIcon').style.setProperty('--i', 'url(icons/' + (on ? 'pause' : 'play') + '-24-filled.svg)');
    if (s.sections) {
      C.sections = s.sections;
      var box = $('rmSecList');
      box.innerHTML = '';
      s.sections.forEach(function (sec, j) {
        var b = document.createElement('button');
        b.className = 'secRow';
        b.innerHTML = '<span class="secTime"></span><span class="secTitle"></span>';
        b.firstChild.textContent = clock(sec.at);
        b.lastChild.textContent = sec.title;
        b.addEventListener('click', function () { send('section', j); });
        box.appendChild(b);
      });
      $('rmSections').hidden = !s.sections.length;
    }
    Array.prototype.forEach.call($('rmSecList').children, function (b, j) { b.classList.toggle('on', j === s.cur); });
  }

  function send(c, i) {
    if (!C.ch || C.ch.readyState !== 'open') return;
    C.ch.send(JSON.stringify({ t: 'cmd', c: c, i: i }));
    if (navigator.vibrate) navigator.vibrate(12);
  }
  function hold(el, c) {
    var t1 = 0, t2 = 0;
    function stop() { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; }
    el.addEventListener('pointerdown', function () {
      if (el.disabled) return;
      send(c);
      stop();
      t1 = setTimeout(function () { t2 = setInterval(function () { send(c); }, 120); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, stop); });
  }
  $('rmPlay').addEventListener('click', function () { send('toggle'); });
  $('rmBack').addEventListener('click', function () { send('back'); });
  $('rmFwd').addEventListener('click', function () { send('fwd'); });
  $('rmStart').addEventListener('click', function () { send('start'); });
  hold($('rmSlower'), 'slower');
  hold($('rmFaster'), 'faster');
  function join() {
    var code = clean($('rmCode').value);
    if (code.length !== 8) { $('rmCode').focus(); return; }
    if (P()) P().nav('#/remote/' + code, true);
  }
  $('rmConnect').addEventListener('click', join);
  $('rmCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });

  // a tablet paired before listens again as soon as the app opens
  setTimeout(function () { if (loadMine().code) hostStart(); }, 0);

  window.Remote = { view: view, leave: leave, pairing: pairing };
})();
