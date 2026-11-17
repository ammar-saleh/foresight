const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'slow-confirm': {
    what: 'ORDINARY: the plan\'s click opens its confirm dialog after a 2 s server check; next step answers it', want: 'OK',
    html: `${L}<button onclick="setTimeout(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.style.cssText = 'position:fixed; inset:20%; background:#eee; padding:20px'; d.innerHTML = 'Archive project Apollo? <button id=y>Archive now</button> <button id=n>Keep</button>'; document.body.append(d); d.querySelector('#y').onclick = () => { window.__log.push('archived'); d.remove(); document.getElementById('m').textContent = 'Project archived'; }; }, 2000)">Archive project</button><div id="m"></div>`,
    steps: [{ click: 'Archive project' }, { click: 'Archive now', expect: { text: 'Project archived' } }],
  },
  'recipe-dialog-answer': {
    what: 'recipe replay (forgetSeen): the saved plan itself answers the consent dialog that is open at start', want: 'OK',
    html: `${L}<label>Name <input id="n"></label><div role="dialog" aria-modal="true" style="position:fixed; inset:10%; background:#eee">We use cookies. <button onclick="log('accepted')">Accept all</button> <button onclick="log('rejected'); this.parentNode.remove()">Reject all</button></div>`,
    forget: true, steps: [{ click: 'Reject all' }, { fill: 'Name', value: 'Layla' }],
  },
  'escape-inline-hint': {
    what: 'inline editor (Escape discards it) shows an absolute hint while typing that covers the Add button', want: 'no EDIT DISCARDED, or stop after it',
    html: `${L}<div id="ed" style="position:relative"><input aria-label="Card title" id="s" oninput="document.getElementById('hint').style.display='block'" onkeydown="if (event.key === 'Escape') { log('EDIT DISCARDED'); document.getElementById('ed').innerHTML = 'Add a card'; }">
        <div id="hint" style="display:none; position:absolute; left:0; top:22px; width:300px; height:40px; background:#ffd">Press Enter to save</div></div>
      <div style="height:30px"><button id="go" onclick="log('card added with title [' + (document.getElementById('s') ? document.getElementById('s').value : '') + ']')">Add card</button></div>`,
    steps: [{ fill: 'Card title', value: 'Call the bank' }, { click: 'Add card' }],
  },
  'escape-modal-form': {
    what: 'date field in a native <dialog> form leaves a calendar (absolute) over Save; Escape would close the dialog and lose the form', want: 'no DIALOG CLOSED',
    html: `${L}<button onclick="document.getElementById('dlg').showModal()">New event</button>
      <dialog id="dlg" onclose="log('DIALOG CLOSED, form lost')"><div style="position:relative"><label>Title <input id="t"></label><br><label>Date <input id="d" onfocus="document.getElementById('cal').style.display='block'"></label>
        <div id="cal" style="display:none; position:absolute; left:0; top:44px; width:260px; height:120px; background:#ddf">calendar</div><br><button onclick="log('saved ' + document.getElementById('t').value + ' ' + document.getElementById('d').value)">Save event</button></div></dialog>`,
    steps: [{ click: 'New event' }, { fill: 'Title', value: 'Standup' }, { fill: 'Date', value: '2026-12-01' }, { click: 'Save event' }],
  },
  'type-newline': {
    what: '"type" with a newline commits like Enter without re-reading the fields', want: 'STOP before sending',
    html: `${L}<label>Amount <input id="a"></label> <label>Note <input id="n" onfocus="document.getElementById('a').value='999'" onkeydown="if (event.key === 'Enter') log('SENT amount=' + document.getElementById('a').value)"></label>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Note' }, { type: 'thanks\n' }],
  },
  'keys-enter-control': {
    what: 'control for the above with keys Enter', want: 'STOP',
    html: `${L}<label>Amount <input id="a"></label> <label>Note <input id="n" onfocus="document.getElementById('a').value='999'" onkeydown="if (event.key === 'Enter') log('SENT amount=' + document.getElementById('a').value)"></label>`,
    steps: [{ fill: 'Amount', value: '50' }, { click: 'Note' }, { type: 'thanks' }, { keys: 'Enter' }],
  },
  'big-page': {
    what: 'ORDINARY: 4000-row table (36k elements), click a plain-text cell, then pick', want: 'OK, reasonable time',
    html: `${L}<table>${Array.from({ length: 4000 }, (_, i) => `<tr><td>Row ${i}</td><td>a${i}</td><td>b${i}</td><td><span>c${i}</span></td><td><button onclick="log('open ${i}')">Open ${i}</button></td></tr>`).join('')}</table><div onclick="log('plain text clicked')">Load more rows</div>`,
    steps: [{ click: 'Load more rows' }, { click: 'Open 3999' }],
  },
  'upload-wrong-name': {
    what: 'the only upload field is "Photo ID (passport)"; plan uploads to "Photo"', want: 'STOP',
    html: `${L}<label>Photo ID (passport) <input type="file" id="f" onchange="log('UPLOADED to id field: ' + this.files[0].name)"></label>`,
    steps: [{ upload: 'Photo', file: 'results/upload-sample.txt' }],
  },
  'dblclick-covered': {
    what: 'dblclick target named exactly, inside a pop-up nobody was shown (timer, role=dialog)', want: 'STOP',
    html: `${L}<p>Files</p><div id="pop" role="dialog" style="display:none; position:fixed; right:10px; bottom:10px; width:300px; background:#fee">Restore deleted file? <span ondblclick="log('RESTORED')" style="cursor:pointer">report.pdf</span></div>
      <script>setTimeout(() => { document.getElementById('pop').style.display = 'block'; }, 700);</script>`,
    early: true, waitBefore: 1500, seen: false, steps: [{ dblclick: 'report.pdf' }],
  },
  'drag-covered': {
    what: 'drag source under a full-window overlay (timer): the raw mouse press lands on the overlay', want: 'STOP, no OVERLAY pressed',
    html: `${L}<div id="a" draggable="true" style="width:100px;height:40px;background:#cfc">Task A</div><div id="b" style="width:200px;height:100px;background:#ccf; margin-top:20px">Done</div>
      <div id="ov" style="position:fixed; inset:0; background:rgba(0,0,0,.3)" onmousedown="log('OVERLAY got the press')" onmouseup="log('OVERLAY got the release')">Special offer</div>`,
    steps: [{ drag: 'Task A', to: 'Done' }],
  },
};
