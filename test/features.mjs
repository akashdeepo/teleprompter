// Sections, back up and restore, and the phone remote, in headless Chrome.
//   node prompter/test/features.mjs [script.txt] [screenshot folder]
// The remote test uses two separate browser profiles (a "tablet" and a "phone") that connect
// through the real ntfy.sh relay, so it needs the internet.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-shots-'));
fs.mkdirSync(shots, { recursive: true });
const SAMPLE = 'नोट: यह एक लंबी सलाह है जिसे पढ़ा नहीं जाएगा क्योंकि यह स्क्रिप्ट का हिस्सा नहीं है बस एक टिप्पणी है।\n\n' +
  Array.from({ length: 150 }, (_, i) => (i % 30 === 0 ? `### भाग ${i / 30 + 1}` : `पंक्ति ${i} के कुछ शब्द`)).join('\n');
const TEXT = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : SAMPLE;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const PORT = 18791, DEBUG = 9556, BASE = `http://127.0.0.1:${PORT}/`;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-chrome-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let version;
for (let i = 0; i < 50; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json(); break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 200));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// one browser connection; each "device" is a page in its own browser context (own storage)
const bws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => bws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const errors = [];
bws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const call = (method, params = {}, sessionId) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); bws.send(JSON.stringify({ id, method, params, sessionId }));
});
async function device(name, w, h, mobile) {
  const { result: { browserContextId } } = await call('Target.createBrowserContext');
  const { result: { targetId } } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Runtime.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
  const ev = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result.exceptionDetails) throw new Error(name + ': ' + expression + '\n' + JSON.stringify(r.result.exceptionDetails, null, 1));
    return r.result.result.value;
  };
  const go = async (url) => { await call('Page.navigate', { url }, sessionId); await wait(900); };
  const shot = async (file) => {
    const r = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(shots, file + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const until = async (expression, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expression)) return true; await wait(250); }
    return false;
  };
  return { ev, go, shot, until, sessionId };
}
const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }

// ---------- tablet: add the script and open it ----------
const tablet = await device('tablet', 1280, 800, false);
await tablet.go(BASE);
await tablet.ev(`document.getElementById('newScript').click()`);
await wait(200);
await tablet.ev(`(() => { const b = document.getElementById('pasteBox'); b.value = ${JSON.stringify(TEXT)}; b.dispatchEvent(new Event('input')); })()`);
await tablet.ev(`document.getElementById('pasteNext').click()`);
await wait(300);
await tablet.ev(`document.getElementById('trimRead').click()`);
await wait(1000);

// ---------- sections ----------
await tablet.ev(`document.getElementById('readSections').click()`);
await wait(200);
const secs = await tablet.ev(`[...document.querySelectorAll('#secList .secRow')].map(b => ({ time: b.firstChild.textContent, title: b.lastChild.textContent, on: b.classList.contains('on') }))`);
const secs_s = secs.map((s) => s.time.split(':').reduce((m, x) => m * 60 + +x, 0));
check('sections list the ### headings, times rising', secs.length >= 2 && secs_s.every((t, i) => !i || t > secs_s[i - 1]), secs.slice(0, 4));
await tablet.shot('f1-sections');
const target = Math.min(2, secs.length - 1);
await tablet.ev(`document.querySelectorAll('#secList .secRow')[${target}].click()`);
await wait(600);
const at = await tablet.ev(`(() => { const R = Prompter.R; return { kind: R.blocks[R.anchor.i].kind, text: R.els[R.anchor.i].textContent, sheet: !document.getElementById('secSheet').hidden }; })()`);
check('tapping a section puts its heading at the reading line', at.kind === 'head' && at.text === secs[target].title && !at.sheet, at);
await tablet.ev(`document.getElementById('readSections').click()`);
await wait(150);
check('the current section is marked', await tablet.ev(`document.querySelectorAll('#secList .secRow')[${target}].classList.contains('on')`));
await tablet.ev(`document.getElementById('secDone').click()`);

// ---------- back up, wipe, restore ----------
await tablet.ev(`history.back()`);
await wait(500);
const backup = await tablet.ev(`new Promise(res => { const orig = URL.createObjectURL; URL.createObjectURL = b => { b.text().then(res); URL.createObjectURL = orig; return orig.call(URL, b); };
  document.getElementById('backupBtn').click(); })`);
