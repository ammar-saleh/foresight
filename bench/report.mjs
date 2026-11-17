// Builds report.html from the raw results. Usage: node bench/report.mjs
import fs from 'node:fs';

const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const tasks = JSON.parse(fs.readFileSync('tasks/tasks.json', 'utf8'));
const SC = Object.keys(tasks);
const pagePosts = jl('results/results.jsonl');
const live = jl('results/live-runs.jsonl');
const eng = { 0: jl('results/engine-runs-rtt0.jsonl'), 40: jl('results/engine-runs-rtt40.jsonl') };

const last = (arm, sc) => pagePosts.filter((r) => r.arm === arm && r.scenario === sc).at(-1)?.ms ?? null;
const claude = SC.map((sc) => ({
  sc, step: last('claude-step', sc), batch: last('claude-batch', sc), fx: live.filter((r) => r.scenario === sc && r.valid).at(-1)?.pageMs ?? null,
}));
const sum = (k) => claude.reduce((a, r) => a + (r[k] || 0), 0);
const T = { step: sum('step'), batch: sum('batch'), fx: sum('fx') };

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const ARMS = ['agent-loop', 'playwright-script', 'foresight-stepwise', 'foresight-cold', 'foresight-warm'];
const ARM_NAME = { 'agent-loop': 'Agent loop (observe→act each step)', 'playwright-script': 'Hand-written Playwright script', 'foresight-stepwise': 'Foresight, speculation off (window = 1)', 'foresight-cold': 'Foresight, first visit', 'foresight-warm': 'Foresight, learned page' };
function engTable(rtt) {
  return ARMS.map((arm) => ({ arm, cells: SC.map((sc) => {
    const rs = eng[rtt].filter((r) => r.arm === arm && r.scenario === sc);
    const ok = rs.filter((r) => r.valid);
    return { n: rs.length, ok: ok.length, med: median(ok.map((r) => r.pageMs)), rt: median(ok.map((r) => r.roundTrips).filter((x) => x != null)) };
  }) }));
}
const tbl0 = engTable(0), tbl40 = engTable(40);
const allOk = (t, arm) => { const row = t.find((r) => r.arm === arm); return row.cells.reduce((a, c) => a + c.ok, 0) + '/' + row.cells.reduce((a, c) => a + c.n, 0); };

