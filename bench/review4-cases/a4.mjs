const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'drift-rerender': {
    what: 'in-between button re-renders the form (new nodes) with another quantity; then irreversible order', want: 'STOP, no ORDERED qty=20',
    html: `${L}<div id="f"><label>Quantity <input id="q"></label>
      <button type="button" onclick="document.getElementById('f').innerHTML = '<label>Quantity <input id=q value=20></label> <button type=button id=order>Place order</button><p>Coupon applied</p>'; document.getElementById('order').onclick = () => { log('ORDERED qty=' + document.getElementById('q').value); document.getElementById('done').textContent='Order placed'; }">Apply coupon</button>
      <button type="button" id="order" onclick="log('ORDERED qty=' + document.getElementById('q').value); document.getElementById('done').textContent='Order placed'">Place order</button></div><div id="done"></div>`,
    steps: [{ fill: 'Quantity', value: '2' }, { click: 'Apply coupon', expect: { text: 'Coupon applied' } }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }],
  },
  'drift-rerender-nonirrev': {
    what: 'same, the final click is an ordinary click', want: 'STOP',
    html: `${L}<div id="f"><label>Quantity <input id="q"></label>
      <button type="button" onclick="document.getElementById('f').innerHTML = '<label>Quantity <input id=q value=20></label> <button type=button id=order>Place order</button><p>Coupon applied</p>'; document.getElementById('order').onclick = () => { log('ORDERED qty=' + document.getElementById('q').value); document.getElementById('done').textContent='Order placed'; }">Apply coupon</button>
      <button type="button" id="order" onclick="log('ORDERED qty=' + document.getElementById('q').value); document.getElementById('done').textContent='Order placed'">Place order</button></div><div id="done"></div>`,
    steps: [{ fill: 'Quantity', value: '2' }, { click: 'Apply coupon', expect: { text: 'Coupon applied' } }, { click: 'Place order', expect: { text: 'Order placed' } }],
  },
  'drift-trusted-input': {
    what: 'field that only takes real typing (engine repairs with real keys); a later click rewrites it; then irreversible Pay', want: 'STOP, no PAID amount=999',
    html: `${L}<div><label>Amount <input id="a"></label>
      <button type="button" onclick="document.getElementById('det').textContent='Details shown'; st = '999'; document.getElementById('a').value='999'">Show details</button>
      <button type="button" onclick="log('PAID amount=' + document.getElementById('a').value); document.getElementById('done').textContent='Paid'">Pay</button></div><div id="det"></div><div id="done"></div>
      <script>let st = ''; const a = document.getElementById('a'); let trusted = false;
        a.addEventListener('keydown', (e) => { trusted = e.isTrusted; });
        a.addEventListener('input', (e) => { if (e.isTrusted) st = a.value; else a.value = st; });
        a.addEventListener('blur', () => { a.value = st; });</script>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Pay', risk: 'irreversible', expect: { text: 'Paid' } }],
  },
  'drift-realclick-checkbox': {
    what: 'custom checkbox that ignores scripted clicks (engine repairs with a real press); a later click unticks it; then irreversible', want: 'STOP, no SENT express=false',
    html: `${L}<div><div role="checkbox" aria-checked="false" aria-label="Express delivery" tabindex="0" id="x" style="width:20px;height:20px;border:1px solid"></div>
      <button type="button" onclick="document.getElementById('det').textContent='Details shown'; document.getElementById('x').setAttribute('aria-checked','false')">Show details</button>
      <button type="button" onclick="log('SENT express=' + document.getElementById('x').getAttribute('aria-checked')); document.getElementById('done').textContent='Sent'">Send</button></div><div id="det"></div><div id="done"></div>
      <script>document.getElementById('x').addEventListener('click', (e) => { if (e.isTrusted) e.currentTarget.setAttribute('aria-checked', 'true'); });</script>`,
    steps: [{ check: 'Express delivery' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Send', risk: 'irreversible', expect: { text: 'Sent' } }],
  },
  'reset-after-add': {
    what: 'ORDINARY: expense form (select + amount + checkbox); Add resets the form; then add a second expense', want: 'OK, two expenses',
    html: `${L}<form id="f" onsubmit="event.preventDefault(); log('added ' + this.cat.value + ' ' + this.amt.value + ' ' + this.bill.checked); const li = document.createElement('li'); li.textContent = this.cat.value + ' ' + this.amt.value; document.getElementById('l').append(li); this.reset()">
      <label>Category <select name="cat"><option value="">Choose...</option><option>Food</option><option>Travel</option></select></label>
      <label>Amount <input name="amt"></label> <label><input type="checkbox" name="bill"> Billable</label> <button>Add expense</button></form><ul id="l"></ul>
      <button type="button" onclick="log('report saved'); document.getElementById('s').textContent='Report saved'">Save report</button><div id="s"></div>`,
    steps: [{ select: 'Category', value: 'Food' }, { fill: 'Amount', value: '12' }, { check: 'Billable' }, { click: 'Add expense', expect: { text: 'Food 12' } },
      { click: 'Save report', expect: { text: 'Report saved' } }],
  },
  'reset-default-qty': {
    what: 'ORDINARY: line-item form; Add clears description and puts quantity back to its default "1"', want: 'OK',
    html: `${L}<div><label>Description <input id="d"></label> <label>Quantity <input id="q" value="1"></label>
      <button type="button" onclick="log('line ' + d.value + ' x' + q.value); document.getElementById('l').textContent += d.value + ' x' + q.value + '; '; d.value=''; q.value='1'">Add line</button></div><div id="l"></div>
      <button type="button" onclick="log('invoice saved'); document.getElementById('s').textContent='Invoice saved'">Save invoice</button><div id="s"></div>
      <script>const d = document.getElementById('d'), q = document.getElementById('q');</script>`,
    steps: [{ fill: 'Description', value: 'Widget' }, { fill: 'Quantity', value: '5' }, { click: 'Add line', expect: { text: 'Widget x5' } }, { click: 'Save invoice', expect: { text: 'Invoice saved' } }],
  },
  'coupon-then-order': {
    what: 'ORDINARY: coupon box emptied by its own Apply button; then irreversible Place order', want: 'OK or documented stop',
    html: `${L}<div><label>Coupon code <input id="c"></label> <button type="button" onclick="document.getElementById('m').textContent='Coupon SAVE10 applied'; document.getElementById('c').value=''">Apply</button></div><div id="m"></div>
      <button type="button" onclick="log('ORDER PLACED'); document.getElementById('s').textContent='Thank you for your order'">Place order</button><div id="s"></div>`,
    steps: [{ fill: 'Coupon code', value: 'SAVE10' }, { click: 'Apply', expect: { text: 'applied' } }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Thank you' } }],
  },
  'eu-format': {
    what: 'ORDINARY (German): amount field formats 1500 as 1.500,00 on blur', want: 'OK or stop?',
    html: `${L}<label>Betrag <input id="a" onblur="const n = parseFloat(this.value); if (!isNaN(n)) this.value = n.toLocaleString('de-DE', { minimumFractionDigits: 2 })"></label> <button type="button" onclick="log('gespeichert ' + document.getElementById('a').value); document.getElementById('s').textContent='Gespeichert'">Speichern</button><div id="s"></div>`,
    steps: [{ fill: 'Betrag', value: '1500' }, { click: 'Speichern', expect: { text: 'Gespeichert' } }],
    probe: () => document.getElementById('a').value,
  },
  'us-format': {
    what: 'control: same with en-US formatting', want: 'OK',
    html: `${L}<label>Amount <input id="a" onblur="const n = parseFloat(this.value); if (!isNaN(n)) this.value = n.toLocaleString('en-US', { minimumFractionDigits: 2 })"></label> <button type="button" onclick="log('saved ' + document.getElementById('a').value); document.getElementById('s').textContent='Saved'">Save</button><div id="s"></div>`,
    steps: [{ fill: 'Amount', value: '1500' }, { click: 'Save', expect: { text: 'Saved' } }],
  },
  'cents-shift': {
    what: 'cents-style field turns 1234567 into 12.345,67 (a hundred times less); irreversible Pay', want: 'STOP',
    html: `${L}<label>Amount <input id="a" onblur="const d = this.value.replace(/\\D/g, ''); if (d) this.value = (parseInt(d, 10) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })"></label> <button type="button" onclick="log('PAID ' + document.getElementById('a').value); document.getElementById('s').textContent='Paid'">Pay</button><div id="s"></div>`,
    steps: [{ fill: 'Amount', value: '1234567' }, { click: 'Pay', risk: 'irreversible', expect: { text: 'Paid' } }],
  },
  'resume-other-page': {
    what: 'resume after a same-document screen change: screen 2 has a field with the same label and its own value', want: 'run 2 OK',
    html: `${L}<div id="w"><h2>Sign up</h2><label>Name <input id="a"></label> <button type="button" onclick="document.getElementById('w').innerHTML = '<h2>Profile</h2><label>Name <input id=b value=&quot;Layla Hassan (you)&quot;></label> <button type=button id=fin>Finish setup</button>'; document.getElementById('fin').onclick = () => { log('finished ' + document.getElementById('b').value); document.getElementById('w').innerHTML='All done'; }">Next</button></div>`,
    runs: [
      { steps: [{ fill: 'Name', value: 'Layla' }, { click: 'Next', expect: { text: 'Profile' } }, { click: 'Finish', expect: { text: 'All done' } }] },
      { steps: [{ fill: 'Name', value: 'Layla' }, { click: 'Next', expect: { text: 'Profile' } }, { click: 'Finish setup', expect: { text: 'All done' } }], from: 2 },
    ],
  },
};
