const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'tab-adopt-async': {
    what: 'Next opens a pop-under advert tab with an Email form; the page itself draws its own Email field 600 ms later', want: 'no AD FORM',
    html: `${L}<button type="button" onclick="const w = window.open('about:blank'); w.document.write('<title>Win a prize</title><script>window.__log=[];<\\/script><label>Email <input id=e></label><button onclick=&quot;window.__log.push(\\'AD FORM SENT: \\' + document.getElementById(\\'e\\').value)&quot;>Continue</button>'); w.document.close(); setTimeout(() => { document.getElementById('o').innerHTML = '<h2>Step two</h2><label>Email <input id=e></label> <button type=button id=c>Continue</button>'; document.getElementById('c').onclick = () => window.__log.push('page form sent: ' + document.getElementById('e').value); }, 600)">Next</button><div id="o"></div>`,
    steps: [{ click: 'Next' }, { fill: 'Email', value: 'layla@example.com' }, { click: 'Continue' }],
  },
  'fill-raises-dialog': {
    what: 'the plan\'s own fill raises a small non-modal question (role=dialog, covers nothing); next step is the irreversible order', want: 'STOP (the question is unanswered)',
    html: `${L}<label>Quantity <input id="q" onchange="if (+this.value > 100) document.getElementById('dlg').style.display='block'"></label>
      <button type="button" onclick="log('ORDERED qty=' + document.getElementById('q').value + ' surcharge unanswered'); document.getElementById('m').textContent='Order placed'">Place order</button><div id="m"></div>
      <div id="dlg" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:300px; background:#eee; padding:10px">Orders over 100 units carry a 20% surcharge. <button>Accept surcharge</button> <button>Change quantity</button></div>`,
    steps: [{ fill: 'Quantity', value: '500' }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }],
  },
  'check-raises-dialog': {
    what: 'control: same question raised by a check step', want: 'STOP',
    html: `${L}<label><input type="checkbox" id="q" onchange="document.getElementById('dlg').style.display='block'"> Express</label>
      <button type="button" onclick="log('ORDERED'); document.getElementById('m').textContent='Order placed'">Place order</button><div id="m"></div>
      <div id="dlg" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:300px; background:#eee; padding:10px">Express carries a 20% surcharge. <button>Accept surcharge</button> <button>Change</button></div>`,
    steps: [{ check: 'Express' }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }],
  },
  'rowcol-group-header': {
    what: 'two header rows with rowspan + colspan; col "Reserved"', want: 'OK, res=9',
    html: `${L}<table border=1><thead><tr><th rowspan="2">SKU</th><th colspan="2">Stock</th><th rowspan="2">Price</th></tr><tr><th>On hand</th><th>Reserved</th></tr></thead>
      <tbody><tr><td>SKU-104</td><td><input id="qty" value="3"></td><td><input id="res" value="1"></td><td><input id="price" value="4.00"></td></tr></tbody></table>`,
    steps: [{ fill: { row: 'SKU-104', col: 'Reserved' }, value: '9' }],
    probe: () => ({ qty: document.getElementById('qty').value, res: document.getElementById('res').value, price: document.getElementById('price').value }),
  },
  'rowcol-checkbox-first': {
    what: 'ORDINARY: table with a select-row checkbox in the first column; row key in the second', want: 'OK or stop',
    html: `${L}<table border=1><thead><tr><th></th><th>SKU</th><th>On hand</th></tr></thead>
      <tbody><tr><td><input type="checkbox"></td><td>SKU-104</td><td><input id="qty" value="3"></td></tr><tr><td><input type="checkbox"></td><td>SKU-105</td><td><input id="qty2" value="3"></td></tr></tbody></table>`,
    steps: [{ fill: { row: 'SKU-105', col: 'On hand' }, value: '9' }],
    probe: () => ({ qty: document.getElementById('qty').value, qty2: document.getElementById('qty2').value }),
  },
  'rowcol-body-colspan': {
    what: 'a body row above uses colspan; target row is plain; plus a row whose first cell spans two rows', want: 'OK price2=9',
    html: `${L}<table border=1><tr><th>SKU</th><th>Size</th><th>Qty</th><th>Price</th></tr>
      <tr><td rowspan="2">SKU-104</td><td>Small</td><td><input id="q1" value="1"></td><td><input id="p1" value="4.00"></td></tr>
      <tr><td>Large</td><td><input id="q2" value="1"></td><td><input id="p2" value="5.00"></td></tr>
      <tr><td>SKU-105</td><td>One size</td><td><input id="q3" value="1"></td><td><input id="p3" value="6.00"></td></tr></table>`,
    steps: [{ fill: { row: 'SKU-104', col: 'Price' }, value: '9' }],
    probe: () => ['q1', 'p1', 'q2', 'p2', 'q3', 'p3'].map((i) => i + '=' + document.getElementById(i).value).join(' '),
  },
  'long-link-name': {
    what: 'ORDINARY: headline link longer than 60 characters, named as the look prints it', want: 'OK',
    html: `${L}<h2><a href="#a1" onclick="log('opened article')">City council approves the new riverside cycling path after two years of debate</a></h2><p>...</p>`,
    steps: [{ click: 'PLACEHOLDER' }],
    runs: [{ before: async (p) => { await p.evaluate(() => { window.__look = window.__FS ? window.__FS.observe().links[0] : null; }); }, steps: [{ click: 'City council approves the new riverside cycling path after two' }] }],
    probe: () => { const s = document.createElement('script'); return window.__FS.observe().links; },
  },
  'aria-readmore': {
    what: 'ORDINARY: "Read more" links with longer aria-labels; plan uses the look name', want: 'OK',
    html: `${L}<article><h3>Mugs</h3><a href="#m" aria-label="Read more about mugs" onclick="log('mugs')">Read more</a></article><article><h3>Plates</h3><a href="#p" aria-label="Read more about plates" onclick="log('plates')">Read more</a></article>`,
    steps: [{ click: 'Read more about plates' }],
    probe: () => window.__FS.observe().links,
  },
};
