// node --test prompter/test
// Optional: PROMPTER_SCRIPT=<path to a real pasted script> also checks that file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const P = require('../parse.js');

// Shaped like the scripts that arrive by email: mail header, advice, the spoken part, then notes.
const EMAIL = [
  'Skip to content',
  'in:sent',
  'रिटायरमेंट के 100 दिन के सच ( नौकरी खत्म, मन का संघर्ष शुरू) एक लंबी विषय पंक्ति',
  'Writer <writer@example.com>',
  '',
  'यह वीडियो आपकी श्रृंखला का एक बहुत महत्वपूर्ण मोड़ बन सकता है, इसलिए इसमें अपनी कहानी सामने रखनी चाहिए।',
  '',
  '# मन का चक्रव्यूह – विशेष श्रृंखला',
  '### एपिसोड:',
  '',
  'रिटायरमेंट के',
  '100 दिन –',
  '**[दमदार हुक – कैमरे की ओर देखकर, कुछ क्षण रुककर]**',
  'नमस्कार मित्रों',
  'उस दिन मैंने',
  'एक',
  'फैसला किया...',
  '**नौकरी से',
  'रिटायर होना',
  'आसान है!**',
  'लेकिन',
  'क्या इतना',
  'आसान था?',
  '**[विराम]**',
  '### पहला चक्रव्यूह –',
  'पहचान खोने का',
  'डर',
  'मैंने (ठहराव) सोचा',
  'मेरे प्यारे साथियों!',
  '',
  '**क्योंकि',
  'सीखने से नहीं!',
  '',
  'धन्यवाद।',
  '',
  '### वीडियो के लिए दृश्य सुझाव',
  '',
  '![a picture](https://images.example.com/a.png)',
  '',
  'दृश्य 1: कार से पुलिस का बोर्ड हटाना।',
].join('\n');

test('finds where reading starts and ends in a pasted email', () => {
  const { start, end } = P.detect(EMAIL);
  const ls = EMAIL.split('\n');
  assert.strictEqual(ls[start], 'रिटायरमेंट के');
  assert.strictEqual(ls[end], 'धन्यवाद।');
});

test('split and join give back the original text', () => {
  const r = P.detect(EMAIL);
  const s = P.split(EMAIL, r.start, r.end);
  assert.strictEqual(P.join(s), EMAIL);
  assert.ok(s.body.startsWith('रिटायरमेंट के') && s.body.endsWith('धन्यवाद।'));
});

test('marks become looks and pauses', () => {
  const r = P.detect(EMAIL);
  const { blocks, words } = P.parse(P.split(EMAIL, r.start, r.end).body);
  const by = (t) => blocks.find((b) => b.segs.map((s) => s.text).join('').trim() === t);
  assert.strictEqual(by('[दमदार हुक – कैमरे की ओर देखकर, कुछ क्षण रुककर]').kind, 'cue');
  assert.strictEqual(by('[दमदार हुक – कैमरे की ओर देखकर, कुछ क्षण रुककर]').after, P.GAP.cueLong);
  assert.strictEqual(by('[विराम]').kind, 'cue');
  assert.strictEqual(by('नौकरी से').kind, 'key');
  assert.strictEqual(by('नौकरी से').before, P.GAP.keyBefore);
  assert.strictEqual(by('रिटायर होना').kind, 'key');
  assert.strictEqual(by('आसान है!').after, P.GAP.keyAfter);
  assert.strictEqual(by('लेकिन').kind, 'line');                 // bold closed on the line before
  assert.strictEqual(by('फैसला किया...').after, P.GAP.beat);
  assert.strictEqual(by('आसान था?').after, P.GAP.stop);
  assert.strictEqual(by('पहला चक्रव्यूह –').kind, 'head');
  assert.strictEqual(by('मेरे प्यारे साथियों!').after, P.GAP.blank);
  // an unclosed ** stops at the blank line instead of swallowing the rest
  assert.strictEqual(by('सीखने से नहीं!').kind, 'key');
  assert.strictEqual(by('धन्यवाद।').kind, 'line');
  // a direction inside a line is shown but not counted as speech
  const mixed = by('मैंने (ठहराव) सोचा');
  assert.strictEqual(mixed.kind, 'line');
  assert.strictEqual(mixed.words, 2);
  assert.ok(mixed.segs.some((s) => s.cue && s.text === '(ठहराव)'));
  // directions carry no words; headings do
  assert.strictEqual(blocks.filter((b) => b.kind === 'cue').every((b) => b.words === 0), true);
  assert.ok(words > 30);
  // the gap between two blocks is the larger request, not the sum
  const head = blocks.indexOf(by('पहला चक्रव्यूह –'));
  assert.strictEqual(blocks[head - 1].gap, Math.max(P.GAP.cueLong, P.GAP.headBefore));
});

test('a script written as paragraphs is read whole', () => {
  const text = 'पहला अनुच्छेद जिसमें बहुत सारे शब्द हैं और यह एक लंबी पंक्ति है जो पढ़ी जाएगी।\n\nदूसरा अनुच्छेद भी काफी लंबा है ताकि यह नोट जैसा दिखे पर असल में स्क्रिप्ट है।';
  const r = P.detect(text);
  assert.deepStrictEqual(r, { start: 0, end: 2 });
});

test('a name from the first spoken words', () => {
  assert.strictEqual(P.title('**[हुक]**\n### एपिसोड\nरिटायरमेंट के\n100 दिन –\nमेरे\nमन ने मुझे\nकिन-किन चक्रव्यूहों में\nफँसाने की'),
    'रिटायरमेंट के 100 दिन मेरे मन ने मुझे');
});

test('a real pasted script, if one is given', { skip: !process.env.PROMPTER_SCRIPT }, () => {
  const text = fs.readFileSync(process.env.PROMPTER_SCRIPT, 'utf8');
  const r = P.detect(text);
  const ls = text.replace(/\r/g, '').split('\n');
  console.log('  starts:', ls[r.start], '| ends:', ls[r.end]);
  const p = P.parse(P.split(text, r.start, r.end).body);
  const count = {};
  p.blocks.forEach((b) => { count[b.kind] = (count[b.kind] || 0) + 1; });
  console.log('  words:', p.words, 'blocks:', JSON.stringify(count));
});
