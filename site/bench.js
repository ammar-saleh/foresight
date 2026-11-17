// Shared benchmark harness. Every page times itself from navigation start to a validated finish,
// so every executor (step-by-step agent, Playwright script, Foresight) is measured the same way.
(() => {
  const qs = new URLSearchParams(location.search);
  const scenario = document.body.dataset.scenario;
  const state = { scenario, arm: qs.get('arm') || 'manual', run: qs.get('run') || '', flags: [], failedSubmits: 0, done: false };
  window.Bench = state;

  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `<span>Scenario <b>${scenario}</b></span><span>Arm <b>${state.arm}</b></span><span class="timer">0.0 s</span>`;
  document.body.prepend(bar);
  const timer = bar.querySelector('.timer');
  const tick = setInterval(() => { if (!state.done) timer.textContent = (performance.now() / 1000).toFixed(1) + ' s'; }, 100);

  state.task = fetch('/tasks/tasks.json').then((r) => r.json()).then((t) => t[scenario]);
  state.flag = (f) => { if (!state.flags.includes(f)) state.flags.push(f); };

  const norm = (v) => String(v ?? '').trim();
  // Compare expected {label: value} with actual {label: value}; returns list of human-readable errors.
  state.diff = (expected, actual) => {
    const errs = [];
    for (const [k, v] of Object.entries(expected)) {
      if (typeof v === 'object' && v !== null) { errs.push(...state.diff(v, actual[k] || {}).map((e) => `${k} / ${e}`)); continue; }
      if (norm(actual[k]) !== norm(v)) errs.push(`${k}: expected "${v}", got "${actual[k] ?? ''}"`);
    }
    return errs;
  };

  state.reject = (errors, el) => {
    state.failedSubmits++;
    if (el) el.textContent = errors.join('\n');
  };

  state.finish = async (mount, extra = {}) => {
    if (state.done) return;
    const ms = Math.round(performance.now());
    state.done = true; state.ms = ms; clearInterval(tick);
    timer.textContent = (ms / 1000).toFixed(2) + ' s';
    document.body.dataset.benchDone = 'ok';
    const box = document.createElement('div');
    box.className = 'done'; box.id = 'bench-done';
    box.textContent = `Completed and validated in ${(ms / 1000).toFixed(2)} s`;
    (mount || document.querySelector('main')).append(box);
    const rec = { scenario, arm: state.arm, run: state.run, ms, ok: true, failedSubmits: state.failedSubmits, flags: state.flags, ...extra };
    try { await fetch('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }); } catch {}
  };
})();
