// Foresight: speculative, confidence-gated browser action engine.
//
// The idea: browser agents are slow because every action pays a full observe -> think -> act round trip.
// Foresight takes a whole plan at once and *speculates*: it ships a window of actions into the page,
// where they execute back-to-back with per-step confidence gates, real-reachability checks and
// postcondition checks. The window grows while things go well and shrinks the moment they don't
// (AIMD, like TCP congestion control). Irreversible actions are never speculated: they get a checkpoint.
// When the fast path is not enough for one step, that step alone drops to "careful mode"
// (real mouse / real keystrokes), and only genuine dead-ends go back to the planner.
import fs from 'node:fs';
import path from 'node:path';
import { foresightRuntime } from './runtime.js';

export const RUNTIME_SRC = `(${foresightRuntime.toString()})();`;
const BUILD = String(RUNTIME_SRC.length) + ':' + [...RUNTIME_SRC].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// Cost of being wrong, per action kind. Expected loss = (1 - p) * cost must stay under the budget.
// Every kind costs the same: a tick box, a field or a dropdown with a name that is only "close" is as much a guess
// as a button is. With the default budget this means the control must be named exactly (see `sim` in the runtime).
export const DEFAULT_COSTS = { fill: 4, select: 4, check: 4, uncheck: 4, radio: 4, pick: 4, expand: 4, hover: 4, click: 4, dblclick: 4, rightclick: 4, drag: 4, upload: 4 };
// failures that are known to have happened before anything was sent to the page
const NOT_ACTED = new Set(['notfound', 'lowconf', 'hidden', 'disabled', 'blocked', 'interrupt', 'needs-keys', 'nofocus', 'nofile', 'conflict', 'unconfirmed', 'bad-expect', 'moved']);
const PRESSES = ['click', 'keys', 'dblclick', 'rightclick', 'clickAt', 'pick'];
const PAGE_OPS = ['fill', 'select', 'check', 'uncheck', 'radio', 'pick', 'click', 'expand'];   // run inside the page, in windows
const NODE_OPS = ['keys', 'type', 'hover', 'dblclick', 'rightclick', 'goto', 'upload', 'drag', 'scroll', 'clickAt', 'read', 'expect'];
const MOUSE_OPS = ['click', 'hover', 'dblclick', 'rightclick', 'drag'];   // a bare string names visible text                                 // real input / navigation, one at a time
const STEP_KEYS = ['value', 'typeText', 'expect', 'risk', 'frame', 'dialog', 'timeout', 'waitMs', 'to', 'file', 'real', 'scripted'];
const EXPECT_KEYS = ['text', 'title', 'url', 'selector', 'gone', 'label', 'timeout', 'op'];
const TARGET_KEYS = ['label', 'text', 'css', 'near', 'nth', 'row', 'col'];
const GONE = /context was destroyed|navigat|target closed|frame was detached|cannot find context/i;

export class Foresight {
  constructor(opts = {}) {
    this.cachePath = opts.cachePath ?? null;
    this.lossBudget = opts.lossBudget ?? 0.3;
    this.costs = { ...DEFAULT_COSTS, ...(opts.costs || {}) };
    this.window0 = opts.initialWindow ?? 4;
    this.windowMax = opts.maxWindow ?? 64;
    this.useCache = opts.useCache ?? true;
    this.clicks = opts.clicks ?? 'real';         // 'real' = real mouse presses, guarded in the page; 'scripted' = fast scripted clicks
    // Irreversible steps: 'verify' = audit then proceed automatically; 'confirm' = also ask onConfirm().
    this.irreversible = opts.irreversible ?? 'confirm';
    this.onConfirm = opts.onConfirm ?? (async () => false);
    this.onEscalate = opts.onEscalate ?? null;   // (context) => replacement step | null   (= a model call)
    this.popups = opts.popups ?? [];              // button names that may be pressed in a pop-up that was simply in the way (a plan can set its own "popups")
    this.pageSeen = opts.pageSeen ?? false;       // the planner has seen the page as it is when run() starts (dialogs open now are known to it)
    this.log = opts.log ?? (() => {});
    this.cache = this.loadCache();
  }

