// Abilities suite: one page per kind of interaction that is hard for automation (shadow DOM, uploads, drag and
// drop, rich text, endless lists, canvas, right-click menus, new tabs, hover menus, custom dropdowns, native pickers).
// Each case must end in the true state the task asked for, or stop where stopping is the right answer.
// Usage: node bench/abilities.mjs [runs=3]      (needs the local test server on :4600)
import path from 'node:path';
import { chromium } from 'playwright-core';
import './sample.mjs';
import { Foresight } from '../engine/foresight.js';

const RUNS = Number(process.argv[2] || 3);
const only = process.argv[3]?.split(',');
const BASE = process.env.BASE || 'http://localhost:4600';
const FILE = path.resolve('results/upload-sample.txt');
const DONE = 'finish', STOP = 'stop';
const st = (p) => p.evaluate(() => window.__state);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CASES = [
  { name: 'shadow', what: 'field and button inside nested shadow roots, with a look-alike outside', want: DONE,
    steps: [{ fill: 'Nickname', value: 'Zed' }, { click: 'Apply', expect: { text: 'Applied: Zed' } }], check: async (p) => (await st(p)).applied === 'Zed' },
  { name: 'upload', what: 'attach a file, then submit', want: DONE,
    steps: [{ upload: 'Resume', file: FILE }, { click: 'Upload', expect: { text: 'Uploaded: upload-sample.txt' } }], check: async (p) => (await st(p)).file?.name === 'upload-sample.txt' },
  { name: 'upload', label: 'upload-missing', what: 'the file to attach does not exist', want: STOP,
    steps: [{ upload: 'Resume', file: path.resolve('results/no-such-file.pdf') }], check: async (p) => !(await st(p)).file },
  { name: 'drag', what: 'native drag and drop between columns', want: DONE,
    steps: [{ drag: 'Task B', to: 'Done' }, { drag: 'Task A', to: 'Done' }], check: async (p) => eq((await st(p)).done, ['Task B', 'Task A']) },
  { name: 'sort', what: 'pointer-driven reordering', want: DONE,
    steps: [{ drag: 'One', to: 'Four' }], check: async (p) => eq((await st(p)).order, ['Two', 'Three', 'One', 'Four', 'Five']) },
  { name: 'rich', what: 'rich-text editor that rejects scripted text', want: DONE,
    steps: [{ fill: 'Message body', value: 'hello there' }, { click: 'Send', expect: { text: 'Sent: hello there' } }], check: async (p) => (await st(p)).sent === 'hello there' },
  { name: 'infinite', what: 'item far down a list that loads as you scroll', want: DONE,
    steps: [{ scroll: 'down', expect: { text: 'Item 137' } }, { click: 'Item 137', expect: { text: 'Opened item 137' } }], check: async (p) => (await st(p)).opened === 137 },
  { name: 'canvas', what: 'drawn buttons with no page structure: click by position', want: DONE,
    steps: [{ clickAt: { css: 'canvas', x: 240, y: 100 }, expect: { text: 'Clicked: Green' } }], check: async (p) => (await st(p)).clicked === 'Green' },
  { name: 'context', what: 'right-click menu', want: DONE,
    steps: [{ rightclick: 'Notes.txt' }, { click: 'Rename', expect: { text: 'Renaming Notes.txt' } }], check: async (p) => eq((await st(p)).action, { file: 'Notes.txt', action: 'rename' }) },
  { name: 'newtab', what: 'link that opens a new tab; the task continues there', want: DONE,
    steps: [{ click: 'Open report' }, { click: 'Acknowledge', expect: { text: 'Acknowledged' } }], check: async (p) => (await st(p)).ack === true },
  { name: 'hovermenu', what: 'menu item that only exists while hovering', want: DONE,
    steps: [{ hover: 'Account' }, { click: 'Settings', expect: { text: 'Settings opened' } }], check: async (p) => (await st(p)).opened === 'settings' },
  { name: 'hovermenu', label: 'hovermenu-auto', what: 'same, but the plan forgets to hover', want: DONE,
    steps: [{ click: 'Settings', expect: { text: 'Settings opened' } }], check: async (p) => (await st(p)).opened === 'settings' },
  { name: 'combo', what: 'two look-alike custom dropdowns', want: DONE,
    steps: [{ pick: 'Country', value: 'Canada' }, { pick: 'Language', value: 'Arabic' }], check: async (p) => { const s = await st(p); return s.country === 'Canada' && s.language === 'Arabic'; } },
  { name: 'native', what: 'date, time, slider, colour and number fields', want: DONE,
    steps: [{ fill: 'Start date', value: '2026-12-01' }, { fill: 'Start time', value: '09:30' }, { fill: 'Volume', value: '7' }, { fill: 'Accent colour', value: '#ff0000' }, { fill: 'Seats', value: '4' }, { click: 'Save', expect: { text: 'Saved' } }],
    check: async (p) => eq((await st(p)).saved, { date: '2026-12-01', time: '09:30', volume: '7', colour: '#ff0000', seats: '4' }) },
  { name: 'textarea-limit', what: 'value longer than the field allows', want: STOP,
    steps: [{ fill: 'Short note', value: 'this note is much longer than twenty characters' }, { click: 'Save' }], check: async (p) => !(await st(p)).note },
  { name: 'delayed-text', what: 'result arrives after the plan stops waiting, with no feedback: must not click twice', want: STOP,
    steps: [{ click: 'Generate', expect: { text: 'Your code is', timeout: 1200 } }], check: async () => true },
  { name: 'delayed-text', label: 'delayed-text-wait', what: 'same, with a long enough wait', want: DONE,
    steps: [{ click: 'Generate', expect: { text: 'Your code is', timeout: 6000 } }, { read: 'Your code is' }], check: async (p, r) => (await st(p)).code === '7391' && /7391/.test(JSON.stringify(r.reads)) },
  // ---- patterns from real job-application forms (site/apply.html) ----
  // two upload fields whose buttons are both called "Attach"; the page swaps the input for the file's name and "Remove file"
  { name: 'attach', page: 'apply.html', label: 'attach-near', what: 'two "Attach" uploads: the one near "Resume/CV"', want: DONE,
    steps: [{ upload: { label: 'Attach', near: 'Resume/CV' }, file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-nth', what: 'two "Attach" uploads: the second', want: DONE,
    steps: [{ upload: { label: 'Attach', nth: 2 }, file: FILE }], check: async (p) => eq((await st(p)).files, { cover_letter: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-heading', what: 'an upload named by the heading of its section', want: DONE,
    steps: [{ upload: 'Cover Letter', file: FILE }], check: async (p) => eq((await st(p)).files, { cover_letter: 'upload-sample.txt' }) },
  { name: 'attach', page: 'apply.html', label: 'attach-both', what: 'both uploads, one after the other, with the same file', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }, { upload: { label: 'Attach', near: 'Cover Letter' }, file: FILE }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Attached:' } }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt', cover_letter: 'upload-sample.txt' }) && (await p.textContent('#out')).includes('cover_letter') },
  { name: 'attach', page: 'apply.html', label: 'attach-bare', what: 'two "Attach" uploads and no hint: not for the engine to choose', want: STOP,
    steps: [{ upload: 'Attach', file: FILE }], check: async (p, r) => eq((await st(p)).files, {}) && r.failed?.status === 'lowconf' },
  { name: 'attach', page: 'apply.html', label: 'attach-far', what: 'a hint that fits neither upload', want: STOP,
    steps: [{ upload: { label: 'Attach', near: 'Portfolio' }, file: FILE }], check: async (p) => eq((await st(p)).files, {}) },
  { name: 'attach-plain', page: 'apply.html', label: 'attach-plain', what: 'the same without any group markup: heading, then "near"', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }, { upload: { label: 'Attach', near: 'Cover Letter' }, file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt', cover_letter: 'upload-sample.txt' }) },
  { name: 'attach-slow', page: 'apply.html', what: 'the file name shows up a moment after the input is gone', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-keep', page: 'apply.html', what: 'the page empties the input and shows a chip with a remove button', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-icon', page: 'apply.html', what: 'the input is replaced by "Remove file" only, no file name', want: DONE,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p) => eq((await st(p)).files, { resume: 'upload-sample.txt' }) },
  { name: 'attach-reject', page: 'apply.html', what: 'the page refuses the file and names it in an error: that is not an upload', want: STOP,
    steps: [{ upload: 'Resume/CV', file: FILE }], check: async (p, r) => eq((await st(p)).files, {}) && r.failed?.status === 'verify-failed' },
  // upload buttons with no file field behind them
  { name: 'chooser', page: 'apply.html', what: 'the page has no file field until the button is pressed: the file goes to the chooser it opens', want: DONE,
    steps: [{ upload: 'Upload photo', file: FILE }], check: async (p, r) => eq((await st(p)).files, { photo: 'upload-sample.txt' }) && r.notes.some((n) => /file chooser/.test(n)) },
  { name: 'chooser-two', page: 'apply.html', what: 'two nameless hidden file fields, each behind a named button', want: DONE,
    steps: [{ upload: 'Upload ID', file: FILE }], check: async (p) => eq((await st(p)).files, { id: 'upload-sample.txt' }) },
  { name: 'chooser-none', page: 'apply.html', what: 'a button called "Upload" that opens the page\'s own box: pressed once, then the run stops and says so', want: STOP,
    steps: [{ upload: 'Upload', file: FILE }], check: async (p, r) => eq((await st(p)).files, {}) && (await st(p)).boxOpened === true && r.failed?.status === 'timeout' && r.failed?.acted === true },
  { name: 'chooser', page: 'apply.html', label: 'chooser-click', what: 'a plain click that opens a file chooser: the result says to use "upload"', want: DONE,
    steps: [{ click: 'Upload photo' }], check: async (p, r) => eq((await st(p)).files, {}) && r.warnings.some((w) => /file chooser/.test(w)) },
  // suggestions with a main text and a second line
  { name: 'places', page: 'apply.html', what: 'suggestions "Paris / France", "Parma / Italy": "Paris" names exactly one of them', want: DONE,
    steps: [{ pick: 'City', value: 'Paris', typeText: 'Par' }, { click: 'Search', risk: 'irreversible', expect: { text: 'Searching:' } }], check: async (p, r) => (await st(p)).sent === 'paris-fr' && r.notes.some((n) => /the field shows "Paris, France"/.test(n)) },
  { name: 'places-inline', page: 'apply.html', what: 'the same with both texts on one line of running text', want: DONE,
    steps: [{ pick: 'City', value: 'Paris', typeText: 'Par' }, { click: 'Search', risk: 'irreversible', expect: { text: 'Searching:' } }], check: async (p, r) => (await st(p)).sent === 'paris-fr' && r.notes.some((n) => /only one that starts with it/.test(n)) },
  { name: 'places-two', page: 'apply.html', what: 'two places called Paris: not for the engine to choose; the result lists both', want: STOP,
    steps: [{ pick: 'City', value: 'Paris', typeText: 'Par' }], check: async (p, r) => !(await st(p)).place && r.failed?.status === 'verify-failed' && (r.failed?.options || []).length === 2 },
  { name: 'places-two', page: 'apply.html', label: 'places-full', what: 'the same, naming the one that is meant by its whole line', want: DONE,
    steps: [{ pick: 'City', value: 'Paris Texas, USA', typeText: 'Par' }], check: async (p) => (await st(p)).place === 'paris-tx' },
  // a phone-country picker that shows only a flag and the dial code once chosen
  { name: 'phone-code', page: 'apply.html', what: 'the chosen country is shown as a flag and "+1" only', want: DONE,
    steps: [{ pick: 'Country', value: 'United States +1', typeText: 'United States' }, { fill: 'Phone', value: '3135550142' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p) => eq((await st(p)).sent, { country: 'us', phone: '3135550142' }) },
  { name: 'phone-flag', page: 'apply.html', what: 'a flag button that opens a list and collapses back into a flag', want: DONE,
    steps: [{ pick: 'Select country', value: 'United States' }, { fill: 'Phone', value: '3135550142' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p) => eq((await st(p)).sent, { country: 'us', phone: '3135550142' }) },
  { name: 'phone-flag', page: 'apply.html', label: 'phone-flag-code', what: 'the same, naming the choice with its dial code', want: DONE,
    steps: [{ pick: 'Select country', value: 'Jordan +962' }], check: async (p) => (await st(p)).country === 'jo' },
  // "pick" on a text box that offers no suggestions at all
  { name: 'plain', page: 'apply.html', label: 'pick-plain', what: '"pick" on a plain text field: typed in like "fill", with a warning, without a long wait', want: DONE,
    steps: [{ pick: 'Have you previously been employed by Acme or an Acme subsidiary?', value: 'No' }, { click: 'Submit application', risk: 'irreversible', expect: { text: 'Sent:' } }], check: async (p, r) => (await st(p)).sent?.answer === 'No' && r.warnings.some((w) => /plain text field/.test(w)) && r.ms < 3500 },
  { name: 'plain', page: 'apply.html', label: 'pick-keys', what: 'a plain-looking field whose list answers real keys only: still picked from the list', want: DONE,
    steps: [{ pick: 'City', value: 'Amsterdam', typeText: 'Ams' }], check: async (p) => (await st(p)).city === 'Amsterdam' },
  { name: 'keys-slow', page: 'apply.html', label: 'pick-keys-slow', what: 'the same, with a list that asks the server and takes its time', want: DONE,
    steps: [{ pick: 'City', value: 'Amsterdam', typeText: 'Ams' }], check: async (p) => (await st(p)).city === 'Amsterdam' },
  // ---- everyday web pages (site/web.html): things that tripped the engine on real sites
  { name: 'sidebar', page: 'web.html', what: 'a side bar pinned beside the page after it loads is not a pop-up', want: DONE,
    steps: [{ expect: { text: 'Docs menu' } }, { fill: 'Title', value: 'Notes' }, { click: 'Save', expect: { text: 'Saved' } }], check: async (p, r) => (await st(p)).saved === 'Notes' && !r.repairs.length },
  { name: 'calendar', page: 'web.html', what: 'a date field whose calendar opens on the press, over the field itself', want: DONE,
    steps: [{ click: 'Date' }, { click: '15', expect: { label: 'Date' } }], check: async (p, r) => (await st(p)).opened === 1 && (await st(p)).date === 15 && r.notes.some((n) => /opened something over/.test(n)) },
  { name: 'menurow', page: 'web.html', what: 'a menu row and the link inside it say the same: one target', want: DONE,
    steps: [{ click: 'Reports', expect: { text: 'Reports opened' } }], check: async (p) => (await st(p)).opened === 'reports' },
  { name: 'menurow', page: 'web.html', label: 'menurow-sub', what: 'a submenu that opens a moment after the pointer arrives', want: DONE,
    steps: [{ hover: 'Export' }, { click: 'CSV', expect: { text: 'Exported as CSV' } }], check: async (p) => (await st(p)).exported === 'CSV' },
  { name: 'menurow', page: 'web.html', label: 'menurow-hover2', what: 'hovering an item of that submenu right after opening it', want: DONE,
    steps: [{ hover: 'Export' }, { hover: 'PDF' }, { click: 'PDF', expect: { text: 'Exported as PDF' } }], check: async (p) => (await st(p)).exported === 'PDF' },
  { name: 'fading', page: 'web.html', what: 'a tip over the button is still fading out when the next step comes', want: DONE,
    steps: [{ click: 'Got it' }, { click: 'Continue', expect: { text: 'Next step' } }], check: async (p) => (await st(p)).went === 1 },
  { name: 'labelbox', page: 'web.html', what: 'a menu button drawn as a label, with its see-through tick box over it', want: DONE,
    steps: [{ click: 'Tools', expect: { text: 'Page information' } }], check: async (p) => (await st(p)).open === true },
  { name: 'tree', page: 'web.html', what: 'a tree row whose handler sits on an inner part of the row', want: DONE,
    steps: [{ expand: 'Data Grid' }, { expect: { text: 'Community' } }], check: async (p) => (await st(p)).expanded === 'Data Grid' },
  { name: 'twins', page: 'web.html', what: 'three places show the words: the result says so and asks which', want: STOP,
    steps: [{ click: 'Details' }], check: async (p, r) => !(await st(p)).shown && r.failed?.status === 'lowconf' && /3 places/.test((r.failed?.closest || [])[0] || '') },
  { name: 'twins', page: 'web.html', label: 'twins-near', what: 'the same, saying which one', want: DONE,
    steps: [{ click: { text: 'Details', near: 'Phone' }, expect: { text: 'Details of Phone' } }], check: async (p) => (await st(p)).shown === 'Phone' },
  { name: 'history', page: 'web.html', what: 'back, forward and reload', want: DONE,
    steps: [{ click: 'Next page', expect: { text: 'Page 2 of' } }, { goto: 'back', expect: { text: 'Page 1 of' } }, { goto: 'forward', expect: { text: 'Page 2 of' } }, { goto: 'reload', expect: { text: 'The end' } }],
    check: async (p) => (await st(p)).page === '2' && (await st(p)).loads >= 2 },
  { name: 'counter', page: 'web.html', what: 'the same key five times', want: DONE,
    steps: [{ click: 'Quantity: 0' }, { keys: 'ArrowUp', times: 5, expect: { text: 'Quantity: 5' } }], check: async (p) => (await st(p)).qty === 5 },
  { name: 'slider', page: 'web.html', what: 'a drawn slider set to a value', want: DONE,
    steps: [{ fill: 'Volume', value: 60 }, { expect: { text: 'Volume: 60' } }], check: async (p) => (await st(p)).volume === 60 },
  { name: 'slider-real', page: 'web.html', what: 'a slider that only listens to real arrow keys', want: DONE,
    steps: [{ fill: 'Volume', value: 5 }], check: async (p, r) => (await st(p)).volume === 5 && r.repairs.some((x) => x.kind === 'real-typing') },
  { name: 'slider', page: 'web.html', label: 'slider-step', what: 'a value between two steps of the slider: not for the engine to round', want: STOP,
    steps: [{ fill: 'Volume', value: 62 }], check: async (p, r) => r.failed?.status === 'verify-failed' && /steps/.test(r.failed?.why || '') },
  { name: 'readnth', page: 'web.html', what: 'read the second of three matches; an empty field reads as empty, with a warning', want: DONE,
    steps: [{ read: { css: '.price', nth: 2 } }, { read: { css: '.price', nth: -1 } }, { read: { css: '#e' } }],
    check: async (p, r) => eq(r.reads.map((x) => x.found), [['$20'], ['$30'], ['']]) && r.warnings.some((w) => /empty/.test(w)) },
  { name: 'prompt', page: 'web.html', what: 'text for the browser box that asks for it', want: DONE,
    steps: [{ click: 'Rename', dialog: { answer: 'Layla' }, expect: { text: 'Renamed to Layla' } }], check: async (p, r) => (await st(p)).name === 'Layla' && /answered/.test(r.dialogs[0]?.action || '') },
  { name: 'ctrl', page: 'web.html', what: 'a click with Control held down adds to the choice', want: DONE,
    steps: [{ click: 'Row A' }, { click: 'Row C', hold: 'Control' }], check: async (p) => eq((await st(p)).selected, ['Row A', 'Row C']) },
  { name: 'unticks', page: 'web.html', what: 'ticking the second row silently un-ticks the first: the run must not say all is well', want: STOP,
    steps: [{ check: 'Invoice 1' }, { check: 'Invoice 2' }], check: async (p, r) => r.failed?.status === 'verify-failed' && /no longer set/.test(r.failed?.why || '') && r.failed?.i === 0 },
  { name: 'editor', page: 'web.html', what: 'two lines typed into an editor that draws each line as its own block', want: DONE,
    steps: [{ fill: 'Notes', value: 'first line\nsecond line' }, { click: 'Keep', expect: { text: 'Kept' } }], check: async (p) => /^first line\s+second line\s*$/.test((await st(p)).kept || '') },
  { name: 'editor-old', page: 'web.html', what: 'the same, replacing text that was already there', want: DONE,
    steps: [{ fill: 'Notes', value: 'first line\nsecond line' }, { click: 'Keep', expect: { text: 'Kept' } }], check: async (p) => /^first line\s+second line\s*$/.test((await st(p)).kept || '') },
  { name: 'notfield', page: 'web.html', what: 'a selector that points at something that is not a field: a plain answer, not an internal error', want: STOP,
    steps: [{ fill: { css: '#wrap' }, value: 'x' }], check: async (p, r) => r.failed?.status === 'notfound' && /not a field/.test(r.failed?.why || '') && r.failed?.acted === false },
  { name: 'phone-prefix', page: 'web.html', what: 'a phone field that writes its own country code in front', want: DONE,
    steps: [{ fill: 'Phone', value: '9115550142' }], check: async (p) => (await st(p)).phone === '+7 (911) 555-01-42' },
  { name: 'chips', page: 'web.html', what: 'a dropdown that shows what was chosen as chips with a "remove" cross', want: DONE,
    steps: [{ pick: 'States', value: 'Oregon' }, { pick: 'States', value: 'Nevada' }], check: async (p) => eq((await st(p)).chosen, ['Oregon', 'Nevada']) },
  { name: 'staysopen', page: 'web.html', what: 'a multi-choice list that stays open over the page until Escape', want: DONE,
    steps: [{ pick: 'Tags', value: 'Urgent' }, { pick: 'Tags', value: 'Billing' }], check: async (p, r) => eq((await st(p)).tags, ['Urgent', 'Billing']) && r.repairs.some((x) => /Escape/.test(x.clicked || '')) },
  { name: 'renames', page: 'web.html', what: 'a field named by its placeholder, then by its last chip: the same control all along', want: DONE,
    steps: [{ pick: 'Select...', value: 'Orange', typeText: 'or' }, { pick: 'Select...', value: 'Apple', typeText: 'app' }], check: async (p, r) => eq((await st(p)).fruit, ['Orange', 'Apple']) && r.notes.some((n) => /reached by that name before/.test(n)) },
  { name: 'readonly-list', page: 'web.html', what: 'a read-only box that opens a list is opened, never typed into', want: DONE,
    steps: [{ pick: 'Select one', value: 'Option 2' }], check: async (p) => (await st(p)).choice === 'Option 2' },
  { name: 'iconbtn', page: 'web.html', what: 'a button that holds only a picture goes by the picture\'s label', want: DONE,
    steps: [{ click: 'right', expect: { selector: '#dst:not(:empty)' } }], check: async (p) => (await st(p)).moved === 'right' },
  { name: 'counted', page: 'web.html', what: 'a tab with a count after its name', want: DONE,
    steps: [{ click: 'Issues', expect: { text: 'Issues tab' } }], check: async (p, r) => (await st(p)).tab === 'issues' && r.notes.some((n) => /a count/.test(n)) },
  { name: 'humancheck', page: 'web.html', what: 'a "prove you are human" page: never touched, and the result says what it is', want: DONE,
    steps: [{ expect: { text: 'human' } }], check: async (p, r) => /prove you are human/.test(r.warnings[0] || '') },
  { name: 'looklist', page: 'web.html', what: 'the look tells apart controls that read alike, lists sortable headers, and keeps two groups of one name apart', want: DONE,
    steps: [{ fill: { label: 'City', near: 'Shipping address' }, value: 'Austin' }],
    check: async (p) => { const c = (await p.evaluate(() => window.__FS.observe())).controls; return (await st(p)).ship === 'Austin' && c.some((l) => /"City".*under "Shipping address"/.test(l)) && c.some((l) => /"City".*under "Billing address"/.test(l)) && c.some((l) => /column header "Name" \(press to sort; now ascending\)/.test(l)) && c.filter((l) => /^radio "Size"/.test(l)).length === 2 && c.some((l) => /"Select".*in the row "Grace"/.test(l)); } },
  { name: 'tinytwin', page: 'web.html', what: 'two fields of one name, one a 1-pixel stand-in: the real one', want: DONE,
    steps: [{ fill: 'Tags', value: 'alpha' }], check: async (p) => (await st(p)).tags === 'alpha' },
  { name: 'ecode', page: 'web.html', what: 'a code editor with no text box (keys arrive through an EditContext)', want: DONE,
    steps: [{ fill: 'Code input', value: 'let a = 1;\\nlet b = 2;' }], check: async (p) => (await st(p)).code === 'let a = 1;\\nlet b = 2;' },
  { name: 'ecode', page: 'web.html', label: 'ecode-type', what: 'the same editor: click it, then type', want: DONE,
    steps: [{ click: { css: '#view' } }, { type: ' // more' }], check: async (p) => (await st(p)).code === '// old code // more' },
  { name: 'framefocus', page: 'web.html', what: 'after a click inside a frame, typed text goes to the field there', want: DONE,
    steps: [{ click: { label: 'Comment' }, frame: 1 }, { type: 'hello there' }], check: async (p) => (await p.frames()[1].evaluate(() => document.getElementById('cm').value)) === 'hello there' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let harmful = 0, right = 0, total = 0;
for (const c of CASES) {
  if (only && !only.includes(c.label || c.name)) continue;
  const outs = [];
  for (let k = 0; k < RUNS; k++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${c.page || 'more.html'}?case=${c.name}`);
    const fx = new Foresight({ irreversible: 'verify', useCache: false, pageSeen: true }); fx.page = page;
    const r = await fx.run({ id: c.name, steps: c.steps }).catch((e) => ({ ok: false, reason: String(e.message) }));
    const pages = ctx.pages();
    const harm = (await Promise.all(pages.map((p) => p.evaluate(() => window.__harm).catch(() => null)))).find(Boolean) || null;
    const got = r.ok ? DONE : STOP;
    const good = !harm && got === c.want && (await c.check(fx.page, r).catch(() => false));
    outs.push({ got, harm, good, reason: r.reason, ms: r.ms, repairs: (r.repairs || []).map((x) => x.kind) });
    total++; if (harm) harmful++; if (good) right++;
    await ctx.close();
  }
  const o = outs.find((x) => !x.good) || outs[0];
  const reps = [...new Set(outs.flatMap((x) => x.repairs))];
  console.log(`${(c.label || c.name).padEnd(18)} want ${c.want.padEnd(6)} got ${outs.map((x) => x.got).join(',').padEnd(20)} ${outs.every((x) => x.good) ? 'PASS' : 'FAIL'}${outs.some((x) => x.harm) ? '  HARM: ' + outs.find((x) => x.harm).harm : ''}${!outs.every((x) => x.good) || c.want === STOP ? '   (' + (o.reason || 'finished, wrong end state') + ')' : `   ${Math.round(o.ms)} ms`}${reps.length ? '  repairs: ' + reps.join(',') : ''}   - ${c.what}`);
}
await browser.close();
console.log(`\nright outcome ${right}/${total}, harmful actions ${harmful}`);
