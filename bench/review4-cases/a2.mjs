const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'foreign-not-top': {
    what: 'timer pop-up (role=dialog) earlier in the DOM than a harmless seen role=dialog chat widget', want: 'STOP interrupt, no INSURANCE',
    html: `${L}<label>City <input id="c"></label>
      <div id="pop" role="dialog" style="display:none; position:fixed; left:10px; bottom:10px; width:320px; background:#fee; padding:10px">
        Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button onclick="this.parentNode.remove()">Maybe</button></div>
      <div id="chat" role="dialog" aria-label="Chat" style="position:fixed; right:10px; bottom:10px; width:200px; background:#eef; padding:10px">Need help? <button onclick="log('chat opened')">Chat with us</button></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 600);</script>`,
    seen: true, runs: [{ steps: [{ fill: 'City', value: 'Austin' }, { expect: { text: 'trip insurance', timeout: 3000 } }, { click: 'Confirm' }] }],
  },
  'foreign-small-unmarked': {
    what: 'timer corner box without any dialog role (small, fixed) holds the only Confirm', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed; right:10px; bottom:10px; width:320px; background:#fee; padding:10px'; d.innerHTML = 'Add trip insurance for $9.99? <button onclick="window.__log.push(\\'INSURANCE BOUGHT\\')">Confirm</button> <button>Maybe</button>'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false,
    steps: [{ fill: 'City', value: 'Austin' }, { click: 'Confirm' }],
  },
  'foreign-big-nested-unmarked': {
    what: 'timer full-screen unmarked overlay, fixed layer nested 2 levels inside the added node', want: 'STOP',
    html: `${L}<label>City <input id="c"></label><div id="root"><div id="app"></div></div>
      <script>setTimeout(() => { const d = document.createElement('div'); d.className = 'portal'; d.innerHTML = '<div class="wrap"><div style="position:fixed; inset:0; background:rgba(0,0,0,.5)"><div style="margin:100px auto; width:400px; background:#fff; padding:20px">Add trip insurance for $9.99? <button onclick="window.__log.push(\\'INSURANCE BOUGHT\\')">Confirm</button> <button>Maybe</button></div></div></div>'; document.getElementById('app').append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false,
    steps: [{ click: 'Confirm' }],
  },
  'foreign-big-unmarked-direct': {
    what: 'control: same overlay added directly to body (should be a floater)', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5)'; d.innerHTML = '<div style="margin:100px auto; width:400px; background:#fff; padding:20px">Add trip insurance for $9.99? <button onclick="window.__log.push(\\'INSURANCE BOUGHT\\')">Confirm</button> <button>Maybe</button></div>'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false,
    steps: [{ click: 'Confirm' }],
  },
  'foreign-class-toggle-deep': {
    what: 'overlay already in the page (deep in #root), switched on later by a class on an ancestor', want: 'STOP',
    html: `${L}<style>.ov{display:none} .show .ov{display:block; position:fixed; inset:0; background:rgba(0,0,0,.5)}</style><label>City <input id="c"></label>
      <div id="root"><div id="app"><div id="shell"><div class="ov"><div style="margin:100px auto; width:400px; background:#fff; padding:20px">Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button>Maybe</button></div></div></div></div></div>
      <script>setTimeout(() => { document.getElementById('shell').classList.add('show'); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false,
    steps: [{ click: 'Confirm' }],
  },
  'decline-drawer': {
    what: 'popups:decline; a notifications drawer (unmarked, fixed, 31% of window) with an invite covers the control', want: 'STOP, no DECLINED',
    html: `${L}<div style="margin-left:900px"><button onclick="log('saved')">Save</button></div>
      <div style="position:fixed; right:0; top:0; width:400px; height:100%; background:#eee; padding:10px"><h3>Notifications</h3><p>Sam Lee invited you to "Budget review" on Friday <button onclick="log('accepted')">Accept</button> <button onclick="log('INVITE DECLINED')">Decline</button></p></div>`,
    seen: true, popups: 'decline', steps: [{ click: 'Save' }],
  },
  'decline-approval-modal': {
    what: 'popups:decline; pre-existing aria-modal task dialog "Approve / Reject" covers the page', want: 'STOP, no REJECTED',
    html: `${L}<label>Note <input id="n"></label>
      <div role="dialog" aria-modal="true" style="position:fixed; inset:15%; background:#eee; padding:20px"><h3>Pending approval</h3>Expense #1 from Sam, $900 <button onclick="log('approved')">Approve</button> <button onclick="log('EXPENSE REJECTED')">Reject</button></div>`,
    seen: false, popups: 'decline', steps: [{ fill: 'Note', value: 'hi' }],
  },
  'confirm-same-name': {
    what: 'ORDINARY: row Delete opens an aria-modal confirm whose button is also "Delete"', want: 'OK (healthy page), deleted Bob only',
    html: `${L}<table><tr><td>Alice</td><td><button onclick="ask('Alice')">Delete</button></td></tr><tr><td>Bob</td><td><button onclick="ask('Bob')">Delete</button></td></tr></table><div id="m"></div>
      <script>function ask(n) { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.4)'; d.innerHTML = '<div style="margin:120px auto; width:360px; background:#fff; padding:20px">Delete ' + n + '? This cannot be undone. <button id="no">Cancel</button> <button id="yes">Delete</button></div>'; document.body.append(d); d.querySelector('#no').onclick = () => d.remove(); d.querySelector('#yes').onclick = () => { log('deleted ' + n); d.remove(); document.getElementById('m').textContent = n + ' was deleted'; }; }</script>`,
    seen: true, steps: [{ click: { text: 'Delete', near: 'Bob' } }, { click: 'Delete', expect: { text: 'Bob was deleted' } }],
  },
  'modal-form-email-behind': {
    what: 'ORDINARY: button opens a modal form with Email; the page footer has a newsletter Email too', want: 'OK',
    html: `${L}<button onclick="document.getElementById('dlg').showModal()">Invite member</button><div id="m"></div>
      <dialog id="dlg"><form method="dialog" onsubmit="log('invited ' + this.e.value); document.getElementById('m').textContent='Invitation sent'"><label>Email <input name="e"></label> <label>Role <select name="r"><option>Viewer</option><option>Editor</option></select></label> <button>Send invite</button></form></dialog>
      <footer style="margin-top:300px"><form onsubmit="log('NEWSLETTER ' + this.e.value); return false"><label>Email <input name="e"></label><button>Subscribe</button></form></footer>`,
    seen: true, steps: [{ click: 'Invite member' }, { fill: 'Email', value: 'layla@example.com' }, { select: 'Role', value: 'Editor' }, { click: 'Send invite', expect: { text: 'Invitation sent' } }],
  },
};