  loadCache() {
    if (!this.cachePath || !fs.existsSync(this.cachePath)) return {};
    try { return JSON.parse(fs.readFileSync(this.cachePath, 'utf8')); } catch { return {}; }
  }
  saveCache() {
    if (!this.cachePath) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 1));
  }

  async attach(page) {
    this.page = page;
    await page.addInitScript(`${RUNTIME_SRC}; window.__FS_BUILD = ${JSON.stringify(BUILD)};`);
    return this;
  }
  // (Re)inject the runtime when it is missing or when the document still holds an older build.
  async ensureRuntime(target = this.page) {
    const has = await target.evaluate((b) => !!window.__FS && window.__FS_BUILD === b, BUILD).catch(() => false);
    if (!has) await target.evaluate(`delete window.__FS; ${RUNTIME_SRC}; window.__FS_BUILD = ${JSON.stringify(BUILD)};`);
  }
  // A step may live in an embedded frame: "frame": 1 (the number shown by `look`) or part of the frame's address.
  frameFor(f) {
    if (f == null || f === 0) return this.page;
    const frames = this.page.frames();
    const fr = typeof f === 'number' ? frames[f] : frames.find((x) => x !== this.page.mainFrame() && (x.url().includes(f) || x.name() === f));
    if (!fr) throw new Error(`frame ${JSON.stringify(f)} not found (the page has ${frames.length - 1} embedded frame(s))`);
    return fr;
  }

  // Normalize the plan's human-level steps into runtime steps; reject anything malformed up front,
  // because a misspelt field must never turn a check into a no-op.
  normalize(plan) {
    if (!plan || !Array.isArray(plan.steps)) throw new Error('a plan must be an object with a "steps" array');
    return plan.steps.map((s, i) => {
      const bad = (msg) => { throw new Error(`step ${i}: ${msg}`); };
      if (!s || typeof s !== 'object' || Array.isArray(s)) bad('must be an object like {"click": "Save"}');
      let ops = Object.keys(s).filter((k) => k !== 'expect' && (PAGE_OPS.includes(k) || NODE_OPS.includes(k)));
      if (ops.length === 0 && s.expect != null) ops = ['expect'];                 // a step that only waits for / checks something
      const unsupported = Object.keys(s).find((k) => /^(wait|sleep|pause|delay)/i.test(k));
      if (ops.length === 0 && unsupported) bad(`"${unsupported}" is not a step: Foresight waits by itself. To wait for something specific use {"expect": {"text": "..."}}`);
      if (ops.length === 0) bad(`has no known action (expected one of: ${[...PAGE_OPS, ...NODE_OPS].join(', ')})`);
      if (ops.length > 1) bad(`has more than one action (${ops.join(', ')}): use one step per action`);
      const op = ops[0];
      const unknown = Object.keys(s).filter((k) => k !== op && !STEP_KEYS.includes(k));
      if (s.to != null && op !== 'drag') bad('"to" only belongs to a "drag" step');
      if (s.file != null && op !== 'upload') bad('"file" only belongs to an "upload" step');
      if (unknown.length) bad(`unknown field ${unknown.map((u) => `"${u}"`).join(', ')}${unknown.some((u) => TARGET_KEYS.includes(u)) ? ` ("near" / "nth" / "css" belong inside the target: {"${op}": {"label": "...", "near": "..."}})` : ''}`);
      if (s.risk != null && s.risk !== 'irreversible' && s.risk !== 'normal') bad(`"risk" must be "irreversible" (got ${JSON.stringify(s.risk)})`);
      if (s.dialog != null && s.dialog !== 'accept' && s.dialog !== 'dismiss') bad(`"dialog" must be "accept" or "dismiss" (got ${JSON.stringify(s.dialog)})`);
      if (s.expect != null) {
        if (typeof s.expect !== 'object' || Array.isArray(s.expect)) bad('"expect" must be an object like {"text": "Saved"}');
        const ek = Object.keys(s.expect), unk = ek.filter((k) => !EXPECT_KEYS.includes(k));
        if (unk.length) bad(`"expect" has unknown field ${unk.map((u) => `"${u}"`).join(', ')} (use text, title, url, label, selector or gone)`);
        if (!ek.some((k) => k !== 'timeout' && k !== 'op')) bad('"expect" checks nothing');
      }
      if (s.real != null && (op !== 'click' || typeof s.real !== 'boolean')) bad('"real" only applies to a "click" step');
      if (s.scripted != null && (op !== 'click' || typeof s.scripted !== 'boolean')) bad('"scripted" only applies to a "click" step');
      // clicks are real mouse presses unless the plan asks for a scripted one ("scripted": true, or the older "real": false)
      const base = { i, op, expect: s.expect, risk: s.risk || 'normal', frame: s.frame, dialog: s.dialog, scripted: op === 'click' && (s.scripted === true || s.real === false || this.clicks === 'scripted') };
      if (op === 'expect') return { ...base, target: {} };
      if (op === 'keys' || op === 'type' || op === 'goto') {
        if (typeof s[op] !== 'string' || !s[op]) bad(`"${op}" needs a text value`);
        return { ...base, value: s[op], target: {} };
      }
      if (op === 'scroll') {
        if (!['down', 'up', 'top', 'bottom'].includes(s[op])) bad('"scroll" must be "down", "up", "top" or "bottom"');
        return { ...base, value: s[op], target: {} };
      }
      if (op === 'read') {
        const v = s[op];
        if (!(typeof v === 'string' && v) && !(v && typeof v === 'object' && (v.css || v.text || (v.row != null && v.col != null)))) bad('"read" needs words to look for, {"css": "..."}, or a table cell {"row": "...", "col": "..."}');
        return { ...base, value: v, target: {} };
      }
      if (op === 'clickAt') {
        const v = s[op];
        if (!v || typeof v !== 'object' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) bad('"clickAt" needs {"x": number, "y": number} and optionally "css" (then x/y are measured from that element\'s top-left corner)');
        if (s.frame != null) bad('"clickAt" works on the main page only');
        return { ...base, value: v, target: {} };
      }
      const t = s[op];
      const asTarget = (v) => (typeof v === 'string' ? (MOUSE_OPS.includes(op) ? { text: v } : { label: v }) : v);
      const target = asTarget(t);
      if (!target || typeof target !== 'object' || Array.isArray(target)) bad(`"${op}" needs a target (a name, or an object like {"css": ...})`);
      const tk = Object.keys(target).filter((k) => !TARGET_KEYS.includes(k));
      if (tk.length) bad(`target has unknown field ${tk.map((u) => `"${u}"`).join(', ')}`);
      if (target.label == null && target.text == null && target.css == null && target.row == null) bad('target needs a name ("label"/"text"), a "css" selector, or "row" + "col"');
      if (target.nth != null && (!Number.isInteger(target.nth) || target.nth === 0)) bad('"nth" counts from 1 (or -1 for the last)');
      const radioByPosition = op === 'radio' && (target.nth != null || target.css != null);
      if ((op === 'fill' || op === 'select' || op === 'radio' || op === 'pick') && s.value == null && !radioByPosition) bad(`"${op}" needs a "value"`);
      let to, file;
      if (op === 'drag') {
        to = asTarget(s.to);
        if (!to || typeof to !== 'object' || Array.isArray(to) || (to.label == null && to.text == null && to.css == null)) bad('"drag" needs "to": where to drop it (a name, or {"css": ...})');
      }
      if (op === 'upload') {
        file = [].concat(s.file ?? []);
        if (!file.length || !file.every((f) => typeof f === 'string' && f)) bad('"upload" needs "file": the path of the file to attach (or a list of paths)');
      }
      return { ...base, target, to, file, value: s.value, typeText: s.typeText, timeout: s.timeout, waitMs: s.waitMs ?? 0 };
    });
  }

  thresholdFor(step) {
    const t = Math.max(0, 1 - this.lossBudget / (this.costs[step.op] ?? 4));
    return step.risk === 'irreversible' ? Math.max(t, 0.93) : t;      // never easier than an ordinary click
  }

  // History -> log-odds shift. Beta(a, b) per step, centred on the cold prior Beta(4,1). Only used for cache-confirmed targets.
  priorShift(entry) {
    if (!entry) return 0;
    const m = (entry.a + 4) / (entry.a + entry.b + 5);
    const lo = (p) => Math.log(p / (1 - p));
    return Math.max(-3, Math.min(3, lo(Math.min(0.999, m)) - lo(0.8)));
  }

  prep(step, memo) {
    const m = memo?.steps[step.i];
    const stay = ['keys', 'type'].includes(this._steps?.[step.i + 1]?.op);     // a key press follows: keep focus in this field
    return { ...step, stay, cacheCss: this.useCache ? m?.css : undefined, priorShift: this.useCache ? this.priorShift(m) : 0, threshold: this.thresholdFor(step) };
  }

  async run(plan, { startAt = 0, seen = this.pageSeen } = {}) {
    const t0 = performance.now();
    this._fail = null; this._pressed = false;
    let page = this.page;
    const stats = { roundTrips: 0, windows: [], repairs: [], warnings: [], notes: [], reads: [], modelCalls: 0, checkpoints: 0, cacheHits: 0, heals: 0, navigations: 0 };
    let steps;
    try { steps = this._steps = this.normalize(plan); } catch (e) { return this.finish(plan, t0, stats, false, e.message); }
    if (plan.popups != null && !(Array.isArray(plan.popups) && plan.popups.every((x) => typeof x === 'string' && x))) return this.finish(plan, t0, stats, false, '"popups" must be a list of button names you allow to be pressed in a pop-up that is in the way, e.g. ["Reject all", "No thanks"]');
    const allowed = plan.popups ?? this.popups;
    if (!Number.isInteger(startAt) || startAt < 0 || startAt >= Math.max(1, steps.length)) return this.finish(plan, t0, stats, false, `cannot start at step ${startAt}: the plan has steps 0 to ${steps.length - 1}`);
    const memo = this.useCache ? (this.cache[plan.id] ||= { steps: {} }) : { steps: {} };
    // every failure says whether the step was sent to the page: false only when it is certain that nothing was
    const fail = (rec, reason) => {
      if (rec && rec.acted === undefined) rec.acted = NOT_ACTED.has(rec.status) ? false : rec.status === 'verify-failed' ? true : 'unknown';
      this._fail = rec; return this.finish(plan, t0, stats, false, reason);
    };

    await this.arm(page);
    this._dialogs = [];
    this._popup = null; this._tabKind = null; this._lastOp = null; this._lastStep = null;
    const onTab = (p) => { this._popup = p; };
    const ctx0 = page.context(); ctx0.on('page', onTab);
    this._cleanup = () => { ctx0.off('page', onTab); this._cleanup = null; };
    // A press of the plan opened another tab. Where does the task go on?
    //  - The pressed link itself said "open in a new tab": the task goes there, as it would for a person, unless the
    //    evidence says otherwise (what comes next is found on this page and not on the new one).
    //  - The page's own script opened it (it may be an advert): the plan stays, unless what comes next is found in
    //    the new tab and not here.
    // "What comes next" is the pressed step's own expectation if it has one, else the next step's control / words.
    // Either way the other tab's address is reported.
    const adoptTab = async (next, expect) => {
      const np = this._popup; this._popup = null;
      const kind = this._tabKind; this._tabKind = null;
      if (!np || np.isClosed()) return;
      const url = () => np.url().slice(0, 140);
      const opener = await np.opener().catch(() => null);
      if (opener !== page || !PRESSES.includes(this._lastOp)) { stats.warnings.push(`another tab opened (${url()}) that no press of this plan opened; it was left alone`); return; }
      const found = async (tg) => {
        try {
          await this.ensureRuntime(tg);
          if (expect) return !!(await tg.evaluate((e) => window.__FS.expectNow(e), expect));
          if (!next) return null;
          const t = next.target || {};
          if (t.label != null || t.text != null || t.css != null || t.row != null) { const loc = await tg.evaluate(([st]) => window.__FS.locate(st), [this.prep({ ...next, op: PAGE_OPS.includes(next.op) ? next.op : 'click' }, memo)]); return !!loc.found && loc.p >= this.thresholdFor(next); }
          if (next.op === 'read') return (await tg.evaluate((v) => window.__FS.read(v), next.value)).length > 0;
          if (next.expect) return !!(await tg.evaluate((e) => window.__FS.expectNow(e), next.expect));
          return null;
        } catch { return false; }
      };
      let here = null; try { here = await found(expect ? page : this.frameFor(next?.frame)); } catch { here = false; }
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      await this.arm(np);
      const old = this.page; this.page = np; try { await this.pageReady(); } finally { this.page = old; }
      const there = await found(np);
      // a tab the page's own script opened is followed only on the pressed step's own expectation, met there and not here
      const go = kind === 'link' ? !(here === true && there !== true) : (!!expect && here !== true && there === true);
      if (!go) { stats.warnings.push(`step ${this._lastStep} opened another tab (${url()}); the plan stayed on this page${here === true ? ', where what comes next is' : ''}. To continue in that tab instead, use {"goto": "<its address>"}`); return; }
      this.page = page = np;
      stats.newTabs = (stats.newTabs || 0) + 1;
      stats.notes.push(`step ${this._lastStep} opened a new tab (${url()}); the plan continues there`);
    };
    await this.ensureRuntime();
    // A fresh run forgets what earlier runs wrote. A resumed run takes over the fields its earlier steps wrote.
    {
      const seed = new Map();
      let since = 0; for (let k = startAt - 1; k >= 0; k--) if (!['fill', 'select', 'check', 'uncheck', 'radio', 'pick', 'expect', 'read', 'scroll', 'hover', 'type', 'expand'].includes(steps[k].op)) { since = k + 1; break; }
      for (const s of steps.slice(since, startAt)) if (['fill', 'select', 'check', 'uncheck', 'radio'].includes(s.op)) { const k = s.frame ?? 0; if (!seed.has(k)) seed.set(k, []); seed.get(k).push(this.prep(s, memo)); }
      for (const k of new Set([0, ...steps.map((s) => s.frame ?? 0)])) {
        try { const tg = this.frameFor(k === 0 ? null : k); await this.ensureRuntime(tg); stats.roundTrips++; await tg.evaluate(([sd, o]) => window.__FS.begin(sd, o), [seed.get(k) || [], { seen: !!seen }]); } catch {}
      }
    }
    const cssOf = {};                                         // where each step's control is, for this run only

    let W = Object.keys(memo.steps).length > 0 ? this.windowMax : this.window0;
    let i = startAt, attempts = 0;
    // steps before a resume point were completed by the earlier run: they still take part in the audit
    const done = new Set(steps.slice(0, startAt).map((s) => s.i)), seenDrift = new Set();

    while (i < steps.length) {
      const step = steps[i];
      if (this._popup) await adoptTab(step, null);
      if (++attempts > steps.length * 4 + 20) return fail({ i, op: step.op, status: 'gave-up', why: 'too many attempts without progress' }, `gave up at step ${i}`);
      this._dialogPolicy = step.dialog;

      let target;
      try { target = this.frameFor(step.frame); await this.ensureRuntime(target); }
      catch (e) {
        if (GONE.test(String(e))) { await this.pageReady(); continue; }
        return fail({ i, op: step.op, status: 'error', why: String(e.message).split('\n')[0] }, `error at step ${i}`);
      }
      const rt = async (fn, arg) => { stats.roundTrips++; return target.evaluate(fn, arg); };

      // ---- irreversible (any kind of step): checkpoint first, never speculate ----
      if (step.risk === 'irreversible') {
        stats.checkpoints++;
        const drift = await this.auditAll(steps, done, i, memo, stats);
        // Nothing is put back behind the page's back: if a value the plan wrote is no longer there, the planner decides.
        if (drift.length) return fail({ i, op: step.op, status: 'verify-failed', why: `before this irreversible step: the value written at step ${[...new Set(drift.map((d) => d.i))].join(', ')} is no longer in its field`, fields: drift, acted: false }, `a written value changed before step ${i}`);
        if (this.irreversible === 'confirm' && !(await this.onConfirm({ step, plan }))) return fail({ i, op: step.op, status: 'unconfirmed' }, 'irreversible step not confirmed');
      }

      // ---- real keyboard / mouse / navigation: one at a time, from outside the page ----
      if (NODE_OPS.includes(step.op)) {
        const bad = await this.nodeStep(step, target, stats, memo);
        if (bad) return fail(bad, `${bad.status} at step ${i}`);
        this._lastOp = step.op; this._lastStep = i;
        if (!['expect', 'read', 'scroll', 'hover', 'type'].includes(step.op)) this._pressed = true;
        done.add(i); i++; continue;
      }

      // ---- build the speculative window (same frame; ends at a click, a checkpoint or a real-input step) ----
      const chunk = [];
      for (let k = i; k < steps.length && chunk.length < W; k++) {
        const s = steps[k];
        if (NODE_OPS.includes(s.op) || (s.frame ?? null) !== (step.frame ?? null)) break;
        if ((s.risk === 'irreversible' || s.dialog != null) && k !== i) break;      // a step with its own answer for native dialogs runs alone
        chunk.push(this.prep(s, memo));
        if (s.risk === 'irreversible' || s.dialog != null || s.op === 'click') break;
      }
      const inChunk = new Set(chunk.map((c) => c.i));
      this._dialogPolicy = steps[chunk.at(-1).i].dialog;
      this._progress = null;
      const nav0 = page.__fsNav, req0 = page.__fsReq;
      const res = await rt(([c]) => window.__FS.runWindow(c), [chunk]).catch((e) => ({ error: String(e) }));
      if (res.error) {
        if (!GONE.test(res.error)) return fail({ i, op: step.op, status: 'error', why: res.error.split('\n')[0] }, res.error.split('\n')[0]);
        // The document went away mid-window. Find out which step was running when it did.
        await new Promise((r) => setTimeout(r, 40));
        const at = this._progress;
        await this.pageReady();
        stats.navigations++;
        if (at == null || !inChunk.has(at)) continue;                 // nothing had acted yet (an earlier navigation was still landing): run the window again
        const culprit = steps[at];
        chunk.filter((c) => c.i < at).forEach((c) => done.add(c.i));
        if (culprit.expect && !(await this.expectMet(culprit.expect, stats, culprit))) return fail({ i: at, op: culprit.op, status: 'timeout', why: 'expectation not met after the page changed', expect: culprit.expect, acted: true, reacted: true }, `expectation not met after navigation at step ${at}`);
        if (culprit.op !== 'click' && culprit.op !== 'select' && !culprit.expect) stats.warnings.push(`step ${at} (${culprit.op}) loaded a new page`);
        done.add(at); i = at + 1; continue;
      }
      const recs = res.steps.filter((r) => inChunk.has(r.i));       // never trust indices the page invents
      stats.windows.push({ start: i, size: chunk.length, okCount: recs.filter((s) => s.status === 'ok').length, ms: res.ms });

      // ---- the window ended on a click that is armed and waiting for the real mouse ----
      const armed = recs.at(-1)?.status === 'armed' ? recs.at(-1) : null;
      if (armed) {
        let fin;
        try {
          stats.roundTrips += 4;
          const pr = await this.press(target, armed.x, armed.y);
          if (pr.covered) {                                            // the page around the frame has something over that point: nothing was pressed
            await target.evaluate(() => window.__FS.disarm()).catch(() => {});
            fin = { status: 'blocked', why: 'something on the page around the frame covers this control', blocker: pr.covered, acted: false };
          } else fin = await target.evaluate(([st]) => window.__FS.finishClick(st), [this.prep(steps[armed.i], memo)]);
        } catch (e) {
          if (!GONE.test(String(e))) { await target.evaluate(() => window.__FS.disarm()).catch(() => {}); return fail({ i: armed.i, op: 'click', status: 'error', why: String(e.message || e).split('\n')[0] }, `error at step ${armed.i}`); }
          fin = { status: 'ok', left: true };                         // the page went away under the press: the click did it
        }
        if (fin.opensTab) {                                           // wait for the tab the press asked for, then decide where to go on
          this._tabKind = fin.opensTab;
          for (const end = Date.now() + 2500; !this._popup && Date.now() < end;) await new Promise((r) => setTimeout(r, 25));
          const cs = steps[armed.i];
          this._lastOp = 'click'; this._lastStep = armed.i;
          if (this._popup) await adoptTab(steps[armed.i + 1], fin.expectLater ? cs.expect : null);
          else stats.warnings.push(`step ${armed.i}: the link is marked to open a new tab, but no tab appeared`);
          if (fin.expectLater && !(await this.expectMet(cs.expect, stats, cs))) fin = { status: 'timeout', why: 'the click opened another tab, and the expectation is not met there or here', expect: cs.expect, acted: true, reacted: true };
        }
        if (fin.left) {
          await this.pageReady(); stats.navigations++;
          const cs = steps[armed.i];
          if (cs.expect && !(await this.expectMet(cs.expect, stats, cs))) fin = { status: 'timeout', why: 'expectation not met after the page changed', expect: cs.expect, acted: true, reacted: true };
        }
        Object.assign(armed, fin, { css: armed.css });
        if (armed.trip) res.trip = armed.trip;
        if (armed.status === 'moved' && armed.arrived === false) {    // the press went somewhere, but not into the control's document: never repeat it
          armed.status = 'blocked'; armed.acted = 'unknown'; armed.why = 'the real mouse press did not arrive in the page at all: something outside the page took it (a browser bubble or dialog on top of the window?). Look at a screenshot; if the page looks free, "scripted": true presses the control without the mouse';
        }
        if (armed.status === 'moved') {                               // nothing was pressed: look again and retry, a few times at most
          const cs = steps[armed.i]; cs.moved = (cs.moved || 0) + 1;
          stats.repairs.push({ at: armed.i, kind: 'press-cancelled' });
          if (cs.moved <= 3) { recs.pop(); for (const r of recs) { if (r.status === 'ok') { done.add(r.i); i = r.i + 1; } } await page.waitForTimeout(80); continue; }
          armed.status = 'blocked'; armed.why = 'the control keeps moving or being covered';
        }
      }

      let failed = null, lastOk = null;
      for (const r of recs) {
        const m = (memo.steps[r.i] ||= { a: 0, b: 0 });
        if (r.warn) stats.warnings.push(`step ${r.i}: ${r.warn}`);
        if (r.note && !stats.notes.includes(`step ${r.i}: ${r.note}`)) stats.notes.push(`step ${r.i}: ${r.note}`);      // (a step that was tried again says it once)
        if (r.css) cssOf[r.i] = r.css;
        if (r.status === 'ok') {
          m.a++; done.add(r.i); lastOk = r;
          if (r.css && !r.css.startsWith('[data-fs-ref')) m.css = r.css; else delete m.css;      // a tag put on the element is only good for this page load
          this._lastOp = steps[r.i].op; this._lastStep = r.i;
          if (steps[r.i].op !== 'fill') this._pressed = true;
          if (r.strategy === 'cache') stats.cacheHits++;
          if (r.strategy === 'heal') stats.heals++;
          i = r.i + 1;
          const s = steps[r.i];
          if (s.op === 'click' && !s.expect && r.reacted === false && !r.mayNavigate) stats.warnings.push(`step ${r.i}: the click ran but the page did not visibly react (add an "expect" to be sure it worked)`);
        } else { failed = r; if (!['blocked', 'interrupt', 'hidden', 'disabled', 'needs-keys'].includes(r.status)) m.b++; }
      }
      // A step that starts loading another page: wait for it to land and for its scripts to wire up before acting again.
      if (lastOk && (res.trip?.kind === 'navigation' || lastOk.mayNavigate || page.__fsNav > nav0)) {
        if (page.__fsNav === nav0 && res.trip?.kind === 'navigation') {      // the old page is on its way out: wait for the new one to land
          const end = Date.now() + 10000;
          while (page.__fsNav === nav0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
        }
        if (page.__fsNav > nav0) { stats.navigations++; await this.pageReady(); }
      }
      if (!failed) { W = Math.min(this.windowMax, W * 2); continue; }      // slow start: double on success
      this._fail = failed;

      // ---- divergence: shrink the window and repair at the exact step that failed ----
      W = Math.max(1, Math.floor(W / 2));
      const s = steps[failed.i];
      const by = (s.triesBy ||= {});
      by[failed.status] = (by[failed.status] || 0) + 1;
      const tries = by[failed.status];
      this.log(`step ${failed.i} ${failed.op}: ${failed.status}`);

      if (failed.status === 'blocked' || failed.status === 'interrupt') {
        let d = { clicked: null };
        // Only ever in the document the step lives in, and only what the runtime itself saw covering the control.
        if (tries <= 2) { stats.roundTrips++; d = await target.evaluate((o) => window.__FS.dismissInterrupt(o), { press: allowed }).catch(() => ({ clicked: null })); }
        // A helper left open by the previous field (a calendar, a suggestion list) covers this control: Escape in that
        // field closes it. Only when the runtime saw that helper pop up for that field, and the field is re-read after.
        const prev = steps[failed.i - 1];
        if (!d.clicked && tries === 1 && prev && ['fill', 'pick'].includes(prev.op) && cssOf[prev.i] && (prev.frame ?? null) === (s.frame ?? null)) {
          const safe = await target.evaluate((c) => window.__FS.helperBlocks(c), cssOf[prev.i]).catch(() => false);
          if (safe) {
            try {
              stats.roundTrips += 3;
              await target.locator(cssOf[prev.i]).first().focus({ timeout: 1500 });
              await page.keyboard.press('Escape');
              const kept = await target.evaluate(([st]) => window.__FS.check(st), [this.prep(prev, memo)]).catch(() => false);
              if (!kept) return fail({ i: failed.i, op: failed.op, status: 'verify-failed', why: `Escape was pressed to close the helper left open by step ${prev.i}, and that field no longer holds its value. Look at the page`, acted: true }, `a field changed at step ${failed.i}`);
              d = { clicked: 'Escape (closed a helper left open by the previous field)' };
            } catch {}
          }
        }
        stats.repairs.push({ at: failed.i, kind: 'interrupt', clicked: d.clicked });
        if (d.clicked) continue;
        failed.why = failed.why || d.why;
        if (d.dialog && !failed.dialog) { failed.dialog = d.dialog; if (d.why) failed.why = d.why; }
        if (!(await this.escalate(steps, failed, stats))) return fail(failed, `${failed.status} at step ${failed.i}: ${failed.why || 'something covers the control'}`);
        continue;
      }
      if (failed.status === 'unsure') return fail(failed, `unsure at step ${failed.i}`);       // it may have acted: never try again in any way
      if (failed.status === 'needs-keys' && s.risk === 'irreversible') failed.why = 'this field only takes real typing, and an irreversible step is never retried another way: click the field, then use a "type" step';
      if (failed.status === 'needs-keys' && tries === 1 && failed.css && s.risk !== 'irreversible') {
        stats.repairs.push({ at: failed.i, kind: 'real-typing' });
        stats.roundTrips += 4;
        try {
          await target.locator(failed.css).first().click({ timeout: 3000 });
          await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Delete');
          await page.keyboard.type(String(s.value));
        } catch {}
        const good = await rt(([st]) => window.__FS.check(st), [this.prep(s, memo)]).catch(() => false);
        if (good) { await target.evaluate(([st]) => window.__FS.track(st), [this.prep(s, memo)]).catch(() => {}); done.add(failed.i); i = failed.i + 1; continue; }
        failed = { ...failed, status: 'verify-failed', why: 'the editor did not keep the typed text', acted: true }; this._fail = failed;
      }
      if (failed.status === 'hidden') {
        // careful mode: move the real mouse over the row/card that owns the control, then try again
        if (tries === 1 && failed.hoverCss) {
          stats.repairs.push({ at: failed.i, kind: 'hover-to-reveal' });
          try { stats.roundTrips++; await target.locator(failed.hoverCss).first().hover({ timeout: 2500 }); continue; } catch {}
        }
        if (!(await this.escalate(steps, failed, stats))) return fail(failed, `hidden at step ${failed.i}: the control exists but is not visible`);
        continue;
      }
      if (failed.status === 'notfound' || failed.status === 'lowconf') {
        // It may simply not be on screen yet. After a press (a dialog on its way, a list loading) that is worth a real
        // wait; otherwise the page is as it is and a short moment is enough. Then the step is looked at afresh once.
        if (tries === 1) {
          const afterPress = [...PRESSES, 'select', 'check', 'uncheck', 'radio', 'expand', 'goto', 'drag'].includes(this._lastOp);
          let ok = false;
          try { ok = await rt(([st, ms, ap]) => window.__FS.waitFor(st, ms, ap), [this.prep(s, memo), !afterPress ? 400 : failed.status === 'lowconf' && failed.score >= 0.6 ? 1200 : 2500, afterPress]); }      // a control with nearly that name is already there: the exact one is unlikely to be on its way
          catch (e) { if (GONE.test(String(e))) { await this.pageReady(); continue; } }
          stats.repairs.push({ at: failed.i, kind: 'wait', ok: !!ok });
          if (memo.steps[failed.i]) delete memo.steps[failed.i].css;
          continue;
        }
        if (!(await this.escalate(steps, failed, stats))) return fail(failed, `${failed.status} at step ${failed.i}`);
        continue;
      }
      if (failed.status === 'verify-failed' && failed.css && tries === 1 && ['check', 'uncheck', 'radio'].includes(s.op) && s.risk !== 'irreversible') {
        // careful mode: one real, guarded mouse press on the control (the guard cancels it if anything else is under the pointer)
        stats.repairs.push({ at: failed.i, kind: 'real-click' });
        stats.roundTrips += 2;
        const already = await rt(([st]) => window.__FS.check(st), [this.prep(s, memo)]).catch(() => false);
        if (!already) {
          try {
            const a = await rt(([st]) => window.__FS.armAt(st), [this.prep(s, memo)]);
            if (a.x != null) { stats.roundTrips += 4; const pr = await this.press(target, a.x, a.y); if (pr.covered) await target.evaluate(() => window.__FS.disarm()); else await target.evaluate(([st]) => window.__FS.finishClick(st), [this.prep(s, memo)]); }
          } catch { await target.evaluate(() => window.__FS.disarm()).catch(() => {}); }
        }
        const good = await rt(([st]) => window.__FS.check(st), [this.prep(s, memo)]).catch(() => false);
        if (good) { await target.evaluate(([st]) => window.__FS.track(st), [this.prep(s, memo)]).catch(() => {}); done.add(failed.i); i = failed.i + 1; continue; }
      }
      if (failed.status === 'verify-failed' && failed.css && tries === 1 && (s.op === 'fill' || s.op === 'select') && failed.acted !== false && s.risk !== 'irreversible') {
        // careful mode: real keystrokes, then leave the field like a person would, then re-read it
        stats.repairs.push({ at: failed.i, kind: 'trusted-input' });
        stats.roundTrips += 4;
        try {
          if (s.op === 'fill') {
            await target.locator(failed.css).first().click({ timeout: 3000 });
            await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(String(s.value));
            if (!['keys', 'type'].includes(steps[failed.i + 1]?.op)) await page.keyboard.press('Tab');     // keep focus if a key press follows
          } else {
            const labels = (Array.isArray(s.value) ? s.value : [s.value]).map((l) => ({ label: String(l) }));
            await target.locator(failed.css).first().selectOption(labels, { timeout: 3000 });
          }
        } catch {}
        const good = await rt(([st]) => window.__FS.check(st), [this.prep(s, memo)]).catch(() => false);
        if (good) { await target.evaluate(([st]) => window.__FS.track(st), [this.prep(s, memo)]).catch(() => {}); done.add(failed.i); i = failed.i + 1; continue; }      // never assumed: the postcondition was re-read
      }
      if (failed.status === 'timeout' && tries === 1 && s.risk !== 'irreversible' && failed.css) {
        // A click is never repeated automatically: "slow" and "ignored" look the same from here, and a second click
        // can do the thing twice. Typing into an autocomplete again is harmless, so that one is retried with real keys.
        try {
          if (false) {
          } else if (s.op === 'pick' && failed.quick && page.__fsReq > req0) {
            // the page asked its server for suggestions: they are just slow. Keep waiting, do not type again.
            stats.repairs.push({ at: failed.i, kind: 'wait-for-suggestions' });
            s.typed = true; by.timeout = 0; continue;
          } else if (s.op === 'pick' && failed.quick) {
            stats.repairs.push({ at: failed.i, kind: 'careful-retry' });
            stats.roundTrips += 3;
            const reqT = page.__fsReq, said = await target.evaluate(() => window.__FS.bodyText()).catch(() => null);
            await target.locator(failed.css).first().click({ timeout: 3000 });
            await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(s.typeText ?? String(s.value).slice(0, 3));
            await page.waitForTimeout(150);
            // Did typing change anything? Scripted typing left the page's words as they were (`still`); did real keys, and did the page ask its server for anything?
            s.typed = true; s.inert = !!failed.still && said != null && page.__fsReq === reqT && (await target.evaluate(() => window.__FS.bodyText()).catch(() => '')) === said;
            continue;                                       // the runtime now waits for the suggestion and picks it
          }
        } catch {}
      }
      if (failed.status === 'timeout' && s.op === 'pick' && failed.plain && !s.plainTried && s.risk !== 'irreversible' && failed.css) {
        // A text box that declares no suggestions, on a page that asked its server for nothing and whose words did not
        // change when it was typed into, is a plain text box: the value is typed in and read back, exactly as "fill"
        // does, and the result says so. (If anything at all appeared, the page does answer typing and the run stops.)
        stats.repairs.push({ at: failed.i, kind: 'pick-as-fill' });
        stats.warnings.push(`step ${failed.i}: this is a plain text field with no suggestion list, so "pick" typed the value in like "fill"`);
        s.plainTried = true; s.op = 'fill'; delete s.typed; delete s.typeText; delete s.inert;
        continue;
      }
      if (!(await this.escalate(steps, failed, stats))) return fail(failed, `${failed.status} at step ${failed.i}`);
    }
    if (this._popup) { await new Promise((r) => setTimeout(r, 50)); await adoptTab(null, null); }
    if (this.useCache) this.saveCache();
    return this.finish(plan, t0, stats, true);
  }

  // Attach to a page once: native dialogs never hang (and are recorded), navigations are counted, and the
  // page can tell us which step it is executing so a vanishing page is attributed to the right step.
  async arm(page) {
    if (page.__fsArmed) return;
    page.__fsArmed = true;
    page.__fsNav = 0;
    page.on('dialog', async (d) => {
      const policy = this._dialogPolicy || (d.type() === 'alert' || d.type() === 'beforeunload' ? 'accept' : 'dismiss');
      (this._dialogs ||= []).push({ type: d.type(), message: d.message().slice(0, 200), action: policy });
      try { if (policy === 'accept') await d.accept(); else await d.dismiss(); } catch {}
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.__fsNav++; });
    page.__fsReq = 0;
    page.__fsBusy = new Set();                                 // data requests still on their way
    const over = (r) => page.__fsBusy.delete(r);
    page.on('request', (r) => { if (['xhr', 'fetch'].includes(r.resourceType())) { page.__fsReq++; page.__fsBusy.add(r); setTimeout(() => over(r), 8000); } });      // data requests only (not images, beacons, scripts)
    page.on('requestfinished', over); page.on('requestfailed', over);
    await page.exposeFunction('__fsProgress', (n) => { this._progress = n; }).catch(() => {});
  }

  // Re-read, in every frame the plan wrote into, the fields this run wrote: the step numbers whose values are no longer there.
  async auditAll(steps, done, upTo, memo, stats) {
    const frames = new Set(steps.slice(0, upTo).filter((s) => done.has(s.i) && PAGE_OPS.includes(s.op)).map((s) => s.frame ?? 0));
    const bad = [];
    for (const f of frames) {
      try {
        const tg = this.frameFor(f === 0 ? null : f); await this.ensureRuntime(tg); stats.roundTrips++;
        bad.push(...(await tg.evaluate(() => window.__FS.audit())));
      } catch {}                                            // that frame is gone: its fields were verified when they were written
    }
    return bad.filter((d) => d && Number.isInteger(d.i) && d.i < upTo && done.has(d.i)).sort((a, b) => a.i - b.i);
  }
  // A real mouse press at a point given inside `target` (the page or one of its frames). For a frame, the point is
  // walked out through every enclosing document, and at each level that document must really show the frame at that
  // point: if the page around the frame has anything over it, nothing is pressed.
  async press(target, x, y) {
    const page = this.page;
    for (let fr = target === page ? null : target; fr && fr.parentFrame(); fr = fr.parentFrame()) {
      const el = await fr.frameElement();
      const at = await el.evaluate((node, [px, py]) => {
        let r = node.getBoundingClientRect();
        if (r.left + px < 0 || r.top + py < 0 || r.left + px > innerWidth || r.top + py > innerHeight) { node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = node.getBoundingClientRect(); }
        const cs = getComputedStyle(node);
        const X = r.left + node.clientLeft + (parseFloat(cs.paddingLeft) || 0) + px, Y = r.top + node.clientTop + (parseFloat(cs.paddingTop) || 0) + py;
        let h = document.elementFromPoint(X, Y);
        while (h && h.shadowRoot) { const inner = h.shadowRoot.elementFromPoint(X, Y); if (!inner || inner === h) break; h = inner; }
        return { x: X, y: Y, ok: h === node, over: h && h !== node ? { tag: h.tagName.toLowerCase(), id: h.id || undefined, text: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) } : { tag: 'nothing' } };
      }, [x, y]);
      if (!at.ok) return { covered: at.over };
      x = at.x; y = at.y;
    }
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
    return {};
  }

  // One real-input step. Returns null on success or a failure record.
  async nodeStep(step, target, stats, memo) {
    const page = this.page, rec = { i: step.i, op: step.op };
    let acted = false;                                        // has anything been sent to the page yet?
    try {
      stats.roundTrips++;
      const nav0 = page.__fsNav;
      const need = this.thresholdFor(step);
      const acts = !['expect', 'read', 'scroll', 'hover'].includes(step.op);
      if (step.risk === 'irreversible' && step.expect && acts) {
        const pre = await target.evaluate((e) => window.__FS.expectNow(e), step.expect).catch(() => false);
        if (pre) return { ...rec, status: 'bad-expect', why: 'the "expect" of this irreversible step is already true before the step, so it could never confirm that the step worked: expect something that only appears afterwards', expect: step.expect, acted: false };
      }
      if (step.op === 'keys' || step.op === 'type') {         // real keys go wherever the focus is: never into a pop-up the plan knows nothing about
        const safe = await target.evaluate(() => window.__FS.keysSafe()).catch(() => ({ ok: true }));
        if (!safe.ok) return { ...rec, status: 'interrupt', why: safe.why, dialog: safe.dialog, acted: false };
      }
      if (step.op === 'keys') {
        if (/(^|\+)(Numpad)?Enter$/i.test(String(step.value)) || step.risk === 'irreversible') {      // Enter commits: re-read what was written first
          const d = await target.evaluate(() => window.__FS.drifted()).catch(() => []);
          if (d.length) return { ...rec, status: 'verify-failed', why: 'a field no longer holds the value that was entered (the page changed it); the key was not pressed', fields: d, acted: false };
        }
        acted = true;
        await target.evaluate(() => window.__FS.pressing()).catch(() => {});     // what opens now is the answer to this key
        await page.keyboard.press(String(step.value)); await this.settle(nav0);
        await target.evaluate(() => window.__FS.acted('keys')).catch(() => {});  // the key press may have used up what was typed in the focused field (a to-do box empties itself)
        if (page.__fsNav === nav0) {
          const d = await target.evaluate(() => window.__FS.drifted()).catch(() => []);
          // emptied = the page used it (a to-do box, a chat box): normal. Rewritten to something else = worth knowing.
          for (const f of d) if (f.now !== '') stats.warnings.push(`step ${f.i}: after the key press the field holds ${JSON.stringify(f.now)}, not ${JSON.stringify(f.wanted)}`);
        }
      }
      else if (step.op === 'type') {
        const f = await target.evaluate(() => window.__FS.focusInfo()).catch(() => ({ editable: true }));
        if (!f.editable) return { ...rec, status: 'nofocus', why: 'nothing editable has focus, so the text would go nowhere (click or fill the field first)', acted: false };
        if (/[\n\r]/.test(String(step.value))) {              // a line break can send a form just as Enter does
          const d = await target.evaluate(() => window.__FS.drifted()).catch(() => []);
          if (d.length) return { ...rec, status: 'verify-failed', why: 'a field no longer holds the value that was entered (the page changed it); nothing was typed', fields: d, acted: false };
        }
        acted = true;
        // text with line breaks: each break is an Enter, and Enter can send a form, so what was written is re-read before each
        const parts = String(step.value).split(/\r?\n|\r/);
        for (let k = 0; k < parts.length; k++) {
          if (parts[k]) await page.keyboard.type(parts[k]);
          if (k === parts.length - 1) break;
          const d = await target.evaluate(() => window.__FS.drifted()).catch(() => []);
          if (d.length) return { ...rec, status: 'verify-failed', why: 'a field no longer holds the value that was entered (the page changed it); the line break was not typed', fields: d, acted: true };
          await target.evaluate(() => window.__FS.pressing()).catch(() => {});
          await page.keyboard.press('Enter'); await this.settle(nav0);
          await target.evaluate(() => window.__FS.acted('keys')).catch(() => {});
        }
      }
      else if (step.op === 'goto') { acted = true; await page.goto(String(step.value), { waitUntil: 'domcontentloaded', timeout: 45000 }); await this.pageReady(); }
      else if (step.op === 'expect') { /* nothing to do: the expectation below is the whole step */ }
      else if (step.op === 'read') {
        // read what the page shows once it has settled: data it has asked its server for has arrived, and it has stopped redrawing
        await page.waitForTimeout(40);
        for (const end = Date.now() + 4000; page.__fsBusy?.size && Date.now() < end;) await page.waitForTimeout(40);
        await target.evaluate(() => window.__FS.quiet(150, 900)).catch(() => {});
        let found = await target.evaluate((t) => window.__FS.read(t), step.value);
        for (const end = Date.now() + 1500; !found.length && Date.now() < end;) { await page.waitForTimeout(150); found = await target.evaluate((t) => window.__FS.read(t), step.value).catch(() => []); }
        stats.reads.push({ step: step.i, read: step.value, found });
        if (!found.length) stats.warnings.push(`step ${step.i}: nothing on the page matches what was to be read`);
        else if (step.value && step.value.row != null && found.length > 1) stats.warnings.push(`step ${step.i}: ${found.length} cells match that row and column (more than one table or row has them)`);
      }
      else if (step.op === 'scroll') {
        const vp = page.viewportSize() || (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
        const once = async () => {
          const before = await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight].join(','));
          if (step.value === 'top' || step.value === 'bottom') await target.evaluate((d) => window.__FS.scrollPage(d), step.value);
          await page.mouse.move(vp.width / 2, vp.height / 2);
          await page.mouse.wheel(0, step.value === 'up' || step.value === 'top' ? -Math.round(vp.height * 0.85) : Math.round(vp.height * 0.85));
          await page.waitForTimeout(220);
          return before !== (await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight].join(',')));
        };
        if (!step.expect) {
          if (!(await once())) stats.warnings.push(`step ${step.i}: the page did not move (it is already at the ${step.value === 'up' || step.value === 'top' ? 'top' : 'end'})`);
        } else {                                              // keep going until the expectation comes true: lists that load as you scroll
          let met = await target.evaluate((e) => window.__FS.expectNow(e), step.expect), stale = 0;
          for (let k = 0; k < 80 && !met && stale < 8; k++) {
            stats.roundTrips += 3;
            stale = (await once()) ? 0 : stale + 1;
            met = await target.evaluate((e) => window.__FS.expectNow(e), step.expect);
          }
          return met ? null : { ...rec, status: 'timeout', why: 'scrolled as far as the page goes without the expectation coming true', expect: step.expect, acted: true, reacted: true };
        }
      }
      else if (step.op === 'clickAt') {
        let { x, y } = step.value;
        if (step.value.css) {
          const b = await target.evaluate((c) => window.__FS.boxOf(c), step.value.css);
          if (!b) return { ...rec, status: 'notfound', why: `nothing matches ${step.value.css}` };
          if (x < 0 || y < 0 || x > b.w || y > b.h) return { ...rec, status: 'error', why: `the point (${x}, ${y}) is outside the element, which is ${Math.round(b.w)} x ${Math.round(b.h)}` };
          x += b.x; y += b.y;
        }
        acted = true;
        await target.evaluate(() => window.__FS.pressing()).catch(() => {});
        await page.mouse.click(x, y);
        await this.settle(nav0);
        await target.evaluate(() => window.__FS.acted()).catch(() => {});
        if (!step.expect) stats.warnings.push(`step ${step.i}: clicked at a position; without an "expect" nothing confirms it hit the right thing`);
      }
      else if (step.op === 'upload') {
        const missing = step.file.filter((f) => !fs.existsSync(f));
        if (missing.length) return { ...rec, status: 'nofile', why: `file not found: ${missing.join(', ')}` };
        const loc = await target.evaluate(([st]) => window.__FS.locateFile(st), [step]);
        if (!loc.found) return { ...rec, status: 'notfound', why: loc.why || (loc.count === 0 ? 'this page has no file-upload field' : 'no upload field matches that name'), closest: loc.closest };
        if (loc.p < need) return { ...rec, status: 'lowconf', p: +loc.p.toFixed(3), why: loc.why, closest: loc.closest };
        if (step.file.length > 1 && !loc.multiple) return { ...rec, status: 'error', why: 'this upload field accepts one file only', acted: false };
        if (loc.picked) stats.notes.push(`step ${step.i}: ${loc.picked}`);
        const wanted = step.file.map((f) => path.basename(f));
        await target.evaluate(([c, n]) => window.__FS.markUpload(c, n), [loc.css, wanted]);
        acted = true;
        await target.locator(loc.css).first().setInputFiles(step.file, { timeout: 5000 });
        // the input holds the file, or the page swapped the input for the file's name / a remove button (it may take a moment to)
        let proof = { ok: false };
        for (const end = Date.now() + 4000; ;) {
          proof = await target.evaluate(() => window.__FS.uploadProof()).catch(() => ({ ok: false }));
          if (proof.ok || Date.now() > end) break;
          await page.waitForTimeout(150);
        }
        if (!proof.ok) return { ...rec, status: 'verify-failed', why: proof.gone ? 'the upload field is gone and the page does not show the file\'s name: look at the page' : 'the upload field does not hold the file and the page does not show it as attached', got: proof.held ?? null, appeared: proof.appeared?.length ? proof.appeared : undefined, acted: true };
        if (proof.note) stats.notes.push(`step ${step.i}: ${proof.note}`);
      }
      else if (step.op === 'drag') {
        const find = async (tg) => target.evaluate(([st]) => window.__FS.locate(st), [this.prep({ ...step, op: 'click', target: tg }, memo)]);
        const src = await find(step.target), dst = await find(step.to);
        if (!src.found) return { ...rec, status: 'notfound', why: 'nothing matches what should be dragged', closest: src.closest };
        if (!dst.found) return { ...rec, status: 'notfound', why: 'nothing matches where it should be dropped', closest: dst.closest };
        if (src.p < need || dst.p < need) return { ...rec, status: 'lowconf', p: +Math.min(src.p, dst.p).toFixed(3), closest: (src.p < need ? src : dst).closest };
        if (!src.reach || !dst.reach) return { ...rec, status: 'blocked', why: `something covers ${!src.reach ? 'what should be dragged' : 'the place to drop it'}`, blocker: (!src.reach ? src : dst).blocker, acted: false };
        const a = await target.locator(src.hoverCss).first().boundingBox(), b = await target.locator(dst.hoverCss).first().boundingBox();
        if (!a || !b) return { ...rec, status: 'hidden', why: 'the drag source or the drop target is not on screen' };
        acted = true;
        const [sx, sy, dx, dy] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2];
        // a real press-move-release with in-between moves: both native drag-and-drop and pointer-driven sorting need them
        await page.mouse.move(sx, sy); await page.mouse.down();
        await page.mouse.move(sx + 6, sy + 6, { steps: 3 }); await page.mouse.move(dx, dy, { steps: 14 }); await page.mouse.move(dx, dy);
        await page.waitForTimeout(60); await page.mouse.up();
        await this.settle(nav0);
        await target.evaluate(() => window.__FS.acted()).catch(() => {});
        if (!step.expect) stats.warnings.push(`step ${step.i}: dragged; without an "expect" nothing confirms where it landed`);
      }
      else {                                                  // hover / dblclick: real mouse on a located target
        const loc = await target.evaluate(([s]) => window.__FS.locate(s), [this.prep({ ...step, op: 'click' }, memo)]);
        if (!loc.found) return { ...rec, status: 'notfound', closest: loc.closest };
        if (loc.p < need) return { ...rec, status: 'lowconf', p: +loc.p.toFixed(3), closest: loc.closest };
        if (loc.picked) stats.notes.push(`step ${step.i}: ${loc.picked}`);
        if (step.op === 'hover') { acted = true; await target.locator(loc.hoverCss).first().hover({ timeout: 2500 }); }
        else {
          if (loc.disabled) return { ...rec, status: 'disabled', why: 'the control is disabled' };
          if (loc.hidden) await target.locator(loc.hoverCss).first().hover({ timeout: 2500 }).catch(() => {});
          acted = true;
          await target.evaluate(() => window.__FS.pressing()).catch(() => {});
          if (step.op === 'rightclick') await target.locator(loc.css).first().click({ button: 'right', timeout: 3000 });
          else await target.locator(loc.css).first().dblclick({ timeout: 3000 });
          await this.settle(nav0);
          await target.evaluate(() => window.__FS.acted()).catch(() => {});
        }
      }
      if (step.expect && !(await this.expectMet(step.expect, stats, step))) return { ...rec, status: 'timeout', why: 'expectation not met', expect: step.expect, acted };
      return null;
    } catch (e) { return { ...rec, status: 'error', why: String(e.message).split('\n')[0], acted: acted ? 'unknown' : false }; }
  }

  // A document has (or may have) just loaded: wait for it, re-arm the runtime, and let the page's own scripts
  // finish wiring up, so the first action is not lost on handlers that are bound a beat after load.
  async pageReady() {
    for (let k = 0; k < 3; k++) {
      try {
        await this.page.waitForLoadState('domcontentloaded');
        await this.ensureRuntime();
        await this.page.evaluate((pressed) => { window.__FS.carry(pressed); return window.__FS.ready(); }, !!this._pressed);
        return;
      } catch (e) { if (!GONE.test(String(e))) return; }
    }
  }
  // After a real key press / click: if it started a navigation, wait for the new page; otherwise move on quickly.
  async settle(nav0 = this.page.__fsNav) {
    const page = this.page;
    await page.waitForTimeout(60);
    if (page.__fsNav === nav0) {
      let leaving = false;                                    // the old page says it is on its way out, or is already unreachable
      try { leaving = await page.evaluate(() => !window.__FS || window.__FS.leaving()); } catch { leaving = true; }
      if (leaving) { const end = Date.now() + 8000; while (page.__fsNav === nav0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); }
    }
    if (page.__fsNav > nav0) await this.pageReady(); else await this.ensureRuntime().catch(() => this.pageReady());
  }
  async expectMet(expect, stats, step) {
    for (let k = 0; k < 3; k++) {
      try {
        stats.roundTrips++;
        const target = this.frameFor(step?.frame);
        await this.ensureRuntime(target);
        return await target.evaluate((e) => window.__FS.expect(e), expect);
      } catch { await this.page.waitForLoadState('domcontentloaded').catch(() => {}); }   // page changed under us: look again
    }
    return false;
  }
  async escalate(steps, failed, stats) {
    if (!this.onEscalate) return false;
    if (steps[failed.i].risk === 'irreversible' && failed.acted) return false;     // it may already have happened: never re-dispatch
    stats.modelCalls++;
    // what is handed to the planner shows any dialog that is open: from here on it has seen it
    try { await this.frameFor(steps[failed.i].frame).evaluate(() => window.__FS.seen()); } catch {}
    const repl = await this.onEscalate({ step: steps[failed.i], failed, page: this.page });
    if (!repl) return false;
    // `first`: steps the planner wants done before the stuck step is tried again (the answer to a dialog, say)
    const { first, ...rest } = repl;
    for (const raw of first || []) if (!(await this.sideStep(raw, steps[failed.i].frame, stats))) return false;
    Object.assign(steps[failed.i], rest, { triesBy: {} });
    return true;
  }
  // One extra step, run with all the usual checks. True if it went through.
  async sideStep(raw, frame, stats) {
    try {
      const st = this.normalize({ steps: [raw] })[0]; st.i = -1; st.frame = frame;
      const target = this.frameFor(frame); await this.ensureRuntime(target);
      if (NODE_OPS.includes(st.op)) return !(await this.nodeStep(st, target, stats, { steps: {} }));
      const ready = { ...this.prep(st, { steps: {} }), stay: false };
      stats.roundTrips++;
      const rec = (await target.evaluate(([c]) => window.__FS.runWindow(c), [[ready]])).steps[0];
      if (rec?.status !== 'armed') return rec?.status === 'ok';
      stats.roundTrips += 4;
      const pr = await this.press(target, rec.x, rec.y);
      if (pr.covered) { await target.evaluate(() => window.__FS.disarm()).catch(() => {}); return false; }
      const fin = await target.evaluate(([c]) => window.__FS.finishClick(c), [ready]).catch((e) => (GONE.test(String(e)) ? { status: 'ok' } : { status: 'error' }));
      if (fin.status === 'ok') this._pressed = true;
      return fin.status === 'ok';
    } catch { return false; }
  }

  finish(plan, t0, stats, ok, reason) {
    try { this._cleanup?.(); } catch {}
    stats.dialogs = this._dialogs || [];
    return { plan: plan?.id, ok, reason, failedAt: ok ? undefined : this._fail?.i, failed: ok ? undefined : this._fail, ms: +(performance.now() - t0).toFixed(1), ...stats, windowCount: stats.windows.length };
  }
}
