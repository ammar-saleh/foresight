const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
export const CASES = {
  'frame-blocked-parent-dialog': {
    what: 'a step inside a frame is blocked by something small in the frame; the host page has an unrelated dialog with Cancel',
    html: `${L}<h1>Host</h1>
      <div role="dialog" style="position:fixed; right:10px; bottom:10px; width:300px; background:#eee; padding:10px">Export in progress: 80% <button onclick="log('HOST EXPORT CANCELLED')">Cancel</button></div>
      <iframe style="width:500px;height:200px" srcdoc="<div style='position:relative;width:200px;height:30px'><input aria-label='Note' id='n'><div style='position:absolute;inset:0;background:rgba(255,255,255,.5)'>...</div></div>"></iframe>`,
    steps: [{ fill: 'Note', value: 'hi', frame: 1 }],
  },
  'dup-option': {
    what: 'two options with the same text under different groups',
    html: `${L}<label for="s">Shipping</label><select id="s"><option value="">Choose</option><optgroup label="Economy carrier"><option value="eco-std">Standard</option></optgroup><optgroup label="Premium carrier ($40)"><option value="prem-std">Standard</option></optgroup></select>`,
    steps: [{ select: 'Shipping', value: 'Standard' }],
    probe: () => document.getElementById('s').value,
  },
  'unmarked-popup': {
    what: 'pop-up layer with no dialog role holds the only control with the planned name',
    html: `${L}<label>City <input id="c"></label> <label>Email address for the receipt <input id="pe"></label>
      <div id="pop" style="position:fixed; right:10px; bottom:10px; width:320px; background:#fee; padding:10px"><b>Get 10% off</b>
        <form onsubmit="log('NEWSLETTER signup: ' + this.e.value); return false"><label>Email <input name="e"></label><button>Continue</button></form></div>`,
    steps: [{ fill: 'City', value: 'Austin' }, { fill: 'Email', value: 'layla@example.com' }, { click: 'Continue' }],
    probe: () => document.getElementById('pe').value,
  },
  'aria-mismatch': {
    what: 'a control whose aria-label differs from what it visibly says',
    html: `${L}<button aria-label="Save draft" onclick="log('ACCOUNT DELETED')">Delete account</button>`,
    steps: [{ click: 'Save draft' }],
  },
};
