// Quick smoke test: run every plan once with Foresight, headed=false.
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';
import { plans } from '../plans/plans.mjs';
import { ORACLE } from './oracle.mjs';

const BASE = process.env.BASE || 'http://localhost:4600';
const only = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, plan] of Object.entries(plans)) {
  if (only && name !== only) continue;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const fx = await new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true, log: (m) => console.log('   ', m),
    onEscalate: async (q) => { const a = await ORACLE(q); console.log('    asked the planner about step', q.failed.i, q.failed.status, '->', JSON.stringify(a)); return a; } }).attach(page);
  await page.goto(`${BASE}${plan.path}?arm=smoke`);
  const r = await fx.run(plan);
  const pageMs = await page.evaluate(() => window.Bench?.done ? window.Bench.ms : null);
  const errs = await page.evaluate(() => document.getElementById('err')?.textContent || '');
  console.log(name.padEnd(13), r.ok ? 'OK ' : 'FAIL', `engine ${r.ms}ms  page ${pageMs}ms  rt=${r.roundTrips} win=${r.windowCount} asks=${r.modelCalls}`, r.reason || '', errs, JSON.stringify(r.repairs));
  await ctx.close();
}
await browser.close();
