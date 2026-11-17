// Benchmark: every scenario x every executor x N runs, fresh browser context each run.
// Usage: node bench/run.mjs [runs=10] [headed]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';
import { plans } from '../plans/plans.mjs';
import { playwrightScript, agentLoop } from './baselines.js';
import { launchRemoteLike } from './latency.js';
import { ORACLE } from './oracle.mjs';

const BASE = process.env.BASE || 'http://localhost:4600';
const RUNS = Number(process.argv[2] || 10);
const headed = process.argv.includes('headed');
const RTT = Number(process.env.RTT || 0);   // simulated browser round-trip latency (0 = local browser)
const OUT = path.resolve(`results/engine-runs-rtt${RTT}.jsonl`);
const CACHE = path.resolve(`results/foresight-cache-rtt${RTT}.json`);
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(OUT, '');
if (fs.existsSync(CACHE)) fs.rmSync(CACHE);

// stand-in for the planner model: asked only when the engine is not sure (counted as modelCalls)
const norm = (plan) => new Foresight().normalize(plan);   // shared step format for baselines

const ARMS = {
  'playwright-script': async (page, plan) => playwrightScript(page, norm(plan)),
  'agent-loop': async (page, plan) => agentLoop(page, norm(plan)),
  'foresight-stepwise': async (page, plan) => {   // ablation: same engine, window locked to 1 (no speculation)
    const fx = await new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true, initialWindow: 1, maxWindow: 1, onEscalate: ORACLE }).attach(page);
    return fx.run(plan);
  },
  'foresight-cold': async (page, plan) => {
    const fx = await new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true, onEscalate: ORACLE }).attach(page);
    return fx.run(plan);
  },
  'foresight-warm': async (page, plan) => {
    const fx = await new Foresight({ irreversible: 'verify', cachePath: CACHE, pageSeen: true, onEscalate: ORACLE }).attach(page);
    return fx.run(plan);
  },
};

const remote = RTT > 0 ? await launchRemoteLike(RTT, { headless: !headed }) : null;
const browser = remote ? remote.browser : await chromium.launch({ channel: 'chrome', headless: !headed });
async function once(arm, name, plan, run) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${plan.path}?arm=${arm}&run=${run}`);
  // Foresight injects its runtime on demand (one evaluate) if the init script was not there at load time
  const r = await ARMS[arm](page, plan).catch((e) => ({ ok: false, reason: String(e) }));
  // the page is the source of truth: it validates the data and times nav-start -> validated finish
  const page_ = await page.waitForFunction(() => window.Bench?.done, null, { timeout: 2500 }).then(() => page.evaluate(() => ({ ms: window.Bench.ms, flags: window.Bench.flags, failedSubmits: window.Bench.failedSubmits }))).catch(async () => ({ ms: null, flags: await page.evaluate(() => window.Bench?.flags).catch(() => []), err: await page.evaluate(() => document.getElementById('err')?.textContent).catch(() => '') }));
  const rec = { rtt: RTT, arm, scenario: name, run, steps: plan.steps.length, valid: page_.ms != null, pageMs: page_.ms, flags: page_.flags, pageErr: page_.err, ...r };
  delete rec.windows;
  rec.windowSizes = r.windows?.map((w) => w.size);
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  await ctx.close();
  return rec;
}

for (const [name, plan] of Object.entries(plans)) {
  // prime the warm cache once (not recorded) so "warm" means "has done this page before"
  await once('foresight-warm', name, plan, 'prime').then(() => {
    const lines = fs.readFileSync(OUT, 'utf8').trim().split('\n'); lines.pop(); fs.writeFileSync(OUT, lines.length ? lines.join('\n') + '\n' : '');
  });
  for (const arm of Object.keys(ARMS)) {
    const recs = [];
    for (let k = 0; k < RUNS; k++) recs.push(await once(arm, name, plan, k));
    const ok = recs.filter((r) => r.valid);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    console.log(`${name.padEnd(13)} ${arm.padEnd(19)} valid ${ok.length}/${recs.length}  median ${med(ok.map((r) => r.pageMs)) ?? '-'} ms` + (ok.length < recs.length ? `  e.g. ${(recs.find((r) => !r.valid).reason || recs.find((r) => !r.valid).pageErr || recs.find((r) => !r.valid).flags?.join(',') || '').slice(0, 110)}` : ''));
  }
}
if (remote) await remote.close(); else await browser.close();
