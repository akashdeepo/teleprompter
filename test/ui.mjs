// Drives the prompter in headless Chrome: paste, start and end, read, play, turn, resize, reload, edit.
//   node prompter/test/ui.mjs [script.txt] [screenshot folder]
// Serves the prompter on 127.0.0.1 itself, with a fresh Chrome profile.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptFile = process.argv[2];
const shots = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-shots-'));
fs.mkdirSync(shots, { recursive: true });
const SAMPLE = 'नोट: यह वीडियो के बारे में एक लंबी सलाह है जिसे पढ़ा नहीं जाएगा क्योंकि यह स्क्रिप्ट नहीं है।\n\n' +
  Array.from({ length: 120 }, (_, i) => (i % 17 === 5 ? '**[विराम]**' : i % 9 === 0 ? `### भाग ${i}` : `पंक्ति ${i} के शब्द...`)).join('\n') +
  '\n\n### दृश्य सुझाव\n![x](https://example.com/x.png)';
const TEXT = scriptFile ? fs.readFileSync(scriptFile, 'utf8') : SAMPLE;

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
const PORT = 18790, DEBUG = 9555;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-chrome-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 200));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(expression + '\n' + JSON.stringify(r.result.exceptionDetails, null, 1));
  return r.result.result.value;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
async function size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await wait(300); }
const errors = [];
await send('Runtime.enable');
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value).join(' '));
});
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }

await size(1280, 800);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await wait(800);
check('library is empty at first', await ev(`!document.getElementById('emptyLib').hidden`));
await shot('1-library-empty');

// paste
await ev(`document.getElementById('newScript').click()`);
await wait(200);
await ev(`(() => { const b = document.getElementById('pasteBox'); b.value = ${JSON.stringify(TEXT)}; b.dispatchEvent(new Event('input')); })()`);
await ev(`document.getElementById('pasteNext').click()`);
await wait(400);
const trim = await ev(`({ hash: location.hash, first: [...document.querySelectorAll('.tl:not(.out)')][0]?.textContent,
  last: [...document.querySelectorAll('.tl:not(.out)')].pop()?.textContent, info: document.getElementById('trimInfo').textContent,
  title: document.getElementById('trimTitle').value, endIndex: [...document.querySelectorAll('.tl:not(.out)')].pop()?.getAttribute('data-i') })`);
check('paste opens start-and-end', trim.hash.startsWith('#/trim/'), trim);
await shot('2-trim');

// move the end one line earlier and back, through the UI
await ev(`(() => { const rows = [...document.querySelectorAll('.tl:not(.out)')]; rows[rows.length - 2].click(); })()`);
await ev(`document.getElementById('trimEnd').click()`);
const lastAfter = await ev(`[...document.querySelectorAll('.tl:not(.out)')].pop()?.textContent`);
check('end moves to the tapped line', lastAfter !== trim.last, lastAfter);
await ev(`document.querySelector('.tl[data-i="${trim.endIndex}"]').click()`);
await ev(`document.getElementById('trimEnd').click()`);
check('end moves back', (await ev(`[...document.querySelectorAll('.tl:not(.out)')].pop()?.getAttribute('data-i')`)) === trim.endIndex);
check('same words as detected', (await ev(`document.getElementById('trimInfo').textContent`)) === trim.info);

// read
await ev(`document.getElementById('trimRead').click()`);
await wait(900);
const r0 = await ev(`(() => { const R = Prompter.R; return { hash: location.hash, blocks: R.blocks.length, words: R.words, wpm: R.wpm,
  v: R.v, maxY: R.maxY, y: R.y, mirror: document.getElementById('stage').style.transform,
  total: document.getElementById('total').textContent, fonts: document.fonts.check('600 52px Mukta') }; })()`);
check('reader opens mirrored at the top', r0.hash.startsWith('#/read/') && r0.mirror === 'scale(-1, 1)' && r0.y === 0, r0);
check('Hindi font loaded', r0.fonts);
const expectMin = r0.words / r0.wpm;
const shown = r0.total.replace('left of ', '').split(':').map(Number);
check('total time = words / pace', Math.abs(shown[0] + shown[1] / 60 - expectMin) < 0.05, { shown: r0.total, expectMin });
await shot('3-read-landscape');

