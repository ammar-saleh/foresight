const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'near-flatgrid': {
    what: 'CSS grid of flat cells; Bob has no Remove', want: 'STOP, no removed',
    html: `${L}<h1>Team</h1><div style="display:grid; grid-template-columns: 200px 100px 100px; gap:6px">
      <span>Alice</span><span>member</span><button onclick="log('removed Alice')">Remove</button>
      <span>Bob</span><span>owner</span><span></span>
      <span>Carol</span><span>owner</span><span></span></div>`,
    steps: [{ click: { text: 'Remove', near: 'Bob' } }],
  },
  'near-sameline-chips': {
    what: 'chips on one line; only the first has a close button', want: 'STOP, no closed',
    html: `${L}<div class="tabs" style="display:flex; gap:8px">
      <div class="tab" style="border:1px solid #888; padding:4px">report.pdf <button aria-label="Close" onclick="log('closed report.pdf')">×</button></div>
      <div class="tab" style="border:1px solid #888; padding:4px">notes.txt</div></div>`,
    steps: [{ click: { label: 'Close', near: 'notes.txt' } }],
  },
  'near-sameline-cards': {
    what: 'two plan cards side by side, title and button on one line; Pro has no button', want: 'STOP',
    html: `${L}<div style="display:flex; gap:20px"><div class="plan"><b>Basic</b> <button onclick="log('chose Basic')">Choose</button></div><div class="plan"><b>Pro</b> <span>Sold out</span></div></div>`,
    steps: [{ click: { text: 'Choose', near: 'Pro' } }],
  },
  'near-br-lines': {
    what: 'lines separated by <br>; second line has no button', want: 'STOP',
    html: `${L}<p>Invoice 1001 (Alice Co) <button onclick="log('deleted 1001')">Delete</button><br>Invoice 1002 (Bob Ltd) paid<br>Invoice 1003</p>`,
    steps: [{ click: { text: 'Delete', near: 'Invoice 1002' } }],
  },
  'near-dl': {
    what: 'definition list: dt names, dd actions; Bob has no dd button', want: 'STOP',
    html: `${L}<dl><dt>Alice</dt><dd><button onclick="log('removed Alice')">Remove</button></dd><dt>Bob</dt><dd>owner</dd></dl>`,
    steps: [{ click: { text: 'Remove', near: 'Bob' } }],
  },
  'text-div-button': {
    what: 'div-based button "Delete all 53 items" with Delete in a span', want: 'STOP',
    html: `${L}<div class="btn" style="cursor:pointer; border:1px solid; display:inline-block; padding:6px" onclick="log('ALL 53 DELETED'); document.getElementById('d').textContent='Done'"><span>Delete</span> <small>all 53 items</small></div><div id="d"></div>`,
    steps: [{ click: 'Delete', risk: 'irreversible', expect: { text: 'Done' } }],
  },
  'text-div-menuitem': {
    what: 'div menu row "Cancel my subscription" with bold Cancel', want: 'STOP',
    html: `${L}<p>Manage plan</p><div class="menu-item" tabindex="0" style="cursor:pointer" onclick="log('SUBSCRIPTION CANCELLED')"><b>Cancel</b> my subscription</div>`,
    steps: [{ click: 'Cancel' }],
  },
  'text-li-onclick': {
    what: 'li rows with onclick: "Remove" strong inside "Remove all devices"', want: 'STOP',
    html: `${L}<ul><li style="cursor:pointer" onclick="log('ALL DEVICES REMOVED')"><strong>Remove</strong> <span>all devices</span></li></ul>`,
    steps: [{ click: 'Remove' }],
  },
  'aria-mismatch-input': {
    what: 'input[type=submit] value "Delete account" with aria-label "Save draft"', want: 'STOP',
    html: `${L}<form onsubmit="log('ACCOUNT DELETED'); return false"><input type="submit" aria-label="Save draft" value="Delete account"></form>`,
    steps: [{ click: 'Save draft' }],
  },
  'aria-mismatch-title': {
    what: 'role=button div title "Save" visible "Discard changes"', want: 'STOP',
    html: `${L}<div role="button" tabindex="0" title="Save" onclick="log('DISCARDED')">Discard changes</div>`,
    steps: [{ click: 'Save' }],
  },
  'aria-mismatch-switch': {
    what: 'role=switch aria-label "Email me updates" visible text "Share my data with partners"', want: 'STOP',
    html: `${L}<div role="switch" aria-checked="false" aria-label="Email me updates" tabindex="0" onclick="this.setAttribute('aria-checked','true'); log('SHARING ON')">Share my data with partners</div>`,
    steps: [{ check: 'Email me updates' }],
  },
  'aria-superset': {
    what: 'ordinary accessible button: visible "Delete", aria-label "Delete invoice 1002"; plan uses the name the look shows', want: 'OK (healthy page)',
    html: `${L}<table><tr><td>Invoice 1001</td><td><button aria-label="Delete invoice 1001" onclick="log('deleted 1001')">Delete</button></td></tr><tr><td>Invoice 1002</td><td><button aria-label="Delete invoice 1002" onclick="log('deleted 1002')">Delete</button></td></tr></table>`,
    steps: [{ click: 'Delete invoice 1002' }],
    probe: () => window.__FS.observe().controls,
  },
};
