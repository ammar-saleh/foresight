const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
const FILL = `<div style="width:1000px">${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>'.repeat(30)}</div>`;
const pop = `Add trip insurance for $9.99? <button onclick="window.__log.push(\\'INSURANCE BOUGHT\\')">Confirm</button> <button>Maybe</button>`;
export const CASES = {
  'fl-direct-content': {
    what: 'full-screen unmarked overlay appended to body by a timer; page has content under it', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>${FILL}
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5)'; d.innerHTML = '<div style="margin:100px auto; width:400px; background:#fff; padding:20px">${pop}</div>'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'fl-direct-short-page': {
    what: 'same overlay; the page is short (nothing under the middle of the window)', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.5)'; d.innerHTML = '<div style="margin:100px auto; width:400px; background:#fff; padding:20px">${pop}</div>'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'fl-nested-content': {
    what: 'overlay whose fixed layer is 2 levels inside the node the page adds (portal > wrapper > fixed); content under it', want: 'STOP',
    html: `${L}<label>City <input id="c"></label><div id="root"><div id="app">${FILL}</div></div>
      <script>setTimeout(() => { const d = document.createElement('div'); d.className = 'portal'; d.innerHTML = '<div class="wrap"><div style="position:fixed; inset:0; background:rgba(0,0,0,.5)"><div style="margin:100px auto; width:400px; background:#fff; padding:20px">${pop}</div></div></div>'; document.getElementById('app').append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'fl-class-deep-content': {
    what: 'overlay in the page from the start, deep in #root, switched on by a class on an ancestor; content under it', want: 'STOP',
    html: `${L}<style>.ov{display:none} .show .ov{display:block; position:fixed; inset:0; background:rgba(0,0,0,.5)}</style><label>City <input id="c"></label>
      <div id="root"><div id="app"><div id="shell">${FILL}<div class="ov"><div style="margin:100px auto; width:400px; background:#fff; padding:20px">Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button>Maybe</button></div></div></div></div></div>
      <script>setTimeout(() => { document.getElementById('shell').classList.add('show'); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'fl-small-content': {
    what: 'small unmarked corner box (4% of the window) added by a timer; content under it', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>${FILL}
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed; right:10px; bottom:10px; width:320px; background:#fee; padding:10px'; d.innerHTML = '${pop}'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'fl-absolute-content': {
    what: 'timer overlay that is position:absolute (covers the whole document) instead of fixed', want: 'STOP',
    html: `${L}<label>City <input id="c"></label>${FILL}
      <script>setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,.5)'; d.innerHTML = '<div style="margin:100px auto; width:400px; background:#fff; padding:20px">${pop}</div>'; document.body.append(d); }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ click: 'Confirm' }],
  },
  'foreign-not-top-cli': {
    what: 'CLI-like: seen chat widget (role=dialog) last in DOM; timer pop-up role=dialog earlier in DOM', want: 'STOP interrupt',
    html: `${L}<label>City <input id="c"></label>
      <div id="pop" role="dialog" style="display:none; position:fixed; left:10px; bottom:10px; width:320px; background:#fee; padding:10px">
        Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button onclick="this.parentNode.remove()">Maybe</button></div>
      <div id="chat" role="dialog" aria-label="Chat" style="position:fixed; right:10px; bottom:10px; width:200px; background:#eef; padding:10px">Need help? <button onclick="log('chat opened')">Chat with us</button></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ fill: 'City', value: 'Austin' }, { click: 'Confirm' }],
  },
  'foreign-two-popups': {
    what: 'two timer pop-ups (both role=dialog, neither seen): cookie bar last in DOM, insurance offer first', want: 'STOP interrupt',
    html: `${L}<label>City <input id="c"></label>
      <div id="pop" role="dialog" style="display:none; position:fixed; left:10px; bottom:80px; width:320px; background:#fee; padding:10px">
        Add trip insurance for $9.99? <button onclick="log('INSURANCE BOUGHT')">Confirm</button> <button onclick="this.parentNode.remove()">Maybe</button></div>
      <div id="ck" role="dialog" aria-label="Cookies" style="display:none; position:fixed; left:0; right:0; bottom:0; height:50px; background:#eef; padding:10px">We use cookies <button onclick="log('cookies ok')">OK</button></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; document.getElementById('ck').style.display = 'block'; }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ fill: 'City', value: 'Austin' }, { click: 'Confirm' }],
  },
};
