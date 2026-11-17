const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'down-shift-lost-click': {
    what: 'an in-flow tips panel closes on any mousedown, so Submit moves up between press and release: the page never gets the click', want: 'not OK (the form was not submitted)',
    html: `${L}<button type="button" id="t" onclick="document.getElementById('tips').style.display='block'">Show tips</button>
      <div id="tips" style="display:none; height:200px; background:#ffd">Tips: fill in everything.</div>
      <form onsubmit="log('FORM SUBMITTED'); return false"><button id="s">Submit</button></form><div style="height:600px"></div>
      <script>document.addEventListener('mousedown', (e) => { if (e.target.id !== 't') document.getElementById('tips').style.display = 'none'; }, true);</script>`,
    steps: [{ click: 'Show tips' }, { click: 'Submit' }],
  },
  'wrapped-link-ends': {
    what: 'ORDINARY: a link that starts at the end of one line and ends at the start of the next', want: 'OK, link clicked once',
    html: `${L}<div style="width:300px; font-size:16px; line-height:24px; font-family:Arial">Please read all of our lovely <a href="#" onclick="log('link clicked'); return false">privacy policy</a> before you continue with it.</div>`,
    steps: [{ click: 'privacy policy' }],
    probe: () => [...document.querySelector('a').getClientRects()].map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]),
  },
  'centre-covered-badge': {
    what: 'ORDINARY: wide button whose middle is under a small unrelated floating label; its ends are free', want: 'OK',
    html: `${L}<div style="position:relative; width:600px"><button style="width:600px; height:40px" onclick="log('continued')">Continue</button><span style="position:absolute; left:270px; top:8px; background:#ff0; padding:2px 6px">NEW</span></div>`,
    steps: [{ click: 'Continue' }],
  },
  'svg-link': {
    what: 'ORDINARY: a link inside an SVG diagram', want: 'OK',
    html: `${L}<svg width="300" height="100"><a href="#details" onclick="window.__log.push('svg link')"><text x="10" y="40" font-size="20">Details</text></a></svg>`,
    steps: [{ click: 'Details' }],
  },
  'details-expand': {
    what: 'ORDINARY: native <details> named as the look names it', want: 'OK',
    html: `${L}<details><summary>Shipping details</summary><p>Ships in 2 days</p></details>`,
    steps: [{ expand: 'Shipping details', expect: { text: 'Ships in 2 days' } }],
    probe: () => window.__FS.observe().controls,
  },
  'div-accordion-expand': {
    what: 'ORDINARY: accordion header div[aria-expanded] named as the look names it', want: 'OK',
    html: `${L}<div class="acc"><div class="hd" aria-expanded="false" style="cursor:pointer" onclick="this.setAttribute('aria-expanded','true'); this.nextElementSibling.hidden=false">Returns policy</div><div hidden>30 days</div></div>`,
    steps: [{ expand: 'Returns policy', expect: { text: '30 days' } }],
    probe: () => window.__FS.observe().controls,
  },
  'expand-twisty-named-sibling': {
    what: 'tree row: collapsed node whose only nameless pointer mark is a "pin" toggle, real twisty is the label', want: 'no PINNED',
    html: `${L}<ul role="tree"><li role="treeitem" aria-expanded="false" id="n"><i style="cursor:pointer; display:inline-block; width:16px; height:16px; background:#ccc" onclick="log('FOLDER PINNED')"></i>
      <span onclick="const n = document.getElementById('n'); n.setAttribute('aria-expanded','true'); document.getElementById('kids').hidden = false">Projects</span><ul id="kids" hidden><li>Alpha</li></ul></li></ul>`,
    steps: [{ expand: 'Projects' }],
  },
  'expand-header-button-other': {
    what: 'accordion section (div[aria-expanded]) containing a button named like the section that does something else ("Billing" link-button goes to billing page)', want: 'no NAVIGATED',
    html: `${L}<div aria-expanded="false" aria-label="Billing" id="sec"><span style="cursor:pointer" onclick="document.getElementById('sec').setAttribute('aria-expanded','true')">▸ Billing section</span> <button onclick="log('NAVIGATED to billing page')">Billing</button></div>`,
    steps: [{ expand: 'Billing' }],
  },
  'pick-dup-groups': {
    what: 'custom dropdown with "Other" under two groups', want: 'STOP (two options read the same)',
    html: `${L}<style>[role=option]{cursor:pointer;padding:2px 12px}</style><div>Category</div>
      <button id="cb" aria-haspopup="listbox" aria-label="Category" aria-expanded="false" onclick="const l = document.getElementById('lst'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden))">Choose</button>
      <div id="lst" role="listbox" hidden style="position:absolute; background:#fff; border:1px solid">
        <div>Income</div><div role="option" onclick="choose('income-other', this)">Other</div><div role="option" onclick="choose('income-salary', this)">Salary</div>
        <div>Expenses</div><div role="option" onclick="choose('expense-rent', this)">Rent</div><div role="option" onclick="choose('expense-other', this)">Other</div></div>
      <script>function choose(v, o) { log('chose ' + v); document.getElementById('cb').textContent = o.textContent; document.getElementById('lst').hidden = true; document.getElementById('cb').setAttribute('aria-expanded', 'false'); }</script>`,
    steps: [{ pick: 'Category', value: 'Other' }],
  },
  'pick-fragment-two-line': {
    what: 'autocomplete with two-line suggestions (main text + secondary text), two places called Paris', want: 'STOP',
    html: `${L}<style>.sg div{cursor:pointer; padding:4px} .sub{color:#888; margin-left:8px}</style><label>City <input id="c" autocomplete="off"></label><div class="sg" id="sg" style="position:absolute; background:#fff"></div>
      <script>const data = [['Paris', 'Texas, USA', 'paris-tx'], ['Paris', 'France', 'paris-fr'], ['Parma', 'Italy', 'parma']];
        const c = document.getElementById('c'), sg = document.getElementById('sg');
        c.addEventListener('input', () => { sg.innerHTML = ''; if (c.value.length < 2) return; for (const [m, s, id] of data) if (m.toLowerCase().startsWith(c.value.toLowerCase())) { const d = document.createElement('div'); d.innerHTML = '<span class=main>' + m + '</span><span class=sub>' + s + '</span>'; d.onclick = () => { log('selected ' + id); c.value = m; sg.innerHTML = ''; }; sg.append(d); } });</script>`,
    steps: [{ pick: 'City', value: 'Paris' }],
  },
  'pick-symbol-options': {
    what: 'custom dropdown whose options differ only by a symbol the name comparison drops', want: 'chose ge (≥), or STOP',
    html: `${L}<style>[role=option]{cursor:pointer;padding:2px 12px}</style>
      <button id="cb" aria-haspopup="listbox" aria-label="Experience" aria-expanded="false" onclick="const l = document.getElementById('lst'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden))">Choose</button>
      <div id="lst" role="listbox" hidden style="position:absolute; background:#fff; border:1px solid">
        <div role="option" onclick="choose('le', this)">≤ 5 years</div><div role="option" onclick="choose('ge', this)">≥ 5 years</div></div>
      <script>function choose(v, o) { log('chose ' + v); document.getElementById('cb').textContent = o.textContent; document.getElementById('lst').hidden = true; document.getElementById('cb').setAttribute('aria-expanded', 'false'); }</script>`,
    steps: [{ pick: 'Experience', value: '≥ 5 years' }],
  },
  'radio-symbol-options': {
    what: 'radio options "−5 °C" (unicode minus) and "5 °C"; plan wants 5 °C', want: 'plus, or STOP',
    html: `${L}<fieldset><legend>Storage</legend><label><input type="radio" name="t" id="m" onclick="log('minus')"> −5 °C</label><label><input type="radio" name="t" id="p" onclick="log('plus')"> 5 °C</label></fieldset>`,
    steps: [{ radio: 'Storage', value: '5 °C' }],
  },
  'radio-wrong-group': {
    what: 'plan names a radio group that is not on the page; the only "Yes" is in a group without a legend ("Delete my account?")', want: 'STOP',
    html: `${L}<p>Delete my account after this order?</p><label><input type="radio" name="del" value="1" onclick="log('DELETE ACCOUNT = yes')"> Yes</label> <label><input type="radio" name="del" value="0" checked> No</label>`,
    steps: [{ radio: 'Subscribe to newsletter', value: 'Yes' }],
  },
  'nth-icon-order': {
    what: 'three Delete controls; the first on the page is an icon (div title=Delete), the others real buttons; nth: 1', want: 'deleted A (first on the page) or STOP',
    html: `${L}<ul><li>A <div title="Delete" style="cursor:pointer; display:inline-block; width:16px; height:16px; background:#c00" onclick="log('deleted A')"></div></li><li>B <button title="Delete" onclick="log('deleted B')">🗑</button></li><li>C <button title="Delete" onclick="log('deleted C')">🗑</button></li></ul>`,
    steps: [{ click: { text: 'Delete', nth: 1 } }],
  },
  'nth-shadow-order': {
    what: 'rows: first row is a web component (shadow DOM) with Delete, second a plain button; nth: 1', want: 'deleted A',
    html: `${L}<my-row></my-row><div>B <button onclick="log('deleted B')">Delete</button></div>
      <script>customElements.define('my-row', class extends HTMLElement { connectedCallback() { const s = this.attachShadow({ mode: 'open' }); s.innerHTML = '<div>A <button>Delete</button></div>'; s.querySelector('button').onclick = () => window.__log.push('deleted A'); } });</script>`,
    steps: [{ click: { text: 'Delete', nth: 1 } }],
  },
};