// play: countdown first, then a steady scroll at the expected speed
await ev(`document.getElementById('play').click()`);
await wait(300);
check('countdown shows', await ev(`!document.getElementById('count').hidden && document.getElementById('count').textContent === '3'`));
await shot('4-countdown');
await wait(4500);                                   // countdown, then the gentle start settles
const samples = await ev(`new Promise(res => { const out = []; let n = 0;
  (function f(now) { out.push([now, Prompter.R.y]); if (++n < 180) requestAnimationFrame(f); else res(out); })(performance.now()); })`);
const dur = (samples.at(-1)[0] - samples[0][0]) / 1000;
const speed = (samples.at(-1)[1] - samples[0][1]) / dur;
check('scrolls at the pace', Math.abs(speed / r0.v - 1) < 0.03, { pxPerSec: speed.toFixed(1), expected: r0.v.toFixed(1) });
// steady: every frame sits on the straight line between the first and last (time-based, so a slow frame cannot lag)
const off = samples.map(([t, y]) => Math.abs(y - (samples[0][1] + speed * (t - samples[0][0]) / 1000)));
check('steady, no drift or jumps', Math.max(...off) < 1.5, { worstPx: Math.max(...off).toFixed(2), frames: samples.length, seconds: dur.toFixed(2) });
check('controls fade while reading', await ev(`document.getElementById('hudBot').classList.contains('faded')`));
await shot('5-reading-faded');

// a tap on faded controls only wakes them
const before = await ev(`Prompter.R.wpm`);
await ev(`(() => { const b = document.getElementById('faster'); const r = b.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5, pointerId: 7 };
  b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerup', o)); b.dispatchEvent(new MouseEvent('click', o)); })()`);
check('first tap on faded controls does nothing', (await ev(`Prompter.R.wpm`)) === before && !(await ev(`document.getElementById('hudBot').classList.contains('faded')`)));
await ev(`(() => { const b = document.getElementById('faster'); const o = { bubbles: true, cancelable: true, pointerId: 7 };
  b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerup', o)); })()`);
check('second tap changes the pace by 2', (await ev(`Prompter.R.wpm`)) === before + 2);

// pause by tapping the text
await ev(`(() => { const s = document.getElementById('stage'); const o = { bubbles: true, clientX: 600, clientY: 400, pointerId: 3 };
  s.dispatchEvent(new PointerEvent('pointerdown', o)); s.dispatchEvent(new PointerEvent('pointerup', o)); })()`);
await wait(800);
const y1 = await ev(`Prompter.R.y`);
await wait(400);
check('tap on the text pauses', !(await ev(`Prompter.R.playing`)) && (await ev(`Prompter.R.y`)) === y1);
const line = async () => ev(`(() => { const R = Prompter.R; return { src: R.blocks[R.anchor.i]?.src, f: +R.anchor.f.toFixed(2),
  text: R.els[R.anchor.i]?.textContent, v: R.v, total: document.getElementById('total').textContent }; })()`);
const at = await line();

// turn the tablet: same line, same pace
await size(800, 1280);
await wait(300);
const atP = await line();
check('portrait keeps the line', atP.src === at.src && Math.abs(atP.f - at.f) < 0.05, { landscape: at, portrait: atP });
check('portrait keeps the total time', atP.total === at.total, [at.total, atP.total]);
await shot('6-read-portrait');
await size(1280, 800);
await wait(300);
check('back to landscape, same line', (await line()).src === at.src);

// bigger text: same line, same time
await ev(`document.getElementById('readLook').click()`);
await wait(200);
await ev(`(() => { const s = document.getElementById('s-size'); s.value = 72; s.dispatchEvent(new Event('input')); })()`);
await wait(200);
const atBig = await line();
check('bigger text keeps the line and time', atBig.src === at.src && atBig.total === at.total, atBig);
await shot('7-display');
await ev(`document.getElementById('lookDone').click()`);

// reload: settings and place survive
await send('Page.reload');
await wait(1200);
const afterReload = await line();
check('reload keeps the place', afterReload.src === at.src, afterReload);
check('reload keeps settings', (await ev(`Prompter.S.size`)) === 72 && (await ev(`Prompter.R.wpm`)) === before + 2);

