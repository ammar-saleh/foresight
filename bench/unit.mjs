// The small rules everything else leans on: how alike two names are, whether a text mentions some words,
// and whether a field still holds "the same value". Each line is a case that once went wrong or easily could.
import { chromium } from 'playwright-core';
import { RUNTIME_SRC } from '../engine/foresight.js';

const SIM = [   // [a, b, 'match' | 'no']   match = the same control (>= 0.93); anything else is only a hint for "closest"
  ['Email', 'email', 'match'], ['Time zone', 'Timezone', 'match'], ['E-mail', 'Email', 'match'], ['First name:', 'First name', 'match'], ['Résumé', 'Resume', 'no'], ['drucken', 'drücken', 'no'], ['≥ 5 years', '≤ 5 years', 'no'], ['5 °C', '−5 °C', 'no'],
  ['City council approves the new riverside cycling path after two years of debate', 'City council approves the new riverside cycling path', 'match'],
  ['Email', 'Email address', 'no'], ['Save', 'Save changes', 'no'], ['Display name', 'Public display name', 'no'], ['Phone', 'Phone no.', 'no'], ['Submit', 'Submit and pay now', 'no'],
  ['Subscribe', 'Unsubscribe', 'no'], ['Invoice 12', 'Invoice 123', 'no'], ['SKU-104', 'SKU-1040', 'no'], ['Send me offers', 'Do not send me offers', 'no'],
  ['Save', "Don't save", 'no'], ['Notify me', 'Never notify me', 'no'], ['> 5 years', '< 5 years', 'no'], ['Delete', 'Delete everything', 'no'], ['Marketing emails', 'Opt out of marketing emails', 'no'],
  ['Level 1', 'Level -1', 'no'], ['5', '-5', 'no'], ['5', '+5', 'no'], ['حفظ', 'حفظ', 'match'], ['حفظ', 'حذف', 'no'], ['保存', '削除', 'no'], ['Save everything', 'Delete everything', 'no'],
  ['เสื้อ', 'เสื่อ', 'no'], ['काल', 'कल', 'no'], ['مَرحبا', 'مرحبا', 'match'],
];
const HAS = [   // [text, words, expected]
  ['Cart: 1 item', 'Cart: 1 item', true], ['Cart: 11 items', '1 item', false], ['Cart: 1 items', 'Cart: 1', true], ['Total: 12.50', 'Total: 12', false],
  ['Invoice 123 paid', 'Invoice 12', false], ['Invoice 12, paid', 'Invoice 12', true], ['Row SKU-1040', 'SKU-104', false], ['Unsubscribed', 'Subscribed', false],
  ['Order saved.', 'saved', true], ['Bobby Tables', 'Bob', false], ['تم الحفظ بنجاح', 'تم الحفظ', true], ['データを保存しました。', '保存しました', true], ['Thanks, Layla!', 'layla', true], ['فاتورة سامية', 'سامي', false], ['فاتورة سامي', 'سامي', true],
];
const EQ = [    // [typed, shown, expected]
  ['5550142000', '(555) 014-2000', true], ['5000', '5,000.00', true], ['5.00', '500', false], ['-20', '20', false], ['20', '20.0', true],
  ['v1.5', 'v15', false], [' Layla  Haddad', 'layla haddad', true], ['2026-11-16', '11/16/2026', false], ['12.50', '12,50', false], ['AB-12', 'ab12', false], ['john.doe@example.com', 'johndoe@examplecom', false], ['1.000', '1', false], ['Layla', 'LAYLA', true], ['1,5', '15', false],
  ['5550142000', '555.014.2000', true], ['1234567', '12,345.67', false], ['1234567', '1,234,567', true], ['5', '5.', true], ['007', '7', false], ['00501', '501', false], ['0.50', '0.5', true], ['00501', '00501', true], ['', '', true], ['abc', 'abd', false],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<p>unit</p>');
await page.evaluate(RUNTIME_SRC);
const got = await page.evaluate(([S, H, E]) => ({
  sim: S.map(([a, b]) => window.__FS.unit.sim(a, b)), has: H.map(([t, w]) => window.__FS.unit.has(t, w)), eq: E.map(([a, b]) => window.__FS.unit.looseEq(a, b)),
}), [SIM, HAS, EQ]);
await browser.close();
let fails = 0;
const say = (ok, line) => { if (!ok) { fails++; console.log('FAIL  ' + line); } };
SIM.forEach(([a, b, want], i) => { const v = got.sim[i]; say(want === 'match' ? v >= 0.93 : v < 0.925, `sim(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${v.toFixed(2)}, wanted ${want}`); });
HAS.forEach(([t, w, want], i) => say(got.has[i] === want, `has(${JSON.stringify(t)}, ${JSON.stringify(w)}) = ${got.has[i]}, wanted ${want}`));
EQ.forEach(([a, b, want], i) => say(got.eq[i] === want, `looseEq(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${got.eq[i]}, wanted ${want}`));
console.log(fails ? `\n${fails} rule check(s) failed` : `all ${SIM.length + HAS.length + EQ.length} rule checks passed`);
process.exit(fails ? 1 : 0);
