const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'thai-tone': {
    what: 'Thai: plan says "เสื้อ" (shirt); the only button is "เสื่อ" (mat) - they differ by a tone mark',
    html: `${L}<button onclick="log('clicked: ' + this.textContent)">เสื่อ</button>`,
    steps: [{ click: 'เสื้อ' }],
  },
  'hindi-vowel': {
    what: 'Hindi: plan says "काल"; the only button is "कल" (differs by a vowel sign)',
    html: `${L}<button onclick="log('clicked: ' + this.textContent)">कल</button>`,
    steps: [{ click: 'काल' }],
  },
  'arabic-near': {
    what: 'Arabic near text matched inside a longer word (no word edges outside Latin/Cyrillic/Greek)',
    html: `${L}<ul><li><span>فاتورة سامية</span> <button onclick="log('deleted the invoice of Samia')">حذف</button></li></ul>`,
    steps: [{ click: { text: 'حذف', near: 'سامي' } }],
  },
  'german-decline': {
    what: 'consent wall in Swedish: accept / reject not in the word list',
    html: `${L}<label>Namn <input id="n"></label><div role="dialog" aria-modal="true" style="position:fixed; inset:10%; background:#eee">Vi använder kakor. <button onclick="log('accepted')">Godkänn alla</button> <button onclick="log('rejected'); this.parentNode.remove()">Avvisa alla</button></div>`,
    steps: [{ fill: 'Namn', value: 'Layla' }],
  },
};
