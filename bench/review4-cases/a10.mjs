const L = `<script>window.__log = []; const log = (x) => window.__log.push(x);</script>`;
const form = `<form id="f" onsubmit="event.preventDefault(); log('added ' + this.cat.value + ' ' + this.amt.value + ' ' + this.bill.checked); const li = document.createElement('li'); li.textContent = this.cat.value + ' ' + this.amt.value; document.getElementById('l').append(li); this.reset()">
      <label>Category <select name="cat"><option value="">Choose...</option><option>Food</option><option>Travel</option></select></label>
      <label>Amount <input name="amt"></label> <label><input type="checkbox" name="bill"> Billable</label> <button>Add expense</button></form><ul id="l"></ul>
      <button type="button" onclick="log('report saved'); document.getElementById('s').textContent='Report saved'">Save report</button><div id="s"></div>`;
const steps = [{ select: 'Category', value: 'Food' }, { fill: 'Amount', value: '12' }, { check: 'Billable' }, { click: 'Add expense', expect: { text: 'Food 12' } }, { click: 'Save report', expect: { text: 'Report saved' } }];
export const CASES = {
  'reset-after-add-resume': {
    what: 'ORDINARY: expense form reset by its own Add button; stop; then resume from the stopped step as told', want: 'second run OK',
    html: `${L}${form}`,
    runs: [{ steps }, { steps, from: 4 }, { steps, from: 4 }],
  },
  'haspopup-button-pick': {
    what: 'ORDINARY: listbox button (button[aria-haspopup=listbox]) used with pick', want: 'OK',
    html: `${L}<style>[role=option]{cursor:pointer;padding:2px 12px}</style><span id="lb">Category</span>
      <button id="cb" aria-haspopup="listbox" aria-labelledby="lb cb" aria-expanded="false" onclick="const l = document.getElementById('lst'); l.hidden = !l.hidden; this.setAttribute('aria-expanded', String(!l.hidden))">Choose</button>
      <ul id="lst" role="listbox" hidden style="position:absolute; background:#fff; border:1px solid"><li role="option" onclick="log('chose food')">Food</li><li role="option" onclick="log('chose travel'); document.getElementById('cb').textContent='Travel'; this.parentNode.hidden=true">Travel</li></ul>`,
    steps: [{ pick: 'Category', value: 'Travel' }],
    probe: () => window.__FS.observe().controls,
  },
};
