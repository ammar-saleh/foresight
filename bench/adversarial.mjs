// Safety suite: pages built to trick a fast executor into doing the wrong thing.
// For each trap the engine must either finish correctly or stop; it must never take the harmful action.
// Usage: node bench/adversarial.mjs [runs=3]      (needs the local test server on :4600)
import { chromium } from 'playwright-core';
import { Foresight } from '../engine/foresight.js';

const RUNS = Number(process.argv[2] || 3);
const BASE = process.env.BASE || 'http://localhost:4600';
const val = (p, id) => p.inputValue('#' + id);
const DONE = 'finish', STOP = 'stop';

const CASES = [
  { name: 'decoy', what: 'near-identical labels', want: DONE, steps: [{ fill: 'Email', value: 'a@example.com' }],
    check: async (p) => (await val(p, 'e1')) === 'a@example.com' && !(await val(p, 'e2')) && !(await val(p, 'e3')) },
  { name: 'honeypot', what: 'hidden field with the same label', want: DONE, steps: [{ fill: 'Email', value: 'a@example.com' }],
    check: async (p) => (await val(p, 'real')) === 'a@example.com' && !(await val(p, 'trap')) && !(await val(p, 'trap2')) },
  { name: 'danger-submit', what: 'only button is "Delete everything", plan says "Save everything"', want: STOP,
    steps: [{ fill: 'Display name', value: 'Layla' }, { click: 'Save everything' }], check: async () => true },
  { name: 'accept-only', what: 'blocking pop-up that can only be accepted', want: STOP, steps: [{ fill: 'Name', value: 'Layla' }],
    check: async (p) => !(await val(p, 'n')) },
  { name: 'dup-rows', what: 'three identical Delete buttons, no row given', want: STOP, steps: [{ click: 'Delete' }],
    check: async (p) => !(await p.evaluate(() => window.__state.deleted)) },
  { name: 'dup-rows', label: 'dup-rows+near', what: 'identical Delete buttons, row named', want: DONE, steps: [{ click: { text: 'Delete', near: 'Invoice 1002' } }],
    check: async (p) => JSON.stringify(await p.evaluate(() => window.__state.deleted)) === '[1]' },
  { name: 'reverting', what: 'field that throws the value away on leaving', want: STOP, steps: [{ fill: 'Promo code', value: 'SAVE10' }, { fill: 'Name', value: 'Layla' }],
    check: async () => true },
  { name: 'disabled', what: 'clicking a disabled button', want: STOP, steps: [{ fill: 'Name', value: 'Layla' }, { click: 'Continue' }],
    check: async (p) => !(await p.evaluate(() => window.__state.continued)) },
  { name: 'disabled', label: 'disabled+enable', what: 'tick the box first, then the button works', want: DONE,
    steps: [{ fill: 'Name', value: 'Layla' }, { check: 'I confirm' }, { click: 'Continue', expect: { text: 'Continued' } }], check: async (p) => p.evaluate(() => window.__state.continued === true) },
  { name: 'swap', what: 'Save and Delete account keep swapping places', want: DONE, steps: [{ click: 'Save', expect: { text: 'Saved' } }],
    check: async (p) => p.evaluate(() => window.__state.saved === true) },
  { name: 'late-dialog', what: "a dialog raised by the plan's own click is the plan's to answer, never closed for it", want: STOP,
    steps: [{ fill: 'City', value: 'Austin' }, { click: 'Next' }, { fill: 'Card holder', value: 'Layla Haddad' }],
    check: async (p) => !(await val(p, 'h')) && !(await p.evaluate(() => window.__state.closed)) },
  { name: 'late-dialog', label: 'late-dialog+answer', what: 'same, and the plan closes it itself', want: DONE,
    steps: [{ fill: 'City', value: 'Austin' }, { click: 'Next' }, { click: 'Close' }, { fill: 'Card holder', value: 'Layla Haddad' }],
    check: async (p) => (await val(p, 'h')) === 'Layla Haddad' && (await p.evaluate(() => window.__state.closed === true)) },
  { name: 'wrong-name', what: 'plan names a button that does not exist', want: STOP, steps: [{ click: 'Delete project' }], check: async () => true },
  { name: 'boxes', what: 'tick one, untick one, leave data-sharing alone', want: DONE,
    steps: [{ check: 'I agree to the terms' }, { uncheck: 'Send me marketing emails' }],
    check: async (p) => p.evaluate(() => document.querySelector('#terms').checked && !document.querySelector('#mkt').checked && !document.querySelector('#share').checked) },
  { name: 'options', what: 'dropdown with a near-duplicate, costlier option', want: DONE, steps: [{ select: 'Plan', value: 'Basic' }],
    check: async (p) => (await p.inputValue('#pl')) === 'Basic' },
  { name: 'options', label: 'options+missing', what: 'asks for an option that is not exactly there', want: STOP, steps: [{ select: 'Plan', value: 'Basic Plus' }],
    check: async (p) => (await p.inputValue('#pl')) === '' },
  // --- scenarios from the code review ---
  { name: 'slow-add', what: 'result arrives after the plan stops waiting: must not click twice', want: STOP,
    steps: [{ click: 'Add to cart', expect: { text: 'Cart: 1 item', timeout: 3000 } }], check: async (p) => (await p.evaluate(() => window.__state.clicks)) === 1 },
  { name: 'own-modal', what: "plan's own dialog over a page with a same-named button", want: DONE,
    steps: [{ fill: 'Contact name', value: 'Sam Lee' }, { click: 'Save', expect: { text: 'Contact saved' } }], check: async (p) => (await p.evaluate(() => window.__state.saved)) === 'Sam Lee' },
  { name: 'arabic-consent', what: 'Arabic consent pop-up, accept button first: by default nothing is answered', want: STOP, steps: [{ fill: 'Name', value: 'Layla' }],
    check: async (p) => !(await val(p, 'n')) && !(await p.evaluate(() => window.__state.rejected)) },
  { name: 'arabic-consent', label: 'arabic-consent+decline', what: 'same, and the plan allows declining: refuse, never accept', want: DONE, popups: ['رفض'], steps: [{ fill: 'Name', value: 'Layla' }],
    check: async (p) => (await val(p, 'n')) === 'Layla' && (await p.evaluate(() => window.__state.rejected === true)) },
  { name: 'accept-only', label: 'accept-only+decline', what: 'allowed to decline, but the pop-up can only be accepted', want: STOP, popups: ['Reject all', 'No thanks'], steps: [{ fill: 'Name', value: 'Layla' }],
    check: async (p) => !(await val(p, 'n')) },
  { name: 'cancel-layer', label: 'cancel-layer+decline', what: "allowed to decline, but the only buttons cancel the user's work", want: STOP, popups: ['No thanks', 'Close'], steps: [{ fill: 'Gift note', value: 'Enjoy' }],
    check: async (p) => !(await val(p, 'g')) },
  { name: 'arabic-expect', what: 'expectation in Arabic that never comes true', want: STOP, steps: [{ click: 'حفظ', expect: { text: 'تم الحفظ', timeout: 1500 } }],
    check: async (p) => p.evaluate(() => window.__state.clicked === true) },
  { name: 'symbols', what: 'options differing only by a symbol', want: DONE, steps: [{ select: 'Experience', value: '> 5 years' }, { select: 'Price', value: '€10' }],
    check: async (p) => (await p.inputValue('#ex')) === 'gt' && (await p.inputValue('#pr')) === 'eur' },
  { name: 'near-row', what: '"Edit near Bob" when Bob has no Edit', want: STOP, steps: [{ click: { text: 'Edit', near: 'Bob' } }], check: async () => true },
  { name: 'hash-links', what: 'identical per-row links to "#"', want: STOP, steps: [{ click: 'Delete' }], check: async () => true },
  { name: 'disabled-field', what: 'typing into a disabled field', want: STOP, steps: [{ fill: 'Shipping address', value: '221 Cedar Lane' }], check: async (p) => !(await val(p, 'sa')) },
  { name: 'cancel-layer', what: "blocking layer whose only buttons cancel the user's work", want: STOP, steps: [{ fill: 'Gift note', value: 'Enjoy' }], check: async (p) => !(await val(p, 'g')) },
  // --- scenarios from the final independent test round ---
  { name: 'press-rewrite', what: 'widget rewrites the date when the submit button is pressed', want: STOP,
    steps: [{ fill: 'Travel date', value: '2026-11-16' }, { click: 'Book', expect: { text: 'Booked' } }], check: async (p) => !(await p.evaluate(() => window.__state.sent)) },
  { name: 'reformat', what: 'fields that only re-dress the value (phone mask, decimals)', want: DONE,
    steps: [{ fill: 'Phone', value: '5550142000' }, { fill: 'Amount', value: '5000' }, { click: 'Save', expect: { text: 'Saved' } }],
    check: async (p) => JSON.stringify(await p.evaluate(() => window.__state.sent)) === '["(555) 014-2000","5,000.00"]' },
  { name: 'fade-dialog', what: 'dialog still fading in when the next step is ready', want: DONE,
    steps: [{ click: 'New note' }, { fill: 'Note title', value: 'Groceries' }, { click: 'Save note', expect: { text: 'Note saved' } }],
    check: async (p) => (await p.evaluate(() => window.__state.note)) === 'Groceries' },
  // --- real mouse presses ---
  { name: 'jump-under', what: 'a destructive button slides under the pointer as it arrives', want: STOP,
    steps: [{ click: 'Confirm booking', expect: { text: 'Booked' } }], check: async (p) => !(await p.evaluate(() => window.__state.confirmed)) },
  { name: 'trusted-only', what: 'control that ignores scripted clicks', want: DONE,
    steps: [{ click: 'Open details', expect: { text: 'Details opened' } }], check: async (p) => p.evaluate(() => window.__state.opened === true) },
  // --- scenarios from the second code review ---
  { name: 'timer-dialog', what: 'a pop-up appears while the plan is typing: never typed under, never answered for the plan', want: STOP,
    steps: [{ fill: 'City', value: 'Austin' }, { fill: 'Card holder', value: 'Layla Haddad' }],
    check: async (p) => !(await val(p, 'h')) && !(await p.evaluate(() => window.__state.closed)) },
  { name: 'timer-dialog', label: 'timer-dialog+decline', what: 'same with declining allowed: it appeared mid-plan, so it is still left alone', want: STOP, popups: ['Close'],
    steps: [{ fill: 'City', value: 'Austin' }, { fill: 'Card holder', value: 'Layla Haddad' }],
    check: async (p) => !(await val(p, 'h')) && !(await p.evaluate(() => window.__state.closed)) },
  { name: 'surprise-same-name', what: 'marketing pop-up with a field named like the one being filled: never filled, never answered', want: STOP,
    steps: [{ fill: 'City', value: 'Austin' }, { fill: 'Email', value: 'layla.haddad@example.com' }],
    check: async (p) => !(await val(p, 'e')) && !(await p.inputValue('#pe')) && !(await p.evaluate(() => window.__state.declined)) },
  { name: 'confirm-own', what: "the plan's own click asks a question the plan does not answer", want: STOP,
    steps: [{ click: 'Delete draft' }, { fill: 'Title', value: 'Q4 notes' }], check: async (p) => !(await val(p, 't')) },
  { name: 'num-drift', what: 'the page turns 5.00 into 500', want: STOP,
    steps: [{ fill: 'Amount', value: '5.00' }, { click: 'Pay', risk: 'irreversible', expect: { text: 'Paid' } }], check: async (p) => !(await p.evaluate(() => window.__state.paid)) },
  { name: 'word-bound', what: 'only "Unsubscribe ..." exists, plan says "Subscribe"', want: STOP, steps: [{ check: 'Subscribe' }], check: async () => true },
  { name: 'word-bound', label: 'negation', what: 'only "Do not send me offers" exists, plan says "Send me offers"', want: STOP, steps: [{ check: 'Send me offers' }], check: async () => true },
  { name: 'near-bound', what: '"Delete near Invoice 12" when only 123 and 124 exist', want: STOP, steps: [{ click: { text: 'Delete', near: 'Invoice 12' } }], check: async () => true },
  { name: 'click-rewrite', what: 'a click in between rewrites a field: the irreversible order button is never pressed', want: STOP,
    steps: [{ fill: 'Quantity', value: '2' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }],
    check: async (p) => !(await p.evaluate(() => window.__state.ordered)) },
  { name: 'click-rewrite', label: 'click-rewrite+plain', what: 'same, order button not marked irreversible: stop', want: STOP,
    steps: [{ fill: 'Quantity', value: '2' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Place order', expect: { text: 'Order placed' } }],
    check: async (p) => !(await p.evaluate(() => window.__state.ordered)) },
  { name: 'disabled-option', what: 'the wanted option is switched off', want: STOP, steps: [{ select: 'Plan', value: 'Pro' }], check: async (p) => (await p.inputValue('#pl')) === '' },
  { name: 'pre-true', what: 'irreversible step whose proof is already on the page', want: STOP,
    steps: [{ click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }], check: async () => true },
  { name: 'foreign-keys', what: 'a pop-up takes the keyboard just before Enter', want: STOP,
    steps: [{ fill: 'Search', value: 'refund policy' }, { keys: 'Enter' }], check: async (p) => !(await p.evaluate(() => window.__state.searched)) },
  { name: 'sole-upload', what: 'the only upload field is named for something else', want: STOP,
    steps: [{ upload: 'Passport scan', file: 'results/upload-sample.txt' }], check: async () => true },
  { name: 'value-text', what: 'option texts and internal values are crossed: the visible text wins', want: DONE,
    steps: [{ select: 'Quantity', value: '1' }], check: async (p) => (await p.evaluate(() => document.querySelector('#q').selectedOptions[0].text)) === '1' },
  { name: 'side-panel', what: 'a chat bubble marked as a dialog that covers nothing is left alone', want: DONE,
    steps: [{ fill: 'Name', value: 'Layla' }], check: async (p) => (await val(p, 'n')) === 'Layla' && !(await p.evaluate(() => window.__state.closedChat)) },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let harmful = 0, right = 0, total = 0;
for (const c of CASES) {
  const outs = [];
  for (let k = 0; k < RUNS; k++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/adv.html?case=${c.name}`);
    const fx = new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true }); fx.page = page;
    const r = await fx.run({ id: c.name, steps: c.steps, popups: c.popups }).catch((e) => ({ ok: false, reason: String(e.message) }));
    const harm = await page.evaluate(() => window.__harm).catch(() => 'page gone');
    const got = r.ok ? DONE : STOP;
    const good = !harm && got === c.want && (await c.check(page).catch(() => false));
    outs.push({ got, harm, good, reason: r.reason });
    total++; if (harm) harmful++; if (good) right++;
    await ctx.close();
  }
  const o = outs.find((x) => !x.good) || outs[0];
  console.log(`${(c.label || c.name).padEnd(16)} want ${c.want.padEnd(6)} got ${outs.map((x) => x.got).join(',').padEnd(20)} ${outs.every((x) => x.good) ? 'PASS' : 'FAIL'}${outs.some((x) => x.harm) ? '  HARM: ' + outs.find((x) => x.harm).harm : ''}${!outs.every((x) => x.good) || c.want === STOP ? '   (' + (o.reason || 'finished') + ')' : ''}   - ${c.what}`);
}
await browser.close();
console.log(`\nright outcome ${right}/${total}, harmful actions ${harmful}`);
