const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
const dd = (opts) => `<style>[role=option]{cursor:pointer;padding:2px 12px}</style>
      <div id="cb" role="combobox" aria-haspopup="listbox" aria-label="Category" aria-expanded="false" tabindex="0" style="border:1px solid; width:200px; padding:4px" onclick="const l = document.getElementById('lst'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden))">Choose</div>
      <div id="lst" role="listbox" hidden style="position:absolute; background:#fff; border:1px solid">${opts}</div>
      <script>function choose(v, o) { log('chose ' + v); document.getElementById('cb').textContent = o.textContent; document.getElementById('lst').hidden = true; document.getElementById('cb').setAttribute('aria-expanded', 'false'); }</script>`;
export const CASES = {
  'wrapped-link-ends': {
    what: 'ORDINARY: a link that starts at the end of one line and ends at the start of the next', want: 'OK, link clicked once',
    html: `${L}<div style="width:300px; font-size:16px; line-height:24px; font-family:Arial">Please read all of our very lovely <a href="#" onclick="log('link clicked'); return false">privacy policy</a> before you continue with it.</div>`,
    steps: [{ click: 'privacy policy' }],
    probe: () => [...document.querySelector('a').getClientRects()].map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]),
  },
  'pick-dup-groups': {
    what: 'custom dropdown with "Other" under two groups', want: 'STOP (two options read the same)',
    html: `${L}${dd(`<div>Income</div><div role="option" onclick="choose('income-other', this)">Other</div><div role="option" onclick="choose('income-salary', this)">Salary</div>
        <div>Expenses</div><div role="option" onclick="choose('expense-rent', this)">Rent</div><div role="option" onclick="choose('expense-other', this)">Other</div>`)}`,
    steps: [{ pick: 'Category', value: 'Other' }],
  },
  'pick-symbol-options': {
    what: 'custom dropdown whose options differ only by a symbol the name comparison drops', want: 'chose ge, or STOP',
    html: `${L}${dd(`<div role="option" onclick="choose('le', this)">≤ 5 years</div><div role="option" onclick="choose('ge', this)">≥ 5 years</div>`)}`,
    steps: [{ pick: 'Category', value: '≥ 5 years' }],
  },
  'pick-ordinary': {
    what: 'ORDINARY custom dropdown', want: 'OK chose travel',
    html: `${L}${dd(`<div role="option" onclick="choose('food', this)">Food</div><div role="option" onclick="choose('travel', this)">Travel</div>`)}`,
    steps: [{ pick: 'Category', value: 'Travel' }],
  },
  'login-form': {
    what: 'ORDINARY: login-style form (fake data), remember me, show password', want: 'OK',
    html: `${L}<h1>Sign in</h1><form onsubmit="event.preventDefault(); log('login ' + this.u.value + ' ' + this.p.value.length + ' ' + this.r.checked); document.getElementById('m').textContent='Welcome back'">
      <div><label for="u">Email address</label><input id="u" name="u" type="email" required></div>
      <div><label for="p">Password</label><input id="p" name="p" type="password" required> <button type="button" aria-label="Show password" onclick="const p = document.getElementById('p'); p.type = p.type === 'password' ? 'text' : 'password'">👁</button></div>
      <div><input type="checkbox" id="r" name="r"><label for="r">Remember me</label></div>
      <button type="submit">Sign in</button> <a href="#forgot">Forgot password?</a></form><div id="m"></div>
      <p>New here? <a href="#signup">Create an account</a></p>`,
    steps: [{ fill: 'Email address', value: 'test.user@example.com' }, { fill: 'Password', value: 'not-a-real-secret' }, { check: 'Remember me' }, { click: 'Sign in', expect: { text: 'Welcome back' } }],
  },
  'table-layout-form': {
    what: 'ORDINARY: old table-layout form, captions in the cell before each field (no <label for>)', want: 'OK',
    html: `${L}<form onsubmit="event.preventDefault(); log('registered ' + [...this.elements].map(e => e.value).join('|')); document.getElementById('m').textContent='Account created'"><table>
      <tr><td>Name</td><td><input name="n"></td></tr><tr><td>Company name</td><td><input name="c"></td></tr>
      <tr><td>Password</td><td><input type="password" name="p1"></td></tr><tr><td>Confirm password</td><td><input type="password" name="p2"></td></tr>
      <tr><td></td><td><button>Register</button></td></tr></table></form><div id="m"></div>`,
    steps: [{ fill: 'Name', value: 'Layla' }, { fill: 'Company name', value: 'Acme' }, { fill: 'Password', value: 'fake-pass-1' }, { fill: 'Confirm password', value: 'fake-pass-1' }, { click: 'Register', expect: { text: 'Account created' } }],
    probe: () => window.__FS.observe().controls,
  },
  'product-cards-near': {
    what: 'ORDINARY: product cards, price beside the Add to cart button; near the product title', want: 'OK added Blue Mug',
    html: `${L}<div style="display:flex; gap:20px">${['Red Mug', 'Blue Mug', 'Green Mug'].map((n, i) => `<div class="card" style="border:1px solid #ccc; padding:10px; width:200px"><h3>${n}</h3><p>Ceramic, 300 ml</p><div class="buy"><span class="price">$${4 + i}.00</span> <button onclick="log('added ${n}')">Add to cart</button></div></div>`).join('')}</div>`,
    steps: [{ click: { text: 'Add to cart', near: 'Blue Mug' } }],
  },
  'table-row-buttons': {
    what: 'ORDINARY: table with Edit/Delete per row, near the row name', want: 'OK edit Bob',
    html: `${L}<table><thead><tr><th>Name</th><th>Email</th><th>Actions</th></tr></thead><tbody>${['Alice', 'Bob', 'Carol'].map((n) => `<tr><td>${n}</td><td>${n.toLowerCase()}@example.com</td><td><button onclick="log('edit ${n}')">Edit</button> <button onclick="log('delete ${n}')">Delete</button></td></tr>`).join('')}</tbody></table>`,
    steps: [{ click: { text: 'Edit', near: 'Bob' } }],
  },
  'offcanvas-duplicate': {
    what: 'ORDINARY: cart page with Checkout; an off-canvas mini-cart parked off the right edge also has a Checkout button', want: 'OK',
    html: `${L}<div style="overflow:hidden"><div id="drawer" style="position:fixed; top:0; right:0; width:320px; height:100%; transform:translateX(100%); background:#eee"><h3>Your cart</h3><button onclick="log('drawer checkout')">Checkout</button></div>
      <h1>Cart</h1><p>Blue Mug x1</p><button onclick="log('page checkout'); document.getElementById('m').textContent='Shipping address'">Checkout</button><div id="m"></div></div>`,
    steps: [{ click: 'Checkout', expect: { text: 'Shipping address' } }],
    probe: () => window.__FS.observe().controls,
  },
  'collapsed-duplicate': {
    what: 'ORDINARY: accordion sections collapsed with max-height:0; overflow:hidden; each has a "Notes" field; only one is open', want: 'OK',
    html: `${L}<style>.sec{overflow:hidden; max-height:0} .sec.open{max-height:500px}</style>
      <h3>Billing</h3><div class="sec"><label>Notes <input id="n1"></label></div>
      <h3>Shipping</h3><div class="sec open"><label>Notes <input id="n2"></label></div>`,
    steps: [{ fill: 'Notes', value: 'leave at the door' }],
    probe: () => ({ n1: document.getElementById('n1').value, n2: document.getElementById('n2').value, look: window.__FS.observe().controls }),
  },
  'sr-only-duplicate': {
    what: 'ORDINARY: a visually hidden (clip) skip-form duplicate of the search field', want: 'OK',
    html: `${L}<style>.sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}</style>
      <div class="sr"><label>Search <input id="s1"></label></div><label>Search <input id="s2"></label>`,
    steps: [{ fill: 'Search', value: 'mugs' }],
    probe: () => ({ s1: document.getElementById('s1').value, s2: document.getElementById('s2').value }),
  },
  'expect-order-no': {
    what: 'ORDINARY: confirmation text "Invoice No. 1002 deleted"', want: 'OK',
    html: `${L}<button onclick="document.getElementById('m').textContent='Invoice No. 1002 deleted'">Delete invoice</button><div id="m"></div>`,
    steps: [{ click: 'Delete invoice', expect: { text: '1002 deleted' } }],
  },
  'expect-after-no-row': {
    what: 'ORDINARY: status line right after a settings row that ends in "No"', want: 'OK',
    html: `${L}<table><tr><td>Marketing emails</td><td>No</td></tr></table><div id="m"></div><button onclick="document.getElementById('m').textContent='Changes saved'">Save</button>`,
    steps: [{ click: 'Save', expect: { text: 'Changes saved' } }],
  },
  'expect-mai': {
    what: 'ORDINARY (German): "12. Mai Termin bestätigt"', want: 'OK',
    html: `${L}<button onclick="document.getElementById('m').textContent='12. Mai Termin bestätigt'">Buchen</button><div id="m"></div>`,
    steps: [{ click: 'Buchen', expect: { text: 'Termin bestätigt' } }],
  },
  'wizard': {
    what: 'ORDINARY: 3-step wizard in one document, same Next button, radios in fieldset', want: 'OK',
    html: `${L}<div id="s1"><h2>Step 1</h2><label>Full name <input id="n"></label></div>
      <div id="s2" hidden><h2>Step 2</h2><fieldset><legend>Plan</legend><label><input type="radio" name="plan" value="basic"> Basic</label><label><input type="radio" name="plan" value="pro"> Pro</label></fieldset></div>
      <div id="s3" hidden><h2>Step 3</h2><label><input type="checkbox" id="t"> I accept the terms</label></div>
      <button id="nx" type="button">Next</button><div id="m"></div>
      <script>let s = 1; document.getElementById('nx').onclick = () => { if (s < 3) { document.getElementById('s' + s).hidden = true; s++; document.getElementById('s' + s).hidden = false; if (s === 3) document.getElementById('nx').textContent = 'Finish'; } else { log('done ' + document.getElementById('n').value + ' ' + document.querySelector('[name=plan]:checked')?.value + ' ' + document.getElementById('t').checked); document.getElementById('m').textContent = 'Setup complete'; } };</script>`,
    steps: [{ fill: 'Full name', value: 'Layla Test' }, { click: 'Next', expect: { text: 'Step 2' } }, { radio: 'Plan', value: 'Pro' }, { click: 'Next', expect: { text: 'Step 3' } }, { check: 'I accept the terms' }, { click: 'Finish', expect: { text: 'Setup complete' } }],
  },
  'autocomplete-ordinary': {
    what: 'ORDINARY: autocomplete with highlighted match and async results', want: 'OK selected AMM',
    html: `${L}<style>#sg li{cursor:pointer; list-style:none; padding:4px}</style><label for="c">From</label><input id="c" role="combobox" aria-autocomplete="list" aria-controls="sg" autocomplete="off"><ul id="sg" role="listbox" style="position:absolute; background:#fff; margin:0; padding:0"></ul>
      <script>const data = ['Amman, Jordan (AMM)', 'Amsterdam, Netherlands (AMS)', 'Amritsar, India (ATQ)']; const c = document.getElementById('c'), sg = document.getElementById('sg'); let t;
        c.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { sg.innerHTML = ''; const q = c.value.toLowerCase(); if (q.length < 2) return; for (const d of data) if (d.toLowerCase().startsWith(q)) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.innerHTML = '<b>' + d.slice(0, q.length) + '</b>' + d.slice(q.length); li.onmousedown = (e) => { e.preventDefault(); c.value = d; sg.innerHTML = ''; log('selected ' + d); }; sg.append(li); } }, 150); });</script>`,
    steps: [{ pick: 'From', value: 'Amman, Jordan (AMM)', typeText: 'Amm' }],
  },
};
