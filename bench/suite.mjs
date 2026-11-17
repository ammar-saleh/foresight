// Reliability suite: every real-site scenario, N times, from a clean browser, with an independent
// check of the TRUE end state (not just "the engine said ok").
// Usage: node bench/suite.mjs [runs=5] [only=name,name]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';

const RUNS = Number(process.argv[2] || 5);
const only = process.argv[3]?.split(',');
const plan = (n) => JSON.parse(fs.readFileSync(new URL(`./scenarios/${n}.plan.json`, import.meta.url), 'utf8'));
const text = (page) => page.evaluate(() => document.body.innerText);
const has = (t, ...needles) => needles.every((n) => t.includes(n));

// verify() returns true only if the real outcome on the page/URL is right
const SCENARIOS = [
  { name: 'pizza', kind: 'plain form + submit', url: 'https://httpbin.org/forms/post',
    verify: async (p) => has(await text(p), '"custname": "Layla Haddad"', '"custtel": "555-0142"', '"delivery": "18:30"', '"size": "medium"', '"bacon"', '"mushroom"', 'Ring the bell twice.') },
  { name: 'practice', kind: 'custom widgets form', url: 'https://demoqa.com/automation-practice-form',
    verify: async (p) => has((await text(p)).replace(/\s+/g, ' '), 'Thanks for submitting the form', 'Student Name Layla Haddad', 'Gender Female', 'Mobile 5550142000', 'Date of Birth 17 May,1994', 'Subjects Maths', 'Hobbies Reading', 'State and City NCR Delhi') },
  { name: 'dynamic', kind: 'slow changing page', url: 'https://the-internet.herokuapp.com/dynamic_controls',
    verify: async (p) => has(await text(p), "It's enabled!") && (await p.inputValue('input[type=text]')) === 'Hello from Foresight' && (await p.locator('#checkbox').count()) === 0 },
  { name: 'todo', kind: 'single-page app', url: 'https://demo.playwright.dev/todomvc/',
    verify: async (p) => p.url().endsWith('#/completed') && (await p.locator('.todo-list li').allInnerTexts()).join('|').trim() === 'Write report' && has(await text(p), '2 items left') },
  { name: 'wiki', kind: 'search + navigation', url: 'https://en.wikipedia.org/wiki/Main_Page',
    verify: async (p) => p.url().includes('/wiki/Branch_predictor') },
  { name: 'webform', kind: '9 mixed controls', url: 'https://www.selenium.dev/selenium/web/web-form.html',
    verify: async (p) => { const u = p.url(); return has(u, 'my-text=Layla', 'my-select=2', 'my-datalist=Seattle', 'my-colors=%23ff0000', 'my-date=12%2F20%2F2026', 'my-range=8') && (u.match(/my-check=on/g) || []).length === 2 && has(await text(p), 'Received!'); } },
  { name: 'addremove', kind: 'identical buttons', url: 'https://the-internet.herokuapp.com/add_remove_elements/',
    verify: async (p) => (await p.locator('#elements button').count()) === 2 },
  { name: 'alerts', kind: 'native pop-up dialogs', url: 'https://the-internet.herokuapp.com/javascript_alerts',
    verify: async (p) => has(await text(p), 'You clicked: Ok') },
  // --- cases the independent testers could not do before the fixes ---
  { name: 'tree', kind: 'ARIA tree + checkbox', url: 'https://demoqa.com/checkbox',
    verify: async (p) => has((await text(p)).replace(/\s+/g, ' '), 'You have selected : downloads') },
  { name: 'todo-hover', kind: 'hover-only delete button', url: 'https://demo.playwright.dev/todomvc/',
    verify: async (p) => (await p.locator('.todo-list li').allInnerTexts()).join('|').trim() === 'Pay rent' && has(await text(p), '1 item left') && p.url().endsWith('#/active') },
  { name: 'multiselect', kind: 'multi-select list', url: 'https://testpages.eviltester.com/styled/basic-html-form-test.html',
    verify: async (p) => (await p.locator('select[multiple] option:checked').allInnerTexts()).join('|') === 'Selection Item 1|Selection Item 3' && (await p.locator('select:not([multiple]) option:checked').first().innerText()).trim() === 'Drop Down Item 4' },
  { name: 'frame', kind: 'widget inside a frame', url: 'https://jqueryui.com/datepicker/',
    verify: async (p) => /^\d\d\/15\/\d{4}$/.test(await p.frames()[1].locator('#datepicker').inputValue()) },
  { name: 'table-nth', kind: 'nth of identical text', url: 'https://the-internet.herokuapp.com/tables',
    verify: async (p) => (await p.locator('#table1 tbody tr').first().locator('td').first().innerText()) === 'Bach' },
  { name: 'todo-edit', kind: 'double-click edit in place', url: 'https://demo.playwright.dev/todomvc/',
    verify: async (p) => (await p.locator('.todo-list li').allInnerTexts()).join('|').trim() === 'Beta edited' },
  { name: 'select-reload', kind: 'dropdown that reloads the page', url: 'https://www.scrapethissite.com/pages/forms/?q=New+York',
    verify: async (p) => p.url().includes('per_page=100') && (await p.locator('tr.team').count()) > 25 },
  { name: 'autocomplete-w3', kind: 'plain-div suggestion list', url: 'https://practice.expandtesting.com/autocomplete',
    verify: async (p) => (await p.locator('input[type=text]').first().inputValue()) === 'Jordan' },
  { name: 'dialog-form', kind: 'form in an animated dialog', url: 'https://demoqa.com/webtables',
    verify: async (p) => { const rows = (await p.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean); return rows.length === 1 && rows[0].startsWith('Layla Haddad 34 layla.haddad@example.com 5000 Finance') && (await p.locator('[role=dialog]').count()) === 0; } },
  { name: 'todo-edit2', kind: 'edit text beside a checkbox', url: 'https://todomvc.com/examples/react/dist/',
    verify: async (p) => has(await text(p), 'Call Layla Haddad') && (await p.locator('.todo-list li').count()) === 1 && !(await p.locator('.todo-list li input.toggle').first().isChecked()) },
];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const all = [];
for (const sc of SCENARIOS) {
  if (only && !only.includes(sc.name)) continue;
  const recs = [];
  for (let k = 0; k < RUNS; k++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const rec = { scenario: sc.name, run: k };
    try {
      const t0 = performance.now();
      await page.goto(sc.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      rec.loadMs = Math.round(performance.now() - t0);
      const fx = new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true }); fx.page = page;
      const r = await fx.run({ id: sc.name, ...plan(sc.name) });
      Object.assign(rec, { engineOk: r.ok, engineMs: Math.round(r.ms), roundTrips: r.roundTrips, repairs: r.repairs.map((x) => x.kind), reason: r.reason, failedAt: r.failedAt });
      rec.verified = r.ok ? await sc.verify(page).catch(() => false) : false;
    } catch (e) { rec.engineOk = false; rec.verified = false; rec.reason = String(e.message).split('\n')[0]; }
    recs.push(rec); all.push(rec);
    await ctx.close();
  }
  const good = recs.filter((r) => r.verified);
  const silent = recs.filter((r) => r.engineOk && !r.verified).length;      // said ok, was wrong: the worst kind
  console.log(`${sc.name.padEnd(10)} ${sc.kind.padEnd(22)} correct ${good.length}/${recs.length}  silent-wrong ${silent}  engine ${String(median(good.map((r) => r.engineMs)) ?? '-').padStart(5)} ms  round trips ${median(good.map((r) => r.roundTrips)) ?? '-'}` +
    (good.length < recs.length ? `   e.g. ${recs.find((r) => !r.verified).reason || 'verification failed'}` : '') +
    (recs.some((r) => r.repairs?.length) ? `   repairs: ${[...new Set(recs.flatMap((r) => r.repairs || []))].join(',')}` : ''));
}
await browser.close();
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync('results/suite-latest.json', JSON.stringify(all, null, 1));
const tot = all.length, ok = all.filter((r) => r.verified).length, silent = all.filter((r) => r.engineOk && !r.verified).length;
console.log(`\nTOTAL correct ${ok}/${tot} (${(100 * ok / tot).toFixed(1)}%), silent-wrong ${silent}`);
