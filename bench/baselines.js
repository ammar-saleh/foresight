// Baselines Foresight is compared against.
//  - playwrightScript: the classic hand-written automation script (getByLabel / getByRole, auto-waiting).
//  - agentLoop: the standard "observe -> decide -> act" agent loop, one action per cycle, with a full
//    observation (accessibility snapshot + screenshot) before every action. The "decide" part is an
//    oracle that reads the plan (model think-time is added separately in the report from measured data).

function locate(page, step) {
  const t = step.target;
  if (t.row) return page.getByLabel(`${t.row} ${t.col}`, { exact: true });
  if (step.op === 'click') return page.getByRole('button', { name: t.text, exact: true });
  if (step.op === 'radio') return page.getByRole('group', { name: t.label }).getByLabel(step.value, { exact: true });
  // a careful script author narrows by control type, so "Email" (field) never collides with "Email" (radio option)
  const kind = { fill: 'input:not([type=radio]):not([type=checkbox]), textarea', pick: 'input', select: 'select', check: 'input[type=checkbox]', uncheck: 'input[type=checkbox]' }[step.op];
  const byLabel = page.getByLabel(t.label ?? t.text, { exact: true });
  return kind ? byLabel.and(page.locator(kind)) : byLabel;
}

async function act(page, step, timeout) {
  const loc = locate(page, step);
  const o = { timeout };
  switch (step.op) {
    case 'fill': return loc.fill(String(step.value), o);
    case 'select': return loc.selectOption({ label: step.value }, o);
    case 'check': return loc.check(o);
    case 'uncheck': return loc.uncheck(o);
    case 'radio': return loc.check(o);
    case 'pick':
      await loc.fill(step.typeText ?? String(step.value).slice(0, 3), o);
      return page.getByRole('option', { name: step.value, exact: true }).click(o);
    case 'click':
      await loc.click(o);
      if (step.expect?.text) await page.getByText(step.expect.text).first().waitFor({ timeout: step.expect.timeout || timeout });
      if (step.expect?.label) await page.getByLabel(step.expect.label).waitFor({ timeout: step.expect.timeout || timeout });
  }
}

export async function playwrightScript(page, steps, { timeout = 5000 } = {}) {
  const t0 = performance.now();
  let actions = 0;
  try {
    for (const s of steps) { await act(page, s, timeout); actions++; }
    return { ok: true, ms: performance.now() - t0, actions };
  } catch (e) { return { ok: false, ms: performance.now() - t0, actions, reason: String(e.message).split('\n')[0] }; }
}

export async function agentLoop(page, steps, { timeout = 5000 } = {}) {
  const t0 = performance.now();
  let observations = 0, decisions = 0, obsMs = 0;
  try {
    for (let k = 0; k < steps.length; k++) {
      let s = steps[k];
      // OBSERVE: what LLM browser agents send the model each turn
      const o0 = performance.now();
      const snap = await page.locator('body').ariaSnapshot();
      await page.screenshot({ type: 'jpeg', quality: 60 });
      obsMs += performance.now() - o0; observations++;
      // DECIDE (oracle stand-in for the model): react to what it sees, like a model would
      decisions++;
      if (/dialog/.test(snap) && /No thanks/.test(snap)) { await page.getByRole('button', { name: 'No thanks' }).click({ timeout }); k--; continue; }
      if (s.op === 'click' && s.expect?.text && !snap.includes(`"${s.target.text}"`)) {
        const m = snap.match(/button "([^"]*Save[^"]*)"/);       // the model reads the real button name off the page
        if (m) s = { ...s, target: { text: m[1] } };
      }
      if (s.target.label && !snap.includes(`"${s.target.label}"`) && s.op !== 'radio') {
        // the model reads the label that is actually on screen ("Timezone", "Mobile phone", ...)
        const names = [...snap.matchAll(/(?:textbox|combobox|checkbox|spinbutton) "([^"]+)"/g)].map((m) => m[1]);
        const words = (x) => x.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
        const want = words(s.target.label).join('');
        const best = names.map((n) => [n, words(n).filter((w) => want.includes(w)).join('').length]).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) s = { ...s, target: { label: best[0] } };
      }
      // ACT
      await act(page, s, timeout);
    }
    return { ok: true, ms: performance.now() - t0, observations, decisions, obsMs };
  } catch (e) { return { ok: false, ms: performance.now() - t0, observations, decisions, obsMs, reason: String(e.message).split('\n')[0] }; }
}
