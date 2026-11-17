// Fresh-page runner: "look once -> plan -> run with checks -> ask only when stuck".
//   node bench/fresh.mjs open  <name> <url>     opens the page (timer starts) and prints ONE observation
//   node bench/fresh.mjs run   <name> [--from N] runs results/fresh/<name>.plan.json; on a dead-end it
//                                                prints what failed plus a new observation, and can be resumed
//   node bench/fresh.mjs close <name>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';

const [cmd, name, ...rest] = process.argv.slice(2);
const DIR = path.resolve('results/fresh');
fs.mkdirSync(DIR, { recursive: true });
const stateFile = path.join(DIR, `${name}.state.json`);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function connect(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools')) || (await ctx.newPage());
  return { browser, page };
}
const observe = (page) => page.evaluate(() => window.__FS.observe());
function printObs(o) {
  console.log(`URL: ${o.url}\nTITLE: ${o.title}\nHEADINGS: ${o.headings.join(' / ')}\nCONTROLS:\n  ${o.controls.join('\n  ')}`);
}

if (cmd === 'open') {
  const url = rest[0];
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'fs-fresh-'))}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { detached: true, stdio: 'ignore' });
  proc.unref();
  for (let k = 0; k < 100; k++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const { page } = await connect(port);
  const t0 = Date.now();                                   // the clock starts when navigation starts
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const fx = new Foresight(); fx.page = page; await fx.ensureRuntime();
  fs.writeFileSync(stateFile, JSON.stringify({ port, pid: proc.pid, t0, url, runs: 0, modelCalls: 1 }));
  printObs(await observe(page));
  console.log(`\n(look took ${Date.now() - t0} ms)`);
  process.exit(0);
}

if (cmd === 'run') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const from = rest.includes('--from') ? Number(rest[rest.indexOf('--from') + 1]) : 0;
  const plan = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.plan.json`), 'utf8'));
  const { page } = await connect(st.port);
  const fx = new Foresight({ irreversible: 'verify', useCache: false });
  fx.page = page;
  const r = await fx.run({ id: name, ...plan }, { startAt: from });
  st.runs++; st.modelCalls += st.runs > 1 ? 1 : 0; st.roundTrips = (st.roundTrips || 0) + r.roundTrips;
  fs.writeFileSync(stateFile, JSON.stringify(st));
  await page.screenshot({ path: path.join(DIR, `${name}.png`) }).catch(() => {});
  const total = Date.now() - st.t0;
  if (r.ok) {
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\n{2,}/g, '\n').slice(0, 1400);
    console.log(JSON.stringify({ ok: true, totalMsSincePageOpen: total, engineMsThisRun: r.ms, roundTripsTotal: st.roundTrips, plannerCalls: st.modelCalls, repairs: r.repairs, windows: r.windowCount }));
    console.log(`FINAL URL: ${page.url()}\nFINAL PAGE TEXT:\n${text}`);
  } else {
    console.log(JSON.stringify({ ok: false, stuckAtStep: r.failedAt, step: plan.steps[r.failedAt], why: r.reason, detail: r.failed, engineMsThisRun: r.ms, msSincePageOpen: total, repairs: r.repairs }));
    await fx.ensureRuntime().catch(() => {});
    console.log('\nPAGE NOW:'); printObs(await observe(page));
  }
  process.exit(0);
}

if (cmd === 'close') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  try { process.kill(st.pid); } catch {}
  console.log('closed');
}