const data = JSON.parse(backup);
check('backup holds the script, its text and its place', data.app === 'rs-teleprompter' && data.scripts.length === 1 && data.scripts[0].text.body.length > 100 && data.scripts[0].pos, { scripts: data.scripts.length, pos: data.scripts[0].pos });
check('backup tells where the file went', await tablet.ev(`/Downloads/.test(document.getElementById('dlgText').textContent)`));
await tablet.ev(`document.getElementById('dlgOk').click()`);
await tablet.shot('f2-home-footer');
await tablet.ev(`localStorage.clear(); location.hash = ''; location.reload()`);
await wait(1200);
check('wiped: no scripts', await tablet.ev(`!document.getElementById('emptyLib').hidden`));
await tablet.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(backup)}], 'rs-teleprompter-backup.json', { type: 'application/json' }));
  const i = document.getElementById('restoreFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
await wait(400);
const askText = await tablet.ev(`document.getElementById('dlgTitle').textContent`);
await tablet.ev(`document.getElementById('dlgOk').click()`);
await wait(300);
const restored = await tablet.ev(`({ title: document.getElementById('resumeTitle').textContent, meta: document.getElementById('resumeMeta').textContent })`);
check('restore brings the script back where it was', askText === 'Restore 1 script?' && restored.title === data.scripts[0].entry.title && /% read/.test(restored.meta), { askText, ...restored });
await tablet.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['{"hello":1}'], 'x.json')); const i = document.getElementById('restoreFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
await wait(300);
check('a wrong file is refused', await tablet.ev(`document.getElementById('dlgTitle').textContent === 'This is not a teleprompter backup'`));
await tablet.ev(`document.getElementById('dlgOk').click()`);

// ---------- phone remote ----------
await tablet.ev(`document.getElementById('resumeCard').click()`);
await wait(1000);
await tablet.ev(`document.getElementById('readRemote').click()`);
await wait(500);
const pair = await tablet.ev(`({ code: document.getElementById('pairCode').textContent, qr: !!document.querySelector('#qr svg'), status: document.getElementById('pairStatus').textContent })`);
check('tablet shows a QR code and a pairing code', pair.qr && /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(pair.code), pair);
await tablet.shot('f3-pairing');
const code = pair.code.replace('-', '');

const phone = await device('phone', 390, 844, true);
await phone.go(BASE + '#/remote/' + code);
const linked = await phone.until(`document.getElementById('rmStatus').textContent === 'Connected'`, 30000);
check('phone connects to the tablet', linked, await phone.ev(`document.getElementById('rmStatus').textContent`));
await wait(800);
check('tablet shows the phone is connected', await tablet.ev(`document.getElementById('pairStatus').textContent === 'Phone connected' && !document.getElementById('remoteDot').hidden`));
await tablet.ev(`document.getElementById('remoteDone').click()`);
const ph = await phone.ev(`({ title: document.getElementById('rmTitle').textContent, wpm: document.getElementById('rmWpm').textContent, secs: document.querySelectorAll('#rmSecList .secRow').length, playDisabled: document.getElementById('rmPlay').disabled })`);
check('phone shows the script, pace and sections', ph.title === restored.title && ph.wpm === String(await tablet.ev(`Prompter.R.wpm`)) && ph.secs === secs.length && !ph.playDisabled, ph);
await phone.shot('f4-phone-remote');

const w0 = await tablet.ev(`Prompter.R.wpm`);
await phone.ev(`(() => { const b = document.getElementById('rmFaster'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); })()`);
check('phone + makes the tablet faster', await tablet.until(`Prompter.R.wpm === ${w0 + 2}`, 3000));
check('…and the phone shows the new pace', await phone.until(`document.getElementById('rmWpm').textContent === '${w0 + 2}'`, 3000));
await phone.ev(`document.getElementById('rmPlay').click()`);
check('phone play starts the tablet', await tablet.until(`Prompter.R.playing || !!Prompter.R.countdown`, 3000));
check('phone shows pause while playing', await phone.until(`document.getElementById('rmPlayIcon').style.getPropertyValue('--i').includes('pause')`, 3000));
await wait(1500);
const moving = await phone.ev(`document.getElementById('rmTime').textContent`);
await phone.ev(`document.getElementById('rmPlay').click()`);
check('phone pause stops the tablet', await tablet.until(`!Prompter.R.playing && !Prompter.R.countdown`, 3000), moving);
await phone.ev(`document.querySelectorAll('#rmSecList .secRow')[0].click()`);
check('phone section tap jumps the tablet', await tablet.until(`Prompter.R.blocks[Prompter.R.anchor.i] && Prompter.R.blocks[Prompter.R.anchor.i].kind === 'head'`, 3000));
const lat = await (async () => {
  const t0 = Date.now();
  const w = await tablet.ev(`Prompter.R.wpm`);
  await phone.ev(`(() => { const b = document.getElementById('rmSlower'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); })()`);
  await tablet.until(`Prompter.R.wpm === ${w - 2}`, 3000);
  return Date.now() - t0;
})();
check('a tap reaches the tablet quickly', lat < 600, { ms: lat });

// the tablet app is closed and opened again: the phone finds it by itself
await tablet.go(BASE);
await wait(500);
check('phone notices the tablet went away', await phone.until(`document.getElementById('rmStatus').textContent !== 'Connected'`, 10000));
const back = await phone.until(`document.getElementById('rmStatus').textContent === 'Connected'`, 40000);
check('phone reconnects when the tablet app opens again', back);
check('phone says to open a script while the tablet is on its home screen', await phone.until(`document.getElementById('rmTitle').textContent === 'Open a script on the tablet' && document.getElementById('rmPlay').disabled`, 5000));
await phone.shot('f5-phone-waiting');

// the phone without a code: the join screen
await phone.go(BASE + '#/remote');
check('remote without a code asks for one, remembering the last', await phone.ev(`!document.getElementById('rmJoin').hidden && document.getElementById('rmCode').value === '${pair.code}'`));
await phone.shot('f6-phone-join');

check('no errors in either page', errors.length === 0, errors);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed. Screenshots: ${shots}`);
bws.close();
chrome.kill();
server.close();
process.exit(results.every(Boolean) ? 0 : 1);
