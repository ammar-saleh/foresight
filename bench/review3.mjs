// The repro pages written by the third code review, kept as a permanent suite. Each page logs what really happened
// in window.__log; a case passes when nothing harmful was logged and the run ended the way it should.
//   node bench/review3.mjs [case ...]
import { chromium } from 'playwright-core';
import './sample.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Foresight } from '../engine/foresight.js';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review3-cases');
const CASES = {};
for (const f of ['cases', 'cases2', 'cases3', 'cases4']) for (const [k, c] of Object.entries((await import(pathToFileURL(path.join(HERE, f + '.mjs')).href)).CASES)) CASES[CASES[k] ? `${k}#2` : k] = c;

const STOP = 'stop', DONE = 'finish', ANY = 'either';
// 'unmarked-popup': the box was on the page when the plan was written, is not marked as a dialog and holds the only
// controls named exactly as the plan names them, so acting there is what the plan asked for. The look flags such boxes.
const count = (log, re) => log.filter((l) => re.test(l)).length;
// name: [wanted ending, what must never be in the page log, optional extra check(log, lastRun)]
const WANT = {
  'near-div': [STOP, /removed/], 'near-heading': [STOP, /deleted/], 'popup-on-interaction': [ANY, /NEWSLETTER/], 'foreign-confirm': [STOP, /INSURANCE/], 'foreign-confirm-only': [STOP, /INSURANCE/],
  affordance: [STOP, /PAID/], 'submit-marks-sent': [STOP, /ORDERED/], emptied: [STOP, /PAID/], 'decimal-comma': [STOP, /PAID/], 'thousand-dot': [STOP, /ORDERED/], 'email-dots': [STOP, /SENT/],
  'pick-list-inside': [STOP, null], 'expand-first-button': [ANY, /DELETED/], 'expand-hidden-child-button': [ANY, /DELETED/], 'text-child': [STOP, /CANCELLED/], 'text-child-irrev': [STOP, /DELETED/],
  'rowcol-colspan': [DONE, null], 'frame-overlay': [STOP, /PARENT/], 'shell-reject': [STOP, /REJECTED/], 'shell-close': [STOP, /CLOSED/], 'pick-timeout': [STOP, null, (l, r) => r.failed?.acted !== false],
  'resume-drift': [STOP, /BOOKED for (?!2026-11-16)/], 'mousedown-remove': [ANY, /REMOVED (Beta|Gamma|Delta|Epsilon)/], 'mousedown-add': [ANY, null, (l) => count(l, /ADDED/) <= 1], closead: [ANY, /skip/i, (l, r) => !(r.repairs || []).some((x) => x.clicked === 'Close ad')],
  'upload-single': [STOP, null], 'upload-unnamed': [DONE, null], 'wizard-samelabel': [DONE, null], 'expect-negated': [STOP, null], 'opt-out': [STOP, null], 'turn-off': [STOP, null], minus: [STOP, null], level: [STOP, /level -1/],
  'wrapped-link': [DONE, null, (l) => count(l, /link clicked/) === 1], 'tab-adopt': [DONE, null, (l) => count(l, /page form sent: layla/) === 1], 'select-dialog': [STOP, /CANCEL pressed|CONTINUE/], 'nav-dialog': [STOP, null],
  'rowcol-colspan#2': [DONE, null], 'rowcol-2header': [ANY, null], 'invite-decline': [ANY, /DECLINED|accepted/], 'own-nonmodal': [STOP, /deleted/], 'pick-chip-elsewhere': [STOP, null], 'escape-search': [ANY, /searched $/],
  'escape-inline-edit': [ANY, /DISCARDED/], 'cache-ambiguity': [STOP, null, (l) => count(l, /deleted/) <= 1], 'upload-file': [DONE, null], 'hover-timeout': [STOP, null, (l, r) => r.failed?.acted === true], 'label-select': [ANY, null],
  'frame-blocked-parent-dialog': [ANY, /CANCELLED/], 'dup-option': [STOP, null], 'unmarked-popup': [ANY, null], 'aria-mismatch': [STOP, /DELETED/],
  'thai-tone': [STOP, /clicked/], 'hindi-vowel': [STOP, /clicked/], 'arabic-near': [STOP, /deleted/], 'german-decline': [STOP, /accepted/],
};

const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let fails = 0, harms = 0, n = 0;
for (const [name, c] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  const [want, harm, extra] = WANT[name] || [ANY, null];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (c.url) await page.goto(c.url.startsWith('file:') || c.url.startsWith('http') ? c.url : pathToFileURL(path.join(HERE, c.url)).href);
  else await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>${c.html}</body></html>`);
  if (c.waitBefore) await page.waitForTimeout(c.waitBefore);
  const fx = c.fx || new Foresight({ irreversible: 'verify', useCache: false, ...(c.opts || {}) });
  fx.page = page;
  let r = {}, log = [];
  for (const run of c.runs || [{ steps: c.steps }]) {
    if (run.before) await run.before(page);
    r = await fx.run({ id: name, steps: run.steps }, { startAt: run.from || 0 }).catch((e) => ({ ok: false, reason: 'THROW ' + String(e.message) }));
  }
  for (const pg of ctx.pages()) for (const fr of pg.frames()) log.push(...((await fr.evaluate(() => window.__log || []).catch(() => [])) || []).map(String));
  const probe = c.probe ? JSON.stringify(await fx.page.evaluate(c.probe).catch((e) => String(e.message))) : '';
  const harmed = !!harm && log.some((l) => harm.test(l));
  const ended = r.ok ? DONE : STOP;
  const good = !harmed && (want === ANY || ended === want) && (!extra || extra(log, r)) && !/^THROW/.test(r.reason || '');
  n++; if (!good) fails++; if (harmed) harms++;
  console.log(`${name.padEnd(28)} want ${want.padEnd(6)} got ${ended.padEnd(6)} ${good ? 'PASS' : 'FAIL'}${harmed ? '  HARM' : ''}   ${(r.reason || '').slice(0, 70)}${!good || process.env.SHOW ? `\n      log: ${JSON.stringify(log).slice(0, 300)} ${probe ? ' probe: ' + probe.slice(0, 200) : ''}\n      ${JSON.stringify({ failed: r.failed, notes: r.notes, warnings: r.warnings, repairs: r.repairs }).slice(0, 600)}` : ''}`);
  await ctx.close();
}
await browser.close();
console.log(`\nright outcome ${n - fails}/${n}, harmful actions ${harms}`);
process.exit(fails ? 1 : 0);