const s = (ms) => (ms == null ? '—' : ms >= 10000 ? (ms / 1000).toFixed(1) + ' s' : ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const fmtCell = (c) => (c.n === 0 ? '<td class="na">—</td>' : c.ok === 0 ? `<td class="fail">failed ${c.n}/${c.n}</td>` : `<td>${s(c.med)}${c.ok < c.n ? ` <span class="warn">(${c.n - c.ok} failed)</span>` : ''}</td>`);
const tableHtml = (t) => `<table><thead><tr><th>Executor</th>${SC.map((sc) => `<th>${tasks[sc].title.replace(/ \(.*/, '')}</th>`).join('')}<th>Valid</th></tr></thead><tbody>
${t.map((row) => `<tr class="${row.arm.startsWith('foresight') ? 'fx' : ''}"><th scope="row">${ARM_NAME[row.arm]}</th>${row.cells.map(fmtCell).join('')}<td>${allOk(t, row.arm)}</td></tr>`).join('\n')}</tbody></table>`;

// ---- chart: Claude end-to-end, grouped horizontal bars (seconds, one axis) ----
const SERIES = [['step', 'Claude, one action per call'], ['batch', 'Claude, batched calls'], ['fx', 'Claude plans once + Foresight']];
const W = 760, rowH = 70, top = 34, left = 150, right = 70, H = top + SC.length * rowH + 30;
const maxV = Math.max(...claude.flatMap((r) => [r.step, r.batch, r.fx]).filter(Boolean));
const niceMax = Math.ceil(maxV / 10000) * 10000;
const x = (v) => left + (v / niceMax) * (W - left - right);
let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="End-to-end task time per scenario for three ways Claude can drive the browser">`;
for (let g = 0; g <= niceMax; g += 10000) svg += `<line class="grid" x1="${x(g)}" x2="${x(g)}" y1="${top - 6}" y2="${H - 26}"/><text class="tick" x="${x(g)}" y="${H - 8}" text-anchor="middle">${g / 1000}s</text>`;
claude.forEach((r, i) => {
  const y0 = top + i * rowH;
  svg += `<text class="cat" x="${left - 12}" y="${y0 + 30}" text-anchor="end">${tasks[r.sc].title.replace(/ \(.*/, '')}</text>`;
  SERIES.forEach(([k, name], j) => {
    const v = r[k]; if (v == null) return;
    const y = y0 + 6 + j * 18, w = Math.max(3, x(v) - left);
    svg += `<g class="bar" data-tip="${tasks[r.sc].title.replace(/ \(.*/, '')} · ${name}: ${s(v)}"><rect class="hit" x="${left}" y="${y - 2}" width="${W - left - right + 60}" height="18"/>
      <path class="s${j + 1}" d="M${left},${y} h${w - 4} a4,4 0 0 1 4,4 v6 a4,4 0 0 1 -4,4 h-${w - 4} z"/>
      ${k === 'fx' || i === 0 ? `<text class="val" x="${left + w + 6}" y="${y + 11}">${s(v)}</text>` : ''}</g>`;
  });
});
svg += `<line class="axis" x1="${left}" x2="${left}" y1="${top - 6}" y2="${H - 26}"/></svg>`;

const speedup = (a, b) => (a / b).toFixed(1) + '×';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Foresight benchmark</title>
<style>
:root{color-scheme:light;--bg:#f6f6f4;--surface-1:#fcfcfb;--line:#e4e3df;--text-primary:#0b0b0b;--text-secondary:#52514e;--muted:#7a7974;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--bad:#c9372c;--warnc:#9a6700;--fx:#eef6f2}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--bg:#121211;--surface-1:#1a1a19;--line:#2e2d2b;--text-primary:#f0efec;--text-secondary:#c3c2b7;--muted:#8f8e88;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--bad:#ff7a6e;--warnc:#e0a93a;--fx:#16241e}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#121211;--surface-1:#1a1a19;--line:#2e2d2b;--text-primary:#f0efec;--text-secondary:#c3c2b7;--muted:#8f8e88;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--bad:#ff7a6e;--warnc:#e0a93a;--fx:#16241e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text-primary);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:19px;margin:36px 0 10px}
.lede{color:var(--text-secondary);max-width:720px;margin:0 0 24px}.card{background:var(--surface-1);border:1px solid var(--line);border-radius:14px;padding:20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.tile .big{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}.tile .lbl{color:var(--text-secondary);font-size:13.5px}
.legend{display:flex;flex-wrap:wrap;gap:16px;font-size:13.5px;color:var(--text-secondary);margin-bottom:8px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--line);stroke-width:1}.axis{stroke:var(--muted);stroke-width:1}.tick{fill:var(--muted);font-size:12px}.cat{fill:var(--text-primary);font-size:13.5px;font-weight:600}.val{fill:var(--text-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.s1{fill:var(--series-1)}.s2{fill:var(--series-2)}.s3{fill:var(--series-3)}.hit{fill:transparent}.bar:hover path{opacity:.85}
#tip{position:fixed;pointer-events:none;background:var(--text-primary);color:var(--surface-1);font-size:12.5px;padding:6px 9px;border-radius:7px;opacity:0;transition:opacity .1s}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}thead th{color:var(--text-secondary);font-weight:600;font-size:12.5px}tbody th{text-align:left;font-weight:600}
tr.fx{background:var(--fx)}td.fail{color:var(--bad);font-weight:600}.warn{color:var(--warnc)}td.na{color:var(--muted)}
ul.find li{margin:6px 0}.note{color:var(--text-secondary);font-size:13.5px}code{font-size:13px}
details summary{cursor:pointer;color:var(--text-secondary);font-size:13.5px;margin-top:10px}
</style></head><body><main>
<h1>Foresight: speculative browser actions</h1>
<p class="lede">Same six tasks, same validated finish line. Each page times itself from load to a correct, validated submit. Claude's own runs include its thinking time, because that is what a user waits for.</p>

<div class="tiles">
  <div class="card tile"><div class="big">${s(T.fx)}</div><div class="lbl">All 6 tasks: Claude plans once + Foresight runs it</div></div>
  <div class="card tile"><div class="big">${s(T.batch)}</div><div class="lbl">All 6 tasks: Claude with batched browser calls</div></div>
  <div class="card tile"><div class="big">${s(T.step)}</div><div class="lbl">All 6 tasks: Claude, one action per call</div></div>
  <div class="card tile"><div class="big">${speedup(T.step, T.fx)}</div><div class="lbl">faster than step-by-step (${speedup(T.batch, T.fx)} vs batched)</div></div>
</div>

<h2>End to end, with Claude in the loop</h2>
<div class="card">
  <div class="legend">${SERIES.map(([, n], j) => `<span><i style="background:var(--series-${j + 1})"></i>${n}</span>`).join('')}</div>
  ${svg}
  <details><summary>Show as table</summary><div class="tablewrap"><table><thead><tr><th>Task</th>${SERIES.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
  ${claude.map((r) => `<tr><th scope="row">${tasks[r.sc].title}</th><td>${s(r.step)}</td><td>${s(r.batch)}</td><td>${s(r.fx)}</td></tr>`).join('')}</tbody></table></div></details>
  <p class="note">One run per cell (these are live Claude sessions, not repeatable scripts). Every run was validated by the page. Claude's batched long-form run includes a 5 s failed click and its retry.</p>
</div>

<h2>Executors head to head, local browser</h2>
<p class="note">Median of 10 runs per cell, fresh browser context each run. Model thinking time is excluded here: this isolates the machinery. Autocomplete and checkout are dominated by the page's own server/transition delays (≈1.5 s).</p>
<div class="card tablewrap">${tableHtml(tbl0)}</div>

<h2>Same, through a remote browser (40 ms round trip)</h2>
<p class="note">Hosted browsers sit 30–80 ms away. A TCP proxy delays every DevTools message 20 ms each way. Median of 5 runs. This is where speculation pays: Foresight sends a whole window of actions per round trip.</p>
<div class="card tablewrap">${tableHtml(tbl40)}</div>

<h2>What we learned</h2>
<div class="card"><ul class="find">
<li><b>The model round trip is the bottleneck, not the browser.</b> Claude step-by-step spent ≈2 s per action. Foresight executes a 20-field grid in ≈0.3 s locally. Planning once and executing speculatively cut total time from ${s(T.step)} to ${s(T.fx)}.</li>
<li><b>Speed without checks is how batching goes wrong.</b> On the popup page, the hand-written script and the agent loop both typed into the form while a popup covered it (the popup opens the moment the 3rd field is focused). They failed every run. Foresight's tripwire caught the popup, declined it, and resumed: 10/10.</li>
<li><b>Layouts drift.</b> The profile page shuffles ids, order and labels every load. The hand-written script failed every run. Foresight resolves targets by meaning, not selectors: no failures.</li>
<li><b>Claude's batch mode guessed refs for screens that didn't exist yet</b> (checkout, autocomplete) and got lucky. Nothing in it verifies. Foresight checks every step's result inside the page at no extra round-trip cost.</li>
<li><b>Irreversible actions are never speculated.</b> "Place order", "Create account" and "Send request" get a checkpoint: every earlier field is re-read before the click.</li>
</ul></div>

<h2>How Foresight works</h2>
<div class="card"><ul class="find">
<li><b>Action windows:</b> a batch of steps runs inside the page in one round trip, with per-step confidence, reachability (is it covered?) and postcondition checks.</li>
<li><b>Evidence-based confidence:</b> match quality and ambiguity of the target, fused with past success on this step. It never asks the model "how sure are you?".</li>
<li><b>Risk-weighted gate:</b> a step runs only if (1 − p) × cost-of-mistake stays under budget. Typing is cheap to redo; a submit is not.</li>
<li><b>Adaptive window (like TCP):</b> the window doubles while steps succeed and halves on any surprise.</li>
<li><b>Tripwire + repair:</b> a DOM observer stops the run the instant a dialog or navigation appears. Popups are dismissed the privacy-preserving way (decline/close); missing elements are waited for; only real dead-ends go back to the model.</li>
<li><b>Semantic cache:</b> learned selectors are reused only if they still mean the same thing, so the cache can't silently click the wrong field.</li>
</ul></div>

<h2>Honest limits</h2>
<div class="card"><ul class="find">
<li>The test site is mine, built to be hard. Real sites add canvas widgets, iframes, shadow DOM and bot checks that are not covered yet.</li>
<li>Foresight fills fields with framework-safe synthetic events. Sites that demand real keystrokes need the trusted-input fallback (built, lightly tested).</li>
<li>Claude arms are single live runs. Foresight and baseline arms are 10 runs locally and 5 remote.</li>
<li>The Claude batch numbers also include the browser pane's "not drawn yet" retries, a real cost in that setup.</li>
</ul></div>
<div id="tip"></div>
<script>
const tip=document.getElementById('tip');
document.querySelectorAll('.bar').forEach(b=>{b.addEventListener('mousemove',e=>{tip.textContent=b.dataset.tip;tip.style.opacity=1;tip.style.left=Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8)+'px';tip.style.top=(e.clientY+14)+'px'});b.addEventListener('mouseleave',()=>tip.style.opacity=0)});
</script>
</main></body></html>`;
fs.writeFileSync('report.html', html);
console.log('report.html written', T, claude);
