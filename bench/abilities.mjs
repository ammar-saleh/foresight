// Abilities suite: one page per kind of interaction that is hard for automation (shadow DOM, uploads, drag and
// drop, rich text, endless lists, canvas, right-click menus, new tabs, hover menus, custom dropdowns, native pickers).
// Each case must end in the true state the task asked for, or stop where stopping is the right answer.
// Usage: node bench/abilities.mjs [runs=3]      (needs the local test server on :4600)
import path from 'node:path';
import { chromium } from 'playwright-core';
import './sample.mjs';
import { Foresight } from '../engine/foresight.js';

const RUNS = Number(process.argv[2] || 3);
const only = process.argv[3]?.split(',');
const BASE = process.env.BASE || 'http://localhost:4600';
const FILE = path.resolve('results/upload-sample.txt');
const DONE = 'finish', STOP = 'stop';
const st = (p) => p.evaluate(() => window.__state);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CASES = [
  { name: 'shadow', what: 'field and button inside nested shadow roots, with a look-alike outside', want: DONE,
    steps: [{ fill: 'Nickname', value: 'Zed' }, { click: 'Apply', expect: { text: 'Applied: Zed' } }], check: async (p) => (await st(p)).applied === 'Zed' },
  { name: 'upload', what: 'attach a file, then submit', want: DONE,
    steps: [{ upload: 'Resume', file: FILE }, { click: 'Upload', expect: { text: 'Uploaded: upload-sample.txt' } }], check: async (p) => (await st(p)).file?.name === 'upload-sample.txt' },
  { name: 'upload', label: 'upload-missing', what: 'the file to attach does not exist', want: STOP,
    steps: [{ upload: 'Resume', file: path.resolve('results/no-such-file.pdf') }], check: async (p) => !(await st(p)).file },
  { name: 'drag', what: 'native drag and drop between columns', want: DONE,
    steps: [{ drag: 'Task B', to: 'Done' }, { drag: 'Task A', to: 'Done' }], check: async (p) => eq((await st(p)).done, ['Task B', 'Task A']) },
  { name: 'sort', what: 'pointer-driven reordering', want: DONE,
    steps: [{ drag: 'One', to: 'Four' }], check: async (p) => eq((await st(p)).order, ['Two', 'Three', 'One', 'Four', 'Five']) },
  { name: 'rich', what: 'rich-text editor that rejects scripted text', want: DONE,
    steps: [{ fill: 'Message body', value: 'hello there' }, { click: 'Send', expect: { text: 'Sent: hello there' } }], check: async (p) => (await st(p)).sent === 'hello there' },
  { name: 'infinite', what: 'item far down a list that loads as you scroll', want: DONE,
    steps: [{ scroll: 'down', expect: { text: 'Item 137' } }, { click: 'Item 137', expect: { text: 'Opened item 137' } }], check: async (p) => (await st(p)).opened === 137 },
  { name: 'canvas', what: 'drawn buttons with no page structure: click by position', want: DONE,
    steps: [{ clickAt: { css: 'canvas', x: 240, y: 100 }, expect: { text: 'Clicked: Green' } }], check: async (p) => (await st(p)).clicked === 'Green' },
  { name: 'context', what: 'right-click menu', want: DONE,
    steps: [{ rightclick: 'Notes.txt' }, { click: 'Rename', expect: { text: 'Renaming Notes.txt' } }], check: async (p) => eq((await st(p)).action, { file: 'Notes.txt', action: 'rename' }) },
  { name: 'newtab', what: 'link that opens a new tab; the task continues there', want: DONE,
    steps: [{ click: 'Open report' }, { click: 'Acknowledge', expect: { text: 'Acknowledged' } }], check: async (p) => (await st(p)).ack === true },
  { name: 'hovermenu', what: 'menu item that only exists while hovering', want: DONE,
    steps: [{ hover: 'Account' }, { click: 'Settings', expect: { text: 'Settings opened' } }], check: async (p) => (await st(p)).opened === 'settings' },
  { name: 'hovermenu', label: 'hovermenu-auto', what: 'same, but the plan forgets to hover', want: DONE,
    steps: [{ click: 'Settings', expect: { text: 'Settings opened' } }], check: async (p) => (await st(p)).opened === 'settings' },
  { name: 'combo', what: 'two look-alike custom dropdowns', want: DONE,
    steps: [{ pick: 'Country', value: 'Canada' }, { pick: 'Language', value: 'Arabic' }], check: async (p) => { const s = await st(p); return s.country === 'Canada' && s.language === 'Arabic'; } },
  { name: 'native', what: 'date, time, slider, colour and number fields', want: DONE,
    steps: [{ fill: 'Start date', value: '2026-12-01' }, { fill: 'Start time', value: '09:30' }, { fill: 'Volume', value: '7' }, { fill: 'Accent colour', value: '#ff0000' }, { fill: 'Seats', value: '4' }, { click: 'Save', expect: { text: 'Saved' } }],
    check: async (p) => eq((await st(p)).saved, { date: '2026-12-01', time: '09:30', volume: '7', colour: '#ff0000', seats: '4' }) },
  { name: 'textarea-limit', what: 'value longer than the field allows', want: STOP,
    steps: [{ fill: 'Short note', value: 'this note is much longer than twenty characters' }, { click: 'Save' }], check: async (p) => !(await st(p)).note },
  { name: 'delayed-text', what: 'result arrives after the plan stops waiting, with no feedback: must not click twice', want: STOP,
    steps: [{ click: 'Generate', expect: { text: 'Your code is', timeout: 1200 } }], check: async () => true },
  { name: 'delayed-text', label: 'delayed-text-wait', what: 'same, with a long enough wait', want: DONE,
    steps: [{ click: 'Generate', expect: { text: 'Your code is', timeout: 6000 } }, { read: 'Your code is' }], check: async (p, r) => (await st(p)).code === '7391' && /7391/.test(JSON.stringify(r.reads)) },
  // ---- patterns from real job-application forms (site/apply.html) ----
  // two upload fields whose buttons are both called "Attach"; the page swaps the input for the file's name and "Remove file"
  { name: 'attach', page: 'apply.html', label: 'attach-near', what: 'two "Attach" uploads: the one near "Resume/CV"', want: DONE,
    steps: [{ upload: { label: 'Attach', near: 'Resume/CV' }, file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-nth', what: 'two "Attach" uploads: the second', want: DONE,
    steps: [{ upload: { label: 'Attach', nth: 2 }, file: FILE }], check: async (p) => eq((await st(p)).files, { cover_letter: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-heading', what: 'an upload named by the heading of its section', want: DONE,
    steps: [{ upload: 'Cover Letter', file: FILE }], check: async (p) => eq((await st(p)).files, { cover_letter: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-both', what: 'both uploads, one after the other, with the same file', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }, { upload: { label: 'Attach', near: 'Cover Letter' }, file: FILE }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Attached:' } }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt', cover_letter: 'upload-sample.txt' }) && (await p.textContent('#out')).includes('cover_letter') },
  { name: 'attach', page: 'apply.html', label: 'attach-bare', what: 'two "Attach" uploads and no hint: not for the engine to choose', want: STOP,
    steps: [{ upload: 'Attach', file: FILE }], check: async (p, r) => eq((await st(p)).files, {}) && r.failed?.status === 'lowconf' },
  { name: 'attach', page: 'apply.html', label: 'attach-far', what: 'a hint that fits neither upload', want: STOP,
    steps: [{ upload: { label: 'Attach', near: 'Portfolio' }, file: FILE }], check: async (p) => eq((await st(p)).files, {}) },
  { name: 'attach-plain', page: 'apply.html', label: 'attach-plain', what: 'the same without any group markup: heading, then "near"', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }, { upload: { label: 'Attach', near: 'Cover Letter' }, file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt', cover_letter: 'upload-sample.txt' }) },
  { name: 'attach-slow', page: 'apply.html', what: 'the file name shows up a moment after the input is gone', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-keep', page: 'apply.html', what: 'the page empties the input and shows a chip with a remove button', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-icon', page: 'apply.html', what: 'the input is replaced by "Remove file" only, no file name', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-reject', page: 'apply.html', what: 'the page refuses the file and names it in an error: that is not an upload', want: STOP,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p, r) => eq((await st(p)).files, {}) && r.failed?.status === 'verify-failed' },
  // a phone-country picker that shows only a flag and the dial code once chosen
  { name: 'phone-code', page: 'apply.html', what: 'the chosen country is shown as a flag and "+1" only', want: DONE,
    steps: [{ pick: 'Country', value: 'United States +1', typeText: 'United States' }, { fill: 'Phone', value: '3135550142' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p) => eq((await st(p)).sent, { country: 'us', phone: '3135550142' }) },
  { name: 'phone-flag', page: 'apply.html', what: 'a flag button that opens a list and collapses back into a flag', want: DONE,
    steps: [{ pick: 'Select country', value: 'United States' }, { fill: 'Phone', value: '3135550142' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p) => eq((await st(p)).sent, { country: 'us', phone: '3135550142' }) },
  { name: 'phone-flag', page: 'apply.html', label: 'phone-flag-code', what: 'the same, naming the choice with its dial code', want: DONE,
    steps: [{ pick: 'Select country', value: 'Jordan +962' }], check: async (p) => (await st(p)).country === 'jo' },
  // "pick" on a text box that offers no suggestions at all
  { name: 'plain', page: 'apply.html', label: 'pick-plain', what: '"pick" on a plain text field: typed in like "fill", with a warning, without a long wait', want: DONE,
    steps: [{ pick: 'Have you previously been employed by Acme or an Acme subsidiary?', value: 'No' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p, r) => (await st(p)).sent?.answer === 'No' && r.warnings.some((w) => /plain text field/.test(w)) && r.ms < 3500 },
  { name: 'plain', page: 'apply.html', label: 'pick-keys', what: 'a plain-looking field whose list answers real keys only: still picked from the list', want: DONE,
    steps: [{ pick: 'City', value: 'Amsterdam', typeText: 'Ams' }], check: async (p) => (await st(p)).city === 'Amsterdam' },
  { name: 'keys-slow', page: 'apply.html', label: 'pick-keys-slow', what: 'the same, with a list that asks the server and takes its time', want: DONE,
    steps: [{ pick: 'City', value: 'Amsterdam', typeText: 'Ams' }], check: async (p) => (await st(p)).city === 'Amsterdam' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let harmful = 0, right = 0, total = 0;
for (const c of CASES) {
  if (only && !only.includes(c.label || c.name)) continue;
  const outs = [];
  for (let k = 0; k < RUNS; k++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${c.page || 'more.html'}?case=${c.name}`);
    const fx = new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true }); fx.page = page;
    const r = await fx.run({ id: c.name, steps: c.steps }).catch((e) => ({ ok: false, reason: String(e.message) }));
    const pages = ctx.pages();
    const harm = (await Promise.all(pages.map((p) => p.evaluate(() => window.__harm).catch(() => null)))).find(Boolean) || null;
    const got = r.ok ? DONE : STOP;
    const good = !harm && got === c.want && (await c.check(fx.page, r).catch(() => false));
    outs.push({ got, harm, good, reason: r.reason, ms: r.ms, repairs: (r.repairs || []).map((x) => x.kind) });
    total++; if (harm) harmful++; if (good) right++;
    await ctx.close();
  }
  const o = outs.find((x) => !x.good) || outs[0];
  const reps = [...new Set(outs.flatMap((x) => x.repairs))];
  console.log(`${(c.label || c.name).padEnd(18)} want ${c.want.padEnd(6)} got ${outs.map((x) => x.got).join(',').padEnd(20)} ${outs.every((x) => x.good) ? 'PASS' : 'FAIL'}${outs.some((x) => x.harm) ? '  HARM: ' + outs.find((x) => x.harm).harm : ''}${!outs.every((x) => x.good) || c.want === STOP ? '   (' + (o.reason || 'finished, wrong end state') + ')' : `   ${Math.round(o.ms)} ms`}${reps.length ? '  repairs: ' + reps.join(',') : ''}   - ${c.what}`);
}
await browser.close();
console.log(`\nright outcome ${right}/${total}, harmful actions ${harmful}`);
