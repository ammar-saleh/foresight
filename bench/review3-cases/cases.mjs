// Throw-away repro pages for the review. Every page records what really happened in window.__log.
const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;

export const CASES = {
  'near-div': {
    what: 'near "Bob" when only Alice\'s (div) row has Remove',
    html: `${L}<h1>Team</h1><div class="list">
      <div class="row"><span>Alice</span> <button onclick="log('removed Alice')">Remove</button></div>
      <div class="row"><span>Bob</span> <span>owner</span></div></div>`,
    steps: [{ click: { text: 'Remove', near: 'Bob' } }],
  },
  'near-heading': {
    what: 'near text only appears in a heading above the list',
    html: `${L}<main><h2>Invoices for Bob Ltd</h2><ul><li><span>Invoice 1001 (Alice Co)</span> <button onclick="log('deleted 1001')">Delete</button></li></ul></main>`,
    steps: [{ click: { text: 'Delete', near: 'Bob' } }],
  },
  'popup-on-interaction': {
    what: 'marketing pop-up shown 300 ms after the first click anywhere; has Email + Submit like the page',
    html: `${L}<form onsubmit="log('PAGE form sent: ' + this.email.value); return false">
      <button type="button" id="opts" onclick="document.getElementById('o').textContent='Options shown'">Show options</button><div id="o"></div>
      <label>Email <input name="email" id="pe"></label> <button>Submit</button></form>
      <div id="pop" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:300px; background:#fee; padding:10px">
        <h3>Join our newsletter</h3><form onsubmit="log('NEWSLETTER signup: ' + this.e.value); return false"><label>Email <input name="e" id="ne"></label> <button>Submit</button></form></div>
      <script>addEventListener('click', () => setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 300), { once: true });</script>`,
    steps: [{ click: 'Show options', expect: { text: 'Options shown' } }, { expect: { text: 'Join our newsletter' } }, { fill: 'Email', value: 'layla@example.com' }, { click: 'Submit' }],
  },
  'foreign-confirm': {
    what: 'timer pop-up (no plan press) has "Confirm"; the page has no such control yet',
    html: `${L}<label>City <input id="c"></label>
      <div id="pop" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:320px; background:#fee; padding:10px">
        Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button onclick="this.parentNode.remove()">Maybe</button></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 100);</script>`,
    waitBefore: 400,
    steps: [{ fill: 'City', value: 'Austin' }, { click: 'Confirm' }],
    probe: () => document.getElementById('c').value,
  },
  'foreign-confirm-only': {
    what: 'same, the plan only clicks Confirm',
    html: `${L}<label>City <input id="c"></label>
      <div id="pop" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:320px; background:#fee; padding:10px">
        Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button onclick="this.parentNode.remove()">Maybe</button></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 100);</script>`,
    waitBefore: 400,
    steps: [{ click: 'Confirm' }],
  },
  'affordance': {
    what: 'plan says "Submit"; the form\'s only button is "Submit and pay now"',
    html: `${L}<form onsubmit="log('PAID'); return false"><label>Name <input></label><button>Submit and pay now</button></form>`,
    steps: [{ fill: 'Name', value: 'Layla' }, { click: 'Submit' }],
  },
  'submit-marks-sent': {
    what: 'in-between button is a default (submit) button in the same form; its handler rewrites Quantity',
    html: `${L}<form onsubmit="return false"><label>Quantity <input id="q"></label>
      <button id="more" onclick="document.getElementById('det').textContent='Details shown'; document.getElementById('q').value='20'">Show details</button>
      <button id="order" type="button" onclick="log('ORDERED qty=' + document.getElementById('q').value); document.getElementById('done').textContent='Order placed'">Place order</button></form>
      <div id="det"></div><div id="done"></div>`,
    steps: [{ fill: 'Quantity', value: '2' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Place order', risk: 'irreversible', expect: { text: 'Order placed' } }],
  },
  'emptied': {
    what: 'an unrelated click empties a field the plan wrote; then an irreversible click',
    html: `${L}<div><label>Promo code <input id="p"></label> <label>Amount <input id="a"></label>
      <button type="button" onclick="document.getElementById('det').textContent='Details shown'; document.getElementById('a').value=''">Show details</button>
      <button type="button" onclick="log('PAID amount=[' + document.getElementById('a').value + ']'); document.getElementById('done').textContent='Paid'">Pay</button></div>
      <div id="det"></div><div id="done"></div>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Show details', expect: { text: 'Details shown' } }, { click: 'Pay', risk: 'irreversible', expect: { text: 'Paid' } }],
  },
  'decimal-comma': {
    what: 'amount typed with a decimal comma; the field keeps digits only',
    html: `${L}<div><label>Amount (EUR) <input id="a" onblur="this.value = this.value.replace(/[^0-9]/g, '')"></label>
      <button type="button" onclick="log('PAID amount=' + document.getElementById('a').value); document.getElementById('done').textContent='Paid'">Pay</button></div><div id="done"></div>`,
    steps: [{ fill: 'Amount (EUR)', value: '12,50' }, { click: 'Pay', risk: 'irreversible', expect: { text: 'Paid' } }],
  },
  'thousand-dot': {
    what: 'value "1.000" (thousand, de) ends up as "1"',
    html: `${L}<div><label>Menge <input id="a" onblur="this.value = String(parseFloat(this.value))"></label>
      <button type="button" onclick="log('ORDERED ' + document.getElementById('a').value); document.getElementById('done').textContent='Bestellt'">Bestellen</button></div><div id="done"></div>`,
    steps: [{ fill: 'Menge', value: '1.000' }, { click: 'Bestellen', risk: 'irreversible', expect: { text: 'Bestellt' } }],
  },
  'email-dots': {
    what: 'a field that drops the dots of what was typed',
    html: `${L}<div><label>Send to <input id="a" onblur="this.value = this.value.replace(/[.]/g, '')"></label>
      <button type="button" onclick="log('SENT to ' + document.getElementById('a').value); document.getElementById('done').textContent='Sent'">Send</button></div><div id="done"></div>`,
    steps: [{ fill: 'Send to', value: 'john.doe@example.com' }, { click: 'Send', risk: 'irreversible', expect: { text: 'Sent' } }],
  },
  'pick-list-inside': {
    what: 'custom dropdown whose list lives inside the opener; the wanted option is switched off and ignores the press',
    html: `${L}<style>[role=option]{cursor:pointer;padding:4px} [aria-disabled=true]{color:#aaa}</style>
      <div>Shipping</div>
      <div role="combobox" aria-label="Shipping" aria-expanded="false" id="cb" tabindex="0" style="border:1px solid #888; width:260px; padding:4px"
        onclick="if (event.target === this || event.target.id === 'cur') { const l = document.getElementById('lst'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden)); }">
        <span id="cur">Standard</span>
        <div id="lst" hidden>
          <div role="option" onclick="document.getElementById('cur').textContent='Standard'; document.getElementById('lst').hidden=true">Standard</div>
          <div role="option" aria-disabled="true">Express</div>
        </div></div>`,
    steps: [{ pick: 'Shipping', value: 'Express' }],
    probe: () => document.getElementById('cur').textContent,
  },
  'expand-first-button': {
    what: 'tree row whose first button is "Delete folder"',
    html: `${L}<ul role="tree"><li role="treeitem" aria-expanded="false" id="n" style="cursor:default">
        <span onclick="const n = document.getElementById('n'); n.setAttribute('aria-expanded', 'true'); document.getElementById('kids').hidden = false">Projects</span>
        <button title="Delete folder" onclick="log('FOLDER DELETED')">&#128465;</button>
        <ul id="kids" hidden><li>Alpha</li></ul></li></ul>`,
    steps: [{ expand: 'Projects' }],
  },
  'expand-hidden-child-button': {
    what: 'collapsed node; the first button inside it belongs to a hidden child',
    html: `${L}<div role="tree"><div role="treeitem" aria-expanded="false" id="n">
        <span class="lbl" onclick="this.parentNode.setAttribute('aria-expanded','true'); document.getElementById('kids').hidden = false">Home</span>
        <div id="kids" hidden><div>report.pdf <button onclick="log('FILE DELETED')">Delete file</button></div></div></div></div>`,
    steps: [{ expand: 'Home' }],
  },
  'text-child': {
    what: 'plan says "Cancel"; the only match is the bold word inside "Cancel my subscription"',
    html: `${L}<p>Manage plan</p><a href="#" onclick="log('SUBSCRIPTION CANCELLED'); return false"><b>Cancel</b> my subscription</a>`,
    steps: [{ click: 'Cancel' }],
  },
  'text-child-irrev': {
    what: 'irreversible "Delete"; only match is a span inside the "Delete all 53 items" button',
    html: `${L}<button onclick="log('ALL 53 DELETED'); document.getElementById('d').textContent='Done'"><span>Delete</span> <small>all 53 items</small></button><div id="d"></div>`,
    steps: [{ click: 'Delete', risk: 'irreversible', expect: { text: 'Done' } }],
  },
  'rowcol-colspan': {
    what: 'table whose header uses colspan: col "Price" lands in the Qty cell',
    html: `${L}<table border=1><thead><tr><th>SKU</th><th colspan="2">Name</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody><tr><td>SKU-104</td><td>Blue</td><td>Mug</td><td><input id="qty" value="3"></td><td><input id="price" value="4.00"></td></tr></tbody></table>`,
    steps: [{ fill: { row: 'SKU-104', col: 'Qty' }, value: '9' }],
    probe: () => ({ qty: document.getElementById('qty').value, price: document.getElementById('price').value }),
  },
  'frame-overlay': {
    what: 'step in a frame; a parent-page pop-up button sits over the same point',
    html: `${L}<h1>Host page</h1>
      <iframe id="f" style="width:600px;height:300px;border:0" srcdoc="<body style='margin:0'><div style='height:120px'></div><button style='margin-left:200px' onclick=&quot;parent.__log.push('frame Save clicked')&quot;>Save</button></body>"></iframe>
      <div id="promo" style="position:fixed; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,.2)">
        <button style="position:absolute; left:0; top:0; width:100%; height:100%" onclick="log('PARENT: Accept all & subscribe pressed')">Accept all &amp; subscribe</button></div>`,
    steps: [{ click: 'Save', frame: 1 }],
  },
  'shell-reject': {
    what: 'app in a full-window positioned shell; the field is covered by a small non-dialog overlay; an unrelated "Reject" exists',
    html: `${L}<div id="app" style="position:fixed; inset:0; overflow:auto; padding:20px">
      <h1>Approvals</h1>
      <table><tr><td>Expense #1 (Sam, $900)</td><td><button onclick="log('approved 1')">Approve</button> <button onclick="log('EXPENSE 1 REJECTED')">Reject</button></td></tr></table>
      <div style="position:relative; width:320px; height:30px; margin-top:20px">
        <input aria-label="Comment" id="c" style="width:300px">
        <div style="position:absolute; inset:0; background:rgba(255,255,255,.6)">loading...</div></div></div>`,
    steps: [{ fill: 'Comment', value: 'ok' }],
    probe: () => document.getElementById('c').value,
  },
  'shell-close': {
    what: 'same shell; the unrelated button is "Close" (closes the ticket)',
    html: `${L}<div id="app" style="position:absolute; left:0; top:0; width:100%; min-height:100%; padding:20px">
      <h1>Ticket 5512</h1><button onclick="log('TICKET CLOSED')">Close</button>
      <div style="position:relative; width:320px; height:30px; margin-top:20px">
        <input aria-label="Reply" id="c" style="width:300px">
        <div style="position:absolute; inset:0; background:rgba(255,255,255,.6)">saving draft...</div></div></div>`,
    steps: [{ fill: 'Reply', value: 'thanks' }],
    probe: () => document.getElementById('c').value,
  },
  'pick-timeout': {
    what: 'autocomplete with no matching suggestion: is anything left behind?',
    html: `${L}<label>City <input id="c" value="Boston" oninput="log('input event: ' + this.value)"></label>`,
    steps: [{ pick: 'City', value: 'Austin, TX' }],
    probe: () => document.getElementById('c').value,
  },
  'resume-drift': {
    what: 'the widget rewrites the date when Book is pressed; run stops; then resume from the click as the hint says',
    html: `${L}<form onsubmit="return false"><label>Travel date <input id="d"></label>
      <button id="go" type="button" onmousedown="document.getElementById('d').value='2026-01-01'" onclick="log('BOOKED for ' + document.getElementById('d').value); document.getElementById('done').textContent='Booked'">Book</button></form><div id="done"></div>`,
    runs: [
      { steps: [{ fill: 'Travel date', value: '2026-11-16' }, { click: 'Book', expect: { text: 'Booked' } }] },
      { steps: [{ fill: 'Travel date', value: '2026-11-16' }, { click: 'Book', expect: { text: 'Booked' } }], from: 1 },
    ],
  },
  'mousedown-remove': {
    what: 'rows whose Remove acts on press-down (the row disappears)',
    html: `${L}<ul id="l">${['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n) => `<li>${n} <button onmousedown="log('REMOVED ${n}'); this.parentNode.remove()">Remove</button></li>`).join('')}</ul>`,
    steps: [{ click: { text: 'Remove', nth: 1 } }],
  },
  'mousedown-add': {
    what: 'a button that acts on press-down and pushes itself down',
    html: `${L}<div id="items"></div><button onmousedown="log('ADDED'); const d = document.createElement('div'); d.style.height='60px'; d.textContent='item'; document.getElementById('items').append(d)">Add item</button>`,
    steps: [{ click: 'Add item' }],
  },
  'closead': {
    what: 'control covered by an <ins>; an unrelated embedded app frame has a "Skip" button',
    html: `${L}<div style="position:relative; width:320px; height:40px"><button id="b" onclick="log('Save clicked')" style="width:300px;height:30px">Save</button>
        <ins style="position:absolute; inset:0; background:#ffd; display:block">sponsored</ins></div>
      <iframe name="onboarding" style="width:400px;height:120px" srcdoc="<p>Step 2 of 5: verify your phone</p><button onclick=&quot;parent.__log.push('ONBOARDING STEP SKIPPED')&quot;>Skip</button>"></iframe>`,
    steps: [{ click: 'Save' }],
  },
  'upload-single': {
    what: 'the only upload field, named differently from the plan',
    html: `${L}<label>Attachment <input type="file" id="f"></label>`,
    steps: [{ upload: 'Resume', file: 'results/upload-sample.txt' }],
  },
  'upload-unnamed': {
    what: 'the only upload field, no name at all',
    html: `${L}<div><input type="file" id="f"></div>`,
    steps: [{ upload: 'Resume', file: 'results/upload-sample.txt' }],
  },
  'wizard-samelabel': {
    what: 'two screens with a field of the same label; the first screen is removed from the page',
    html: `${L}<div id="w"><h2>Passenger 1</h2><label>First name <input id="a"></label> <button type="button" onclick="log('p1=' + document.getElementById('a').value); document.getElementById('w').innerHTML = '<h2>Passenger 2</h2><label>First name <input id=b></label> <button type=button onclick=&quot;log(\\'p2=\\' + document.getElementById(\\'b\\').value); document.getElementById(\\'w\\').innerHTML=\\'All done\\'&quot;>Finish</button>'">Next</button></div>`,
    steps: [{ fill: 'First name', value: 'Layla' }, { click: 'Next', expect: { text: 'Passenger 2' } }, { fill: 'First name', value: 'Omar' }, { click: 'Finish', expect: { text: 'All done' } }],
  },
  'expect-negated': {
    what: 'expect "Saved" when the page answers "Not saved"',
    html: `${L}<button onclick="document.getElementById('m').textContent = 'Error: not saved, the title is missing'">Save</button><div id="m"></div>`,
    steps: [{ click: 'Save', expect: { text: 'Saved' } }],
  },
  'opt-out': {
    what: 'plan unticks "Marketing emails"; the only box is "Opt out of marketing emails" (ticked)',
    html: `${L}<label><input type="checkbox" id="o" checked> Opt out of marketing emails</label>`,
    steps: [{ uncheck: 'Marketing emails' }],
    probe: () => document.getElementById('o').checked,
  },
  'turn-off': {
    what: 'plan ticks "Notifications"; the only box is "Turn off notifications"',
    html: `${L}<label><input type="checkbox" id="o"> Turn off notifications</label>`,
    steps: [{ check: 'Notifications' }],
    probe: () => document.getElementById('o').checked,
  },
  'minus': {
    what: 'radio value "5" when the options are "-5" and "+5"',
    html: `${L}<fieldset><legend>Adjustment</legend><label><input type="radio" name="adj" value="m" id="m"> -5</label><label><input type="radio" name="adj" value="p" id="p"> +5</label></fieldset>`,
    steps: [{ radio: 'Adjustment', value: '5' }],
    probe: () => ({ minus: document.getElementById('m').checked, plus: document.getElementById('p').checked }),
  },
  'level': {
    what: 'click "Level 1" when only "Level -1" exists',
    html: `${L}<button onclick="log('went to level -1')">Level -1</button>`,
    steps: [{ click: 'Level 1' }],
  },
  'wrapped-link': {
    what: 'a link that wraps over two lines in a narrow column',
    html: `${L}<div style="width:200px; font-size:16px; line-height:24px">Some intro text here and <a href="#" onclick="log('link clicked'); return false">terms and conditions of the service agreement</a> end.</div>`,
    steps: [{ click: 'terms and conditions of the service agreement' }],
  },
  'tab-adopt': {
    what: 'a click that also opens a pop-under tab with a look-alike form',
    html: `${L}<button type="button" onclick="document.getElementById('o').textContent='Step two'; const w = window.open('about:blank'); w.document.write('<title>Win a prize</title><script>window.__log=[];<\\/script><label>Email <input id=e></label><button onclick=&quot;window.__log.push(\\'AD FORM SENT: \\' + document.getElementById(\\'e\\').value)&quot;>Continue</button>'); w.document.close();">Next</button><div id="o"></div>
      <label>Email <input id="e"></label> <button type="button" onclick="log('page form sent: ' + document.getElementById('e').value)">Continue</button>`,
    steps: [{ click: 'Next', expect: { text: 'Step two' } }, { fill: 'Email', value: 'layla@example.com' }, { click: 'Continue' }],
  },
  'select-dialog': {
    what: 'a dialog raised by the plan\'s own select; no press before it',
    html: `${L}<label>Country <select id="s" onchange="document.getElementById('dlg').style.display='block'"><option>Jordan</option><option>Germany</option></select></label>
      <label>Phone <input id="p"></label>
      <div id="dlg" role="dialog" aria-modal="true" style="display:none; position:fixed; inset:20%; background:#eee; padding:20px">Changing the country empties your basket. Continue?
        <button onclick="log('user chose CONTINUE')">Continue</button> <button onclick="log('CANCEL pressed for the plan'); document.getElementById('s').selectedIndex = 0; document.getElementById('dlg').style.display='none'">Cancel</button></div>`,
    steps: [{ select: 'Country', value: 'Germany' }, { fill: 'Phone', value: '5550100' }],
    probe: () => ({ country: document.getElementById('s').value, phone: document.getElementById('p').value }),
  },
  'nav-dialog': {
    what: 'the plan\'s click loads a page that asks a question in a dialog',
    url: 'nav-a.html',
    steps: [{ click: 'Upgrade plan' }, { fill: 'Company name', value: 'Acme' }],
    probe: () => ({ company: document.getElementById('c')?.value }),
  },
};
