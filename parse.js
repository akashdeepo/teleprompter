/* Reading a script for the teleprompter.
 *
 * Scripts arrive as pasted emails: the part to be read sits between notes (advice, picture
 * suggestions with links, title ideas). The spoken part is written one short phrase per line,
 * with marks the writer uses on purpose:
 *   **text**        a key line, said with weight
 *   [text] (text)   a direction, never read aloud ([विराम], (ठहराव))
 *   ### text        a new section
 *   ...             a beat
 * Each mark becomes a look and a pause. A pause is space below the line, measured in line
 * heights, so a steady scroll turns it into time without the speed ever changing.
 *
 * Shared by the page (window.PromptParse) and the Node tests (module.exports).
 */
(function (root) {
  'use strict';

  var LETTER = /[ऀ-ॿA-Za-z0-9]/;
  var HEADING = /^\s*#{1,6}\s*/;
  var IMAGE = /!\[[^\]]*\]\([^)]*\)/;
  var LINK = /\[([^\]]*)\]\((?:https?:|www\.)[^)]*\)/g;
  var WEB = /(https?:\/\/|www\.)\S+/i;
  var EMAIL = /\S+@\S+\.\S+/;
  var BRACKETS = /\[[^\]]*\]|\([^)]*\)/g;
  var MARKS_ONLY = /^[\s"'“”‘’*_\-–—.,;:।]*$/;
  var LONG_PAUSE = /विराम|रुक|ठहर|मुस्कान|pause|smile/i;
  var SHORT_LINE = 9;              // a spoken line is a phrase; more words than this is a note

  // Space below a line, in line heights. Measured on the presenter's own recordings
  // (3 videos, about 1,700 lines): a plain line break already carries a 0.43 s breath;
  // a sentence end adds about 0.15 s, "..." 0.2 s, a blank line 0.3 s and a direction
  // up to 1.2 s. These are those pauses, a little enlarged so the eye sees them.
  var GAP = { stop: 0.15, beat: 0.35, blank: 0.6, cueBefore: 0.25, cue: 0.5, cueLong: 0.9,
              keyBefore: 0.5, keyAfter: 0.6, headBefore: 1.4, headAfter: 0.35 };

  function countWords(s) {
    var n = 0;
    s.split(/\s+/).forEach(function (t) { if (LETTER.test(t)) n++; });
    return n;
  }

  function unbold(s) { return s.replace(/\*+/g, '').trim(); }

  function isCue(s) {
    var p = unbold(s);
    return /[\[(]/.test(p) && p.replace(BRACKETS, '').replace(/[\s"'“”.,।:;–—-]/g, '') === '';
  }

  function lines(text) { return String(text || '').replace(/\r/g, '').split('\n'); }

  function classify(line) {
    var t = line.trim();
    if (!t || MARKS_ONLY.test(t)) return 'blank';
    if (IMAGE.test(t) || WEB.test(t) || EMAIL.test(t)) return 'note';
    if (HEADING.test(t)) return 'head';
    if (isCue(t)) return 'cue';
    return countWords(unbold(t).replace(BRACKETS, '')) > SHORT_LINE ? 'note' : 'short';
  }

  /* Where reading starts and ends: the longest stretch of short spoken lines, allowing blank
     lines, headings and directions inside it. Headings at its very edges are left out (series
     names, "### एपिसोड:", "### Visual suggestions"). A script written as paragraphs has no such
     stretch, so then everything is read and the user moves the ends by hand. */
  function detect(text) {
    var ls = lines(text);
    var kind = ls.map(classify);
    var best = null, i = 0, prose = 0;
    while (i < ls.length) {
      if (kind[i] === 'note') {
        if (!IMAGE.test(ls[i]) && !WEB.test(ls[i]) && !EMAIL.test(ls[i])) prose += countWords(ls[i]);
        i++;
        continue;
      }
      var j = i, score = 0;
      while (j < ls.length && kind[j] !== 'note') {
        if (kind[j] === 'short') score += countWords(unbold(ls[j]));
        j++;
      }
      if (!best || score > best.score) best = { a: i, b: j - 1, score: score };
      i = j;
    }
    var first = 0, last = ls.length - 1;
    while (first < last && kind[first] === 'blank') first++;
    while (last > first && kind[last] === 'blank') last--;
    if (!best || best.score === 0 || prose > best.score) return { start: first, end: last };
    var a = best.a, b = best.b;
    while (a < b && (kind[a] === 'blank' || kind[a] === 'head')) a++;
    while (b > a && (kind[b] === 'blank' || kind[b] === 'head')) b--;
    return { start: a, end: b };
  }

  function split(text, start, end) {
    var ls = lines(text);
    return {
      head: ls.slice(0, start).join('\n'),
      body: ls.slice(start, end + 1).join('\n'),
      tail: ls.slice(end + 1).join('\n')
    };
  }

  function join(s) {
    return [s.head, s.body, s.tail].filter(function (x, k) { return k === 1 || x !== ''; }).join('\n');
  }

  /* Turn the part to be read into blocks: one per written line, never re-wrapped. */
  function parse(body) {
    var ls = lines(body);
    var blocks = [];
    var bold = false;
    ls.forEach(function (raw, src) {
      var t = raw.trim();
      if (!t || MARKS_ONLY.test(t)) {
        if ((t.match(/\*\*/g) || []).length % 2) bold = !bold;   // a lone "**" opens or closes
        if (!t && blocks.length) {
          var prev = blocks[blocks.length - 1];
          prev.after = Math.max(prev.after, GAP.blank);
          bold = false;                                         // bold never runs past a blank line
        }
        return;
      }
      if (IMAGE.test(t)) return;
      t = t.replace(LINK, '$1');
      var kind = 'line';
      if (HEADING.test(t)) { kind = 'head'; t = t.replace(HEADING, ''); bold = false; }
      else if (isCue(t)) kind = 'cue';

      var segs = [];
      t.split(/(\*\*|\[[^\]]*\]|\([^)]*\))/).forEach(function (part) {
        if (part === '**') { bold = !bold; return; }
        if (!part) return;
        if (/^[\[(]/.test(part) && /[\])]$/.test(part)) segs.push({ text: part, cue: true });
        else {
          part = part.replace(/(^|\s)\*(?=\S)|(\S)\*(?=\s|$)/g, '$1$2');   // single * italics
          if (part) segs.push({ text: part, bold: bold });
        }
      });
      if (kind === 'head') bold = false;

      var spoken = segs.filter(function (s) { return !s.cue && LETTER.test(s.text); });
      if (kind === 'line' && spoken.length && spoken.every(function (s) { return s.bold; })) kind = 'key';
      var words = countWords(spoken.map(function (s) { return s.text; }).join(' '));

      var block = { kind: kind, segs: segs, src: src, words: words, before: 0, after: 0 };
      var end = spoken.length ? spoken[spoken.length - 1].text.replace(/["'”’*\s]+$/, '') : '';
      if (/(\.\.\.|…)$/.test(end)) block.after = GAP.beat;
      else if (/[।॥?!.]$/.test(end)) block.after = GAP.stop;
      if (kind === 'head') { block.before = GAP.headBefore; block.after = Math.max(block.after, GAP.headAfter); }
      if (kind === 'cue') {
        block.before = GAP.cueBefore;
        block.after = LONG_PAUSE.test(t) ? GAP.cueLong : GAP.cue;
      }
      blocks.push(block);
    });

    var words = 0;
    blocks.forEach(function (b, k) {
      var prev = blocks[k - 1], next = blocks[k + 1];
      if (b.kind === 'key' && (!prev || prev.kind !== 'key')) b.before = Math.max(b.before, GAP.keyBefore);
      if (b.kind === 'key' && (!next || next.kind !== 'key')) b.after = Math.max(b.after, GAP.keyAfter);
      words += b.words;
    });
    // the space between two lines is the larger of what each asks for, not the sum
    blocks.forEach(function (b, k) {
      var next = blocks[k + 1];
      b.gap = next ? Math.max(b.after, next.before) : 0;
    });
    return { blocks: blocks, words: words };
  }

  /* A name for the library: the first few spoken words. */
  function title(body) {
    var out = [];
    lines(body).some(function (l) {
      var k = classify(l);
      if (k !== 'short' && k !== 'note') return false;
      unbold(l).replace(BRACKETS, '').split(/\s+/).forEach(function (w) {
        if (out.length < 8 && LETTER.test(w)) out.push(w);
      });
      return out.length >= 8;
    });
    return out.join(' ').replace(/[–—\-,:;।.…]+$/, '').trim() || 'Untitled script';
  }

  var api = { detect: detect, split: split, join: join, parse: parse, title: title,
              countWords: countWords, GAP: GAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PromptParse = api;
})(this);
