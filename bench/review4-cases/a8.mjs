const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
const dlgBtn = (label) => `setTimeout(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.style.cssText = 'position:fixed; inset:20%; background:#eee; padding:20px'; d.innerHTML = 'Archive project Apollo? <button id=y>${label}</button> <button id=n>Keep</button>'; document.body.append(d); d.querySelector('#y').onclick = () => { window.__log.push('archived'); d.remove(); document.getElementById('m').textContent = 'Project archived'; }; }, DELAY)`;
export const CASES = {
  'slow-confirm-2s-noname': {
    what: 'ORDINARY: confirm dialog appears 2 s after the plan\'s click; nothing else resembles its button', want: 'OK',
    html: `${L}<button onclick="${dlgBtn('Yes, go ahead').replace('DELAY', '2000')}">Archive project</button><div id="m"></div>`,
    steps: [{ click: 'Archive project' }, { click: 'Yes, go ahead', expect: { text: 'Project archived' } }],
  },
  'slow-confirm-800ms-similar': {
    what: 'ORDINARY: confirm dialog appears 0.8 s after the click; its button shares a word with a page button', want: 'OK',
    html: `${L}<button onclick="${dlgBtn('Archive now').replace('DELAY', '800')}">Archive project</button><div id="m"></div>`,
    steps: [{ click: 'Archive project' }, { click: 'Archive now', expect: { text: 'Project archived' } }],
  },
  'recipe-dialog-answer': {
    what: 'recipe replay (forgetSeen, not seen): the saved plan itself answers the consent dialog open at start', want: 'OK',
    html: `${L}<label>Name <input id="n"></label><div role="dialog" aria-modal="true" style="position:fixed; inset:10%; background:#eee">We use cookies. <button onclick="log('accepted')">Accept all</button> <button onclick="log('rejected'); this.parentNode.remove()">Reject all</button></div>`,
    forget: true, seen: false, steps: [{ click: 'Reject all' }, { fill: 'Name', value: 'Layla' }],
  },
  'type-newline': {
    what: '"type" with a newline commits like Enter without re-reading the fields', want: 'STOP before sending',
    html: `${L}<label>Amount <input id="a"></label> <label>Note <input id="n" oninput="document.getElementById('a').value='999'" onkeydown="if (event.key === 'Enter') log('SENT amount=' + document.getElementById('a').value)"></label>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Note' }, { type: 'thanks\n' }],
  },
  'keys-enter-control': {
    what: 'control for the above with keys Enter', want: 'STOP',
    html: `${L}<label>Amount <input id="a"></label> <label>Note <input id="n" oninput="document.getElementById('a').value='999'" onkeydown="if (event.key === 'Enter') log('SENT amount=' + document.getElementById('a').value)"></label>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Note' }, { type: 'thanks' }, { keys: 'Enter' }],
  },
  'drag-overlay-button': {
    what: 'drag while a full-window offer (one big button) is over the page: do the raw press and release click it?', want: 'STOP, no ACCEPTED',
    html: `${L}<div id="a" draggable="true" style="width:100px;height:40px;background:#cfc">Task A</div><div id="b" style="width:200px;height:100px;background:#ccf; margin-top:20px">Done</div>
      <button id="ov" style="position:fixed; left:0; top:0; width:100%; height:100%; opacity:.4" onclick="log('OFFER ACCEPTED by click')">Accept offer and subscribe</button>`,
    steps: [{ drag: 'Task A', to: 'Done' }],
  },
  'expand-nameless-trash': {
    what: 'tree row: label expands on click; the only small nameless pointer mark is an unlabeled trash icon', want: 'no DELETED',
    html: `${L}<ul role="tree"><li role="treeitem" aria-expanded="false" id="n">
      <span onclick="const n = document.getElementById('n'); n.setAttribute('aria-expanded','true'); document.getElementById('kids').hidden = false">Projects</span>
      <i class="icon-trash" style="cursor:pointer; display:inline-block; width:16px; height:16px; background:#c00" onclick="log('FOLDER DELETED')"></i><ul id="kids" hidden><li>Alpha</li></ul></li></ul>`,
    steps: [{ expand: 'Projects' }],
  },
  'frame-scaled': {
    what: 'ORDINARY: control inside an iframe that is scaled with CSS transform', want: 'OK',
    html: `${L}<h1>Host</h1><iframe style="width:600px;height:300px;border:0; transform:scale(.6); transform-origin:0 0" srcdoc="<body style='margin:0'><div style='height:120px'></div><button style='margin-left:200px' onclick=&quot;parent.__log.push('frame Save clicked')&quot;>Save</button></body>"></iframe>`,
    steps: [{ click: 'Save', frame: 1 }],
  },
  'frame-padded': {
    what: 'ORDINARY: control inside an iframe that has CSS padding and a border', want: 'OK',
    html: `${L}<h1>Host</h1><iframe style="width:600px;height:300px;border:10px solid #ccc; padding:40px" srcdoc="<body style='margin:0'><button onclick=&quot;parent.__log.push('frame Save clicked')&quot;>Save</button><br><button onclick=&quot;parent.__log.push('FRAME DELETE clicked')&quot; style='margin-top:20px'>Delete</button></body>"></iframe>`,
    steps: [{ click: 'Save', frame: 1 }],
  },
};
