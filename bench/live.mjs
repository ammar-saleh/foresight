// Live end-to-end arm: "Claude + Foresight".
// Opens the scenario page (its timer starts), then waits for a plan file written by the model.
// The model writes the plan from the task alone (human-level labels, no page refs), Foresight executes it.
// Usage: node bench/live.mjs <scenario>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';

const scenario = process.argv[2];
const tasks = JSON.parse(fs.readFileSync('tasks/tasks.json', 'utf8'));
const planFile = path.resolve(`results/live/${scenario}.plan.json`);
fs.mkdirSync(path.dirname(planFile), { recursive: true });
if (fs.existsSync(planFile)) fs.rmSync(planFile);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fx = await new Foresight({ irreversible: 'verify', useCache: false }).attach(page);
await page.goto(`http://localhost:4600${tasks[scenario].page}?arm=claude-foresight`);
console.log(`page open, waiting for ${planFile}`);

let plan;
for (;;) {
  if (fs.existsSync(planFile)) { try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); break; } catch {} }
  await new Promise((r) => setTimeout(r, 15));
}
const r = await fx.run({ id: scenario, ...plan });
const pageRes = await page.waitForFunction(() => window.Bench?.done, null, { timeout: 3000 })
  .then(() => page.evaluate(() => ({ ms: window.Bench.ms, flags: window.Bench.flags })))
  .catch(async () => ({ ms: null, err: await page.evaluate(() => document.getElementById('err')?.textContent) }));
const out = { scenario, arm: 'claude-foresight', valid: pageRes.ms != null, pageMs: pageRes.ms, engineMs: r.ms, roundTrips: r.roundTrips, repairs: r.repairs, reason: r.reason, err: pageRes.err };
fs.appendFileSync('results/live-runs.jsonl', JSON.stringify(out) + '\n');
console.log(JSON.stringify(out));
await browser.close();
