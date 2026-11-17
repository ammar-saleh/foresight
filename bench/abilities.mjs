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
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let harmful = 0, right = 0, total = 0;
for (const c of CASES) {
  if (only && !only.includes(c.label || c.name)) continue;
  const outs = [];
  for (let k = 0; k < RUNS; k++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/more.html?case=${c.name}`);
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
