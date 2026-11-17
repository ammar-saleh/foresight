// Prints the benchmark result files (from bench/run.mjs) as markdown tables.  node bench/table.mjs
import fs from 'node:fs';
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const SC = ['long-form', 'autocomplete', 'late-modal', 'wizard', 'drift', 'grid'];
const NAME = { 'long-form': 'Registration (16 fields)', autocomplete: 'Flight search', 'late-modal': 'Popup page', wizard: 'Checkout (3 screens)', drift: 'Shifting layout', grid: 'Grid (20 cells)' };
const ARMS = [['agent-loop', 'Step-by-step agent loop'], ['playwright-script', 'Hand-written Playwright script'], ['foresight-stepwise', 'Foresight, one step per round trip'], ['foresight-cold', 'Foresight']];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');
function table(rtt) {
  const rows = jl(`results/engine-runs-rtt${rtt}.jsonl`);
  if (!rows.length) return '(not run)';
  const n = Math.max(...rows.map((r) => Number(r.run) + 1).filter(Number.isFinite));
  let out = `| Task | ${ARMS.map((a) => a[1]).join(' | ')} |\n|---|${ARMS.map(() => '---').join('|')}|\n`;
  for (const sc of SC) {
    out += `| ${NAME[sc]} | ` + ARMS.map(([arm]) => {
      const rs = rows.filter((r) => r.arm === arm && r.scenario === sc), ok = rs.filter((r) => r.valid);
      if (!rs.length) return '—';
      if (!ok.length) return `failed ${rs.length}/${rs.length}`;
      const asks = rs.reduce((a, r) => a + (r.modelCalls || 0), 0);
      return fmt(med(ok.map((r) => r.pageMs))) + (ok.length < rs.length ? ` (${rs.length - ok.length} failed)` : '') + (asks ? ` (asked ${asks}× in ${rs.length} runs)` : '');
    }).join(' | ') + ' |\n';
  }
  return out + `\nMedian of ${n} runs per cell.`;
}
const md = `**Local browser**\n\n${table(0)}\n\n**Through a simulated remote browser (40 ms per round trip)**\n\n${table(40)}\n\nAutocomplete and checkout include the pages' own built-in delays (about 1.5 s). "Asked" = the engine stopped and put a question to the stand-in planner instead of guessing.`;
if (process.argv.includes('--write')) {
  const p = 'RESULTS.md', s = fs.readFileSync(p, 'utf8');
  if (!s.includes('BENCH_TABLE')) { console.log('RESULTS.md has no BENCH_TABLE marker'); process.exit(1); }
  fs.writeFileSync(p, s.replace('BENCH_TABLE', md));
}
console.log(md);