// edit opens on the line being read (near the top, then far down), Done returns to the edited line
async function editCheck(label) {
  const want = await line();
  await ev(`document.getElementById('readEdit').click()`);
  await wait(300);
  const ed = await ev(`(() => { const b = document.getElementById('editBox'); const sel = b.selectionStart, top = b.scrollTop, keep = b.value;
    const caretLine = keep.slice(0, sel).split('\\n').length - 1;
    b.style.flex = 'none'; b.style.height = '0px'; b.value = keep.slice(0, sel) + 'x';
    const caretY = b.scrollHeight;
    b.style.flex = ''; b.style.height = ''; b.value = keep; b.setSelectionRange(sel, sel); b.scrollTop = top;
    return { caretLine, line: keep.split('\\n')[caretLine], caretY, scrollTop: top, h: b.clientHeight }; })()`);
  const visible = ed.caretY - ed.scrollTop > 0 && ed.caretY - ed.scrollTop < ed.h * 0.6;
  check(label, ed.caretLine === want.src && visible, ed);
  return ed;
}
await editCheck('edit opens at the line being read (near the top)');
await ev(`document.getElementById('editDone').click()`);
await wait(500);
const press = (key) => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`);
const i0 = await ev(`Prompter.R.anchor.i`);
await press('ArrowRight');
await wait(500);
const i1 = await ev(`Prompter.R.anchor.i`);
check('one Right press moves 3 lines ahead', i1 === i0 + 3, { from: i0, to: i1 });
for (let i = 0; i < 12; i++) { await press('ArrowRight'); await wait(400); }
const i2 = await ev(`Prompter.R.anchor.i`);
check('twelve more move 36 lines', i2 === i1 + 36, { from: i1, to: i2 });
await editCheck('edit opens at the line being read (far down)');
await ev(`document.getElementById('editDone').click()`);
await wait(500);
const i3 = await ev(`Prompter.R.anchor.i`);
for (let i = 0; i < 4; i++) await press('PageUp');          // quick presses, as from a pedal
await wait(600);
check('quick presses add up (4 x 3 lines back)', (await ev(`Prompter.R.anchor.i`)) === i3 - 12, { from: i3, to: await ev(`Prompter.R.anchor.i`) });
const atEdit = await line();
await ev(`document.getElementById('readEdit').click()`);
await wait(300);
await shot('8-edit');
await ev(`(() => { const b = document.getElementById('editBox'); const ls = b.value.split('\\n'); ls[${atEdit.src}] = ls[${atEdit.src}] + ' (ठहराव)';
  b.value = ls.join('\\n'); const off = ls.slice(0, ${atEdit.src}).join('\\n').length + 1; b.setSelectionRange(off, off); b.dispatchEvent(new Event('input')); })()`);
await ev(`document.getElementById('editDone').click()`);
await wait(700);
const afterEdit = await line();
check('back on the edited line, with the change', afterEdit.src === atEdit.src && /ठहराव/.test(afterEdit.text), afterEdit);

// drag the text back
const yA = await ev(`Prompter.R.y`);
await ev(`(() => { const s = document.getElementById('stage'); const o = (y) => ({ bubbles: true, clientX: 600, clientY: y, pointerId: 5 });
  s.dispatchEvent(new PointerEvent('pointerdown', o(300))); for (let y = 310; y <= 500; y += 10) s.dispatchEvent(new PointerEvent('pointermove', o(y)));
  s.dispatchEvent(new PointerEvent('pointerup', o(500))); })()`);
check('dragging down moves back', Math.abs((await ev(`Prompter.R.y`)) - (yA - 190)) < 2 && !(await ev(`Prompter.R.playing`)));

// pedals: Page Down plays, Page Up goes back
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))`);
await wait(100);
check('Page Down plays', await ev(`Prompter.R.playing`));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))`);
check('Page Down again pauses', !(await ev(`Prompter.R.playing`)));

// back to the library
await ev(`document.getElementById('readBack').click()`);
await wait(300);
const lib = await ev(`({ hash: location.hash, rows: document.querySelectorAll('.script').length, meta: document.querySelector('.script .m')?.textContent })`);
check('library lists the script', lib.rows === 1, lib);
await shot('9-library');

check('no errors in the page', errors.length === 0, errors);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed. Screenshots: ${shots}`);
ws.close();
chrome.kill();
server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
