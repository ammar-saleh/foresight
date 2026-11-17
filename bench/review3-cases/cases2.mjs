const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
import { Foresight } from '../../engine/foresight.js';
export const CASES = {
  'rowcol-colspan': {
    what: 'table whose header uses colspan: col "Price" lands in the Qty cell',
    html: `${L}<table border=1><thead><tr><th>SKU</th><th colspan="2">Name</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody><tr><td>SKU-104</td><td>Blue</td><td>Mug</td><td><input id="qty" value="3"></td><td><input id="price" value="4.00"></td></tr></tbody></table>`,
    steps: [{ fill: { row: 'SKU-104', col: 'Price' }, value: '9' }],
    probe: () => ({ qty: document.getElementById('qty').value, price: document.getElementById('price').value }),
  },
  'rowcol-2header': {
    what: 'two header rows (group row first)',
    html: `${L}<table border=1><thead><tr><th>Item</th><th>Stock</th><th>Money</th></tr><tr><th>SKU</th><th>On hand</th><th>Price</th></tr></thead>
      <tbody><tr><td>SKU-104</td><td><input id="qty" value="3"></td><td><input id="price" value="4.00"></td></tr></tbody></table>`,
    steps: [{ fill: { row: 'SKU-104', col: 'Money' }, value: '9' }],
    probe: () => ({ qty: document.getElementById('qty').value, price: document.getElementById('price').value }),
  },
  'invite-decline': {
    what: 'an app dialog (not an advert) pops up on a timer while the plan runs; its buttons are Accept / Decline',
    html: `${L}<label>City <input id="c"></label><button type="button" onclick="document.getElementById('o').textContent='Options shown'">Show options</button><div id="o"></div><label>Zip <input id="z"></label>
      <div id="pop" role="dialog" aria-modal="true" style="display:none; position:fixed; inset:20%; background:#eee; padding:20px">
        Sam Lee shared the folder "Budget 2027" with you. <button onclick="log('accepted')">Accept</button> <button onclick="log('SHARE DECLINED by the engine'); this.parentNode.remove()">Decline</button></div>
      <script>addEventListener('click', () => setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 1800), { once: true });</script>`,
    steps: [{ fill: 'City', value: 'Austin' }, { click: 'Show options', expect: { text: 'Options shown' } }, { expect: { text: 'Budget 2027', timeout: 4000 } }, { fill: 'Zip', value: '73301' }],
    probe: () => document.getElementById('z').value,
  },
  'own-nonmodal': {
    what: 'the plan\'s own click asks a question in a small non-modal dialog that covers nothing',
    html: `${L}<button type="button" onclick="document.getElementById('dlg').style.display='block'">Delete draft</button> <label>Title <input id="t"></label>
      <div id="dlg" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:260px; background:#eee; padding:10px">Delete this draft? <button onclick="log('deleted')">Delete</button> <button>Keep</button></div>`,
    steps: [{ click: 'Delete draft' }, { fill: 'Title', value: 'Q4 notes' }],
    probe: () => document.getElementById('t').value,
  },
  'pick-chip-elsewhere': {
    what: 'autocomplete whose suggestion ignores the scripted press; the same text is already elsewhere on the form',
    html: `${L}<form><div><label>To <input id="c" oninput="const s = document.getElementById('sg'); s.innerHTML = this.value.length >= 2 ? '<div class=opt>Austin, TX</div>' : ''"></label>
        <div id="sg"></div></div>
        <p>Popular: <a href="#" onclick="return false">Austin, TX</a></p></form>`,
    steps: [{ pick: 'To', value: 'Austin, TX' }],
    probe: () => document.getElementById('c').value,
  },
  'escape-search': {
    what: 'next step is blocked; the engine presses Escape in the previous (search) field',
    html: `${L}<input type="search" aria-label="Search" id="s">
      <div style="position:relative; width:120px; height:30px"><button id="go" onclick="log('searched ' + document.getElementById('s').value)">Go</button>
      <div style="position:absolute; inset:0; background:rgba(255,255,255,.5)"></div></div>`,
    steps: [{ fill: 'Search', value: 'refund policy' }, { click: 'Go' }],
    probe: () => document.getElementById('s').value,
  },
  'escape-inline-edit': {
    what: 'inline editor that discards on Escape; next step blocked',
    html: `${L}<div id="ed"><input aria-label="Card title" id="s" onkeydown="if (event.key === 'Escape') { log('EDIT DISCARDED'); document.getElementById('ed').innerHTML = 'Add a card'; }"></div>
      <div style="position:relative; width:120px; height:30px"><button id="go" onclick="log('added')">Add card</button>
      <div style="position:absolute; inset:0; background:rgba(255,255,255,.5)"></div></div>`,
    steps: [{ fill: 'Card title', value: 'Call the bank' }, { click: 'Add card' }],
  },
  'cache-ambiguity': {
    what: 'library use with the cache on: run 1 has one Delete, run 2 has three',
    fx: new Foresight({ irreversible: 'verify' }),
    html: `${L}<table><tbody id="tb"><tr><td>Invoice 1001</td><td><button onclick="log('deleted ' + this.closest('tr').cells[0].textContent)">Delete</button></td></tr></tbody></table>`,
    runs: [
      { steps: [{ click: 'Delete' }] },
      { steps: [{ click: 'Delete' }], before: (p) => p.evaluate(() => { const tb = document.getElementById('tb'); tb.insertAdjacentHTML('afterbegin', '<tr><td>Invoice 2001</td><td><button onclick="log(\'deleted \' + this.closest(\'tr\').cells[0].textContent)">Delete</button></td></tr>'); tb.insertAdjacentHTML('beforeend', '<tr><td>Invoice 3001</td><td><button onclick="log(\'deleted \' + this.closest(\'tr\').cells[0].textContent)">Delete</button></td></tr>'); }) },
    ],
  },
  'upload-file': {
    what: 'unnamed upload field, plan uses the name the look prints ("file")',
    html: `${L}<div><input type="file"></div>`,
    steps: [{ upload: 'file', file: 'results/upload-sample.txt' }],
  },
  'hover-timeout': {
    what: 'hover whose expect fails: what does acted say?',
    html: `${L}<button onmouseenter="log('menu opened')">Account</button>`,
    steps: [{ hover: 'Account', expect: { text: 'Sign out', timeout: 300 } }],
  },
  'label-select': {
    what: 'label that wraps its select: the name swallows the options',
    html: `${L}<label>Delete after <select id="a"><option>Never</option><option>30 days</option></select></label><label>Archive after <select id="b"><option>Never</option><option>30 days</option></select></label>`,
    steps: [{ select: 'Never', value: '30 days' }],
    probe: () => ({ a: document.getElementById('a').value, b: document.getElementById('b').value }),
  },
};
