// Foresight in-page runtime.
// Injected into the page once. Executes a whole *window* of actions inside the page in a single
// round trip, checking confidence, reachability and postconditions per step, and aborting the
// instant the page diverges from what the plan expected (the "tripwire").
// Must stay self-contained: it is serialized with Function.prototype.toString().
export function foresightRuntime() {
  if (window.__FS) return;

  // ---------- text helpers (Unicode-aware: non-Latin text must never compare as empty) ----------
  // Marks that belong to a letter (accents, Thai tones, Indic vowel signs) and symbols (<= >= degree, currency ...)
  // are part of the name and are kept.
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}\p{S}@.:/#%&-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  // Optional marks only: Arabic and Hebrew vowel points, which the same word is written with or without.
  const fold = (z) => z.normalize('NFD').replace(/[ًٌٍَُِّْٰـְֱֲֳִֵֶַָֹֺֻּֽ־ֿ׀ׁׂ׃ׅׄ׆ׇ]/g, '').normalize('NFC');
  const squash = (z) => z.replace(/(?<=\p{L})[\s-]+(?=\p{L})/gu, '');       // "time zone" / "time-zone" / "timezone"; never a minus in front of a number
  const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t.length > 1 || /[\p{N}\p{S}#%&@]/u.test(t)));
  const bare = (w) => w.replace(/^(?![-+]\p{N})[^\p{L}\p{N}\p{S}]+|[^\p{L}\p{M}\p{N}\p{S}]+$/gu, '').replace(/(?<=\p{L})-(?=\p{L})/gu, '') || w;
  const words = (s) => s.split(' ').map(bare).filter(Boolean);
  function runIndex(long, short) {            // where the words of `short` appear in `long` as a run of whole words (-1: nowhere)
    outer: for (let i = 0; i + short.length <= long.length; i++) { for (let j = 0; j < short.length; j++) if (long[i + j] !== short[j]) continue outer; return i; }
    return -1;
  }
  const NEGATION = new Set(['not', 'never', 'cannot', 'cant', 'couldn', 'didn', 'wasn', 'isn', 'failed', 'unable', 'nicht', 'nie', 'kein', 'keine', 'pas', 'jamais', 'nunca', 'niet', 'не', 'никогда', 'لم', 'لن', 'ليس', 'غير', 'değil']);
  // How alike two names are.
  //   1      the same words
  //   0.95   the same words, joined or split differently ("Time zone" / "Timezone" / "E-mail")
  //   0.94   the same words, with or without optional accents
  // Everything below MATCH is only good for telling the planner what the closest names are: one name inside
  // another ("Email" / "Email address", "Send" / "Do not send") is never treated as the same control.
  const MATCH = 0.93;
  function sim(a, b) {
    const x = norm(a).replace(/[\s:*.]+$/, ''), y = norm(b).replace(/[\s:*.]+$/, '');
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (squash(x) === squash(y)) return 0.95;
    const fx = fold(x), fy = fold(y);
    if (fx === fy || squash(fx) === squash(fy)) return 0.94;
    const xs = words(x), ys = words(y);
    const [long, short] = xs.length >= ys.length ? [xs, ys] : [ys, xs];
    const at = short.length < long.length ? runIndex(long, short) : -1;
    if (at === 0 && Math.min(x.length, y.length) >= 40) return 0.94;      // a long headline named by its first 40+ characters (the look cuts long names)
    if (at >= 0) return 0.6 + 0.3 * (Math.min(x.length, y.length) / Math.max(x.length, y.length));
    const A = tokens(a), B = tokens(b);
    let inter = 0; for (const t of A) if (B.has(t)) inter++;
    return (inter / (A.size + B.size - inter || 1)) * 0.8;
  }
  // Does `hay` mention `needle` as whole words? (both already normalized.) Digits never run on into more digits
  // ("1 item" is not in "11 items", "12" not in "12.50") and letters must end on a word edge, in every script that
  // separates its words (so not Chinese, Japanese, Thai ...).
  const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u, LETTER = /[\p{L}\p{M}]/u, DIGIT = /\p{N}/u;
  const hasCache = new Map();
  function finder(needle) {
    let re = hasCache.get(needle);
    if (!re) {
      const f = [...needle][0], l = [...needle].at(-1);
      const L = DIGIT.test(f) ? '(?<![\\p{N}]|[\\p{N}][.,])' : LETTER.test(f) && !UNSPACED.test(f) ? '(?<![\\p{L}\\p{M}\\p{N}])' : '';
      const R = DIGIT.test(l) ? '(?![\\p{N}]|[.,][\\p{N}])' : LETTER.test(l) && !UNSPACED.test(l) ? '(?![\\p{L}\\p{M}\\p{N}])' : '';
      re = new RegExp(L + needle.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + R, 'gu');
      if (hasCache.size > 300) hasCache.clear();
      hasCache.set(needle, re);
    }
    re.lastIndex = 0;
    return re;
  }
  const has = (hay, needle) => !!needle && finder(needle).test(hay);
  // The same, but a mention that is plainly denied does not count: "Saved" is not confirmed by "not saved".
  // Only the word directly in front, on the same line, and only words that deny in any context.
  function affirms(text, needle) {
    const want = norm(needle); if (!want) return false;
    for (const line of String(text).split(/[\n\r]+/)) {
      const hay = norm(line); if (!hay) continue;
      const re = finder(want);
      for (let m; (m = re.exec(hay)); ) {
        const before = hay.slice(0, m.index).trim().split(' ').pop() || '';
        const prev2 = hay.slice(0, m.index).trim().split(' ').slice(-2, -1)[0] || '';
        if (!NEGATION.has(bare(before)) && !(bare(before) === 't' && /^(don|didn|wasn|isn|couldn|can|won)$/.test(prev2))) { re.lastIndex = 0; return true; }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    return false;
  }
  const flat = (s) => String(s ?? '').replace(/[\s\u0085\u2028\u2029]+/g, ' ').trim();          // one line: page text can never forge extra lines
  const textOf = (el) => flat(el?.innerText ?? el?.textContent ?? '');

  // ---------- shadow DOM: open shadow roots are part of the page ----------
  let rootsAt = -Infinity, rootsList = [document];   // never trust the cache before the first real scan
  function roots() {
    const now = performance.now();
    if (now - rootsAt < 40) return rootsList;
    const out = [document];
    const walk = (root) => { for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); } };
    walk(document);
    rootsAt = now; rootsList = out; return out;
  }
  // contains() / parent over the tree as it is rendered: through shadow roots, and through the slot that content is shown in
  const above = (n) => n.assignedSlot || n.parentNode || n.host || null;
  const within = (node, anc) => { for (let n = node; n; n = above(n)) if (n === anc) return true; return false; };
  const up = (n) => { for (let x = above(n); x; x = above(x)) if (x.nodeType === 1) return x; return null; };
  // querySelectorAll over the page and every open shadow root, or over one subtree and the shadow roots inside it
  function qsa(sel, root) {
    const rs = roots();
    if (!root || root === document) return rs.length === 1 ? [...document.querySelectorAll(sel)] : rs.flatMap((r) => [...r.querySelectorAll(sel)]);
    const out = [...root.querySelectorAll(sel)];
    for (const r of rs) if (r !== document && within(r.host, root)) out.push(...r.querySelectorAll(sel));
    return out;
  }
  function deepHit(x, y) { let el = document.elementFromPoint(x, y); while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; } return el; }
  function pageText() { let t = document.body ? document.body.innerText : ''; for (const r of roots().slice(1)) for (const c of r.children) if (!/^(STYLE|SCRIPT|TEMPLATE|LINK|NOSCRIPT)$/.test(c.tagName)) t += '\n' + (c.innerText || ''); return t; }

  // ---------- kinds of control ----------
  const isToggle = (el) => /^(checkbox|radio)$/.test((el.type || '').toLowerCase()) || /^(checkbox|switch|radio)$/.test(el.getAttribute?.('role') || '');
  const isChecked = (el) => (el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true');
  const isDisabled = (el) => el.disabled === true || el.getAttribute?.('aria-disabled') === 'true' || !!el.closest?.('fieldset:disabled');

  // A control that is not a text field but opens a list of choices (custom dropdown).
  // A button that says it opens something (a dialog, say) and points at a part of the page that holds a list of choices
  // is a dropdown too: a flag button in front of a phone number, for one.
  const opensList = (el) => { const hp = el.getAttribute('aria-haspopup'); if (!hp || hp === 'false') return false;
    return (el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).some((id) => { const n = document.getElementById(id); return !!n && (n.matches('[role=listbox],[role=menu],[role=tree]') || !!n.querySelector('[role=listbox],[role=menu],[role=tree]')); }); };
  const isOpener = (el) => el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && (el.getAttribute('role') === 'combobox' || /listbox|menu|true/.test(el.getAttribute('aria-haspopup') || '') || opensList(el));

  // ---------- accessible names ----------
  // What a label says, leaving out the contents of controls it wraps (a dropdown's options, a text area's text).
  function labelText(l) {
    if (!l.querySelector('select,textarea,datalist,button')) return textOf(l);
    const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let t = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!n.parentElement.closest('select,textarea,datalist,button')) t += ' ' + n.textContent;
    return flat(t);
  }
  // What a row of a menu or tree says for itself: the rows of a list nested inside it have names of their own.
  const NESTED = 'ul,ol,[role=menu],[role=group],[role=tree],[role=listbox]';
  function rowText(el) {
    if (!el.querySelector(NESTED)) return textOf(el);
    const inner = (p) => { const c = p.closest(NESTED); return !!c && c !== el && el.contains(c); };
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.trim() && !inner(n.parentElement) && visible(n.parentElement)) t += ' ' + n.data;
    return flat(t) || textOf(el);
  }
  // What a person can read on or beside the control.
  function visibleNames(el) {
    const out = [];
    if (el.labels) for (const l of el.labels) out.push(labelText(l));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) out.push(lb.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' '));
    const ph = el.getAttribute('placeholder'); if (ph) out.push(flat(ph));
    if (/^(BUTTON|A|LI|SUMMARY)$/.test(el.tagName) || /button|option|link|menuitem|tab|switch|checkbox|radio|treeitem/.test(el.getAttribute('role') || '')) out.push(rowText(el).slice(0, 200));
    if (el.tagName === 'INPUT' && /submit|button|reset/.test(el.type)) out.push(flat(el.value));
    return out.filter(Boolean);
  }
  // Labels that are not shown (they are what the look prints for an icon-only control).
  const hiddenNames = (el) => {
    const own = ['aria-label', 'title'].map((a) => el.getAttribute(a)).filter(Boolean).map(flat);
    if (own.length || !/^(BUTTON|A)$/.test(el.tagName) && el.getAttribute('role') !== 'button') return own;
    // a button that holds only a picture: what the picture is called
    const pic = el.querySelector('[aria-label],img[alt],svg > title');
    const said = pic ? flat(pic.getAttribute('aria-label') || pic.getAttribute('alt') || (pic.tagName.toLowerCase() === 'title' ? pic.textContent : '') || '') : '';
    return said && !textOf(el) ? [said] : own;
  };
  function namesOf(el) {
    const vis = visibleNames(el), hid = hiddenNames(el);
    // a control whose only visible "text" is a symbol (an arrow, a cross) goes by its label first
    const out = vis.length && hid.length && vis.every((n) => !/[\p{L}\p{N}]/u.test(n)) ? [...hid, ...vis] : [...vis, ...hid];
    if (!out.length && isToggle(el)) {      // <input type=radio> High School   (text right next to it, no <label for>)
      for (const sib of [el.nextSibling, el.nextElementSibling, el.previousSibling]) {
        const tx = flat(sib?.nodeType === 3 ? sib.textContent : sib?.nodeType === 1 && !sib.matches('input,select,textarea,button') ? textOf(sib) : '');
        if (tx && tx.length <= 60) { out.push(tx); borrowed.add(el); break; }
      }
    }
    return out;
  }
  // The header of something that opens and closes, as the look prints it.
  const expName = (el) => (namesOf(el)[0] || textOf([...el.children].find((c) => c.tagName === 'SUMMARY') || el)).slice(0, 60);
  const borrowed = new WeakSet();                          // toggles whose only name is the text beside them
  // A visible caption that is not linked to the field: the short text just before it, or in the cell/column before it.
  function nearbyLabel(el) {
    for (let n = el, k = 0; n && n !== document.body && k < 3; n = up(n), k++) {
      let prev = n.previousElementSibling;
      while (prev && (prev.matches('script,style,noscript,template,link,meta') || !visible(prev))) prev = prev.previousElementSibling;
      if (!prev || prev.querySelector(CONTROL)) continue;
      const tx = textOf(prev);
      if (tx && tx.length <= 50) return tx;
    }
    return '';
  }
  // Internal attributes: only weak evidence of what a control means to a human.
  const weakNames = (el) => [...['name', 'id'].map((a) => el.getAttribute(a)), isToggle(el) ? el.getAttribute('value') : null].filter(Boolean).map(flat);
  const isField = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !isToggle(el) && !/submit|button|image|reset/.test(el.type || '');
  const anyName = (el) => namesOf(el)[0] || (isField(el) && nearbyLabel(el)) || weakNames(el)[0] || '';
  function groupName(el) {
    const fs = el.closest('fieldset'); const lg = fs?.querySelector('legend');
    if (lg) return textOf(lg);
    const rg = el.closest('[role=radiogroup]');
    if (rg && (rg.getAttribute('aria-label') || rg.getAttribute('aria-labelledby'))) return flat(rg.getAttribute('aria-label') || '') || rg.getAttribute('aria-labelledby').split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' ');
    // no formal name: the question written just before the options
    const mates = el.name ? qsa(`input[type=radio][name="${CSS.escape(el.name)}"]`) : [];
    let box = el.parentElement;
    if (mates.length > 1) while (box && box !== document.body && !mates.every((m) => box.contains(m))) box = box.parentElement;
    if (!box) return '';
    const first = mates[0] || el;
    let lead = '';
    for (let n = [...box.childNodes].find((c) => c === first || (c.nodeType === 1 && c.contains(first))); n; ) {      // the nearest text before the first option
      n = n.previousSibling; if (!n) break;
      const tx = flat(n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.matches('input,label,select,textarea,button,script,style') && !n.querySelector(CONTROL) ? textOf(n) : '');
      if (n.nodeType === 1 && (n.matches('input,label,select,textarea,button') || n.querySelector(CONTROL))) break;
      if (tx) { lead = tx; break; }
    }
    return lead && lead.length <= 90 ? lead : box === document.body ? '' : nearbyLabel(box).slice(0, 90);
  }

  // ---------- visibility / reachability ----------
  function onPage(r) { return r.right + scrollX > 0 && r.bottom + scrollY > 0; }            // parked far off-screen = not for humans
  let visGen = 0, visFlush = false;
  const visCache = new WeakMap();
  function visible(el) {                                     // (answers are reused only within one synchronous stretch of work)
    if (!el || !el.isConnected) return false;
    if (!visFlush) { visFlush = true; Promise.resolve().then(() => { visGen++; visFlush = false; }); }
    const c = visCache.get(el); if (c && c[0] === visGen) return c[1];
    const v = visibleNow(el); visCache.set(el, [visGen, v]); return v;
  }
  function visibleNow(el) {
    const r = el.getBoundingClientRect(); if ((r.width === 0 && r.height === 0) || !onPage(r)) return false;
    if (r.width <= 1 && r.height <= 1) return false;                                  // a one-pixel copy kept for screen readers
    const de = document.documentElement;
    if (r.left >= Math.max(innerWidth, de.scrollWidth) || r.top >= Math.max(innerHeight, de.scrollHeight)) return false;      // parked beyond the page (an off-canvas drawer)
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    for (let n = el.parentElement, k = 0; n && n !== document.body && k < 6; n = n.parentElement, k++) {      // inside a section folded to nothing
      const pr = n.getBoundingClientRect();
      if ((pr.width <= 1 || pr.height <= 1) && getComputedStyle(n).overflow !== 'visible') return false;
    }
    return true;
  }
  // Custom checkboxes/dropdowns are often a see-through (opacity 0) native control laid over a drawn one: still clickable.
  const occupies = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && onPage(r) && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const shown = (el) => visible(el) || ((isToggle(el) || el.tagName === 'SELECT') && (occupies(el) || [...(el.labels || [])].some(visible)));
  function describe(el) { return { tag: el.tagName.toLowerCase(), id: el.id || undefined, text: textOf(el).slice(0, 80), src: el.tagName === 'IFRAME' ? el.src || undefined : undefined }; }
  const DIALOG = '[aria-modal=true],dialog[open],[role=dialog],[role=alertdialog]';
  // A pop-up need not say it is a dialog. Something that shows up after the page was first seen, is pinned to the
  // window, covers a good part of it, sits on top of other content and holds controls is treated like one.
  const floaters = new Set();
  const maybeFloater = (n) => { if (n.nodeType === 1 && !floaters.has(n)) { try { if (getComputedStyle(n).position === 'fixed') floaters.add(n); } catch {} } };
  function liveFloater(n) {
    if (!n.isConnected) { floaters.delete(n); return false; }
    if (!visible(n) || getComputedStyle(n).position !== 'fixed' || !coversMuch(n) || n.matches(DIALOG) || n.querySelector(DIALOG) || n.closest(DIALOG)) return false;
    if (!n.querySelector(CONTROL + ',' + CLICKABLE)) return false;
    // a side bar or menu pinned beside the page is part of the page, not something in front of it
    if (n.closest('nav,aside,[role=navigation],[role=complementary]')) return false;
    // "in front of the page" means that something of the page (words, a control, a picture) lies beneath it somewhere
    const r = n.getBoundingClientRect(), L = Math.max(0, r.left), T = Math.max(0, r.top), R = Math.min(innerWidth, r.right), B = Math.min(innerHeight, r.bottom);
    const stuff = (o, x, y) => {
      if (o.matches(CONTROL + ',' + CLICKABLE + ',img,svg,canvas,video,picture')) return true;
      for (const c of o.childNodes) { if (c.nodeType !== 3 || !c.data.trim()) continue; const q = textRect(c); if (x >= q.left - 2 && x <= q.right + 2 && y >= q.top - 2 && y <= q.bottom + 2) return true; }
      return false; };
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) {
      const x = Math.min(innerWidth - 1, L + (R - L) * a / 6), y = Math.min(innerHeight - 1, T + (B - T) * b / 6);
      if (document.elementsFromPoint(x, y).some((o) => o !== document.documentElement && o !== document.body && !n.contains(o) && !o.contains(n) && visible(o) && stuff(o, x, y))) return true;
    }
    return false;
  }
  const openDialogs = () => { const a = [...qsa(DIALOG)].filter(visible); for (const f of [...floaters]) if (liveFloater(f) && !a.some((d) => d.contains(f) || f.contains(d))) a.push(f); return a; };
  const topDialog = () => openDialogs().at(-1) || null;
  const isModal = (d) => (d.getAttribute('aria-modal') === 'true' && d.matches(DIALOG)) || (d.tagName === 'DIALOG' && (() => { try { return d.matches(':modal'); } catch { return false; } })());
  function coversMuch(n) {
    const r = n.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return a >= 0.2 * innerWidth * innerHeight;
  }
  // The layer that `node` belongs to and that floats over `over` (the control we want): a dialog, something pinned to
  // the window, or a large positioned sheet. Ancestors that also hold the control are the page itself, not a layer.
  function overlayOf(node, over) {
    let found = null;
    for (let n = node; n && n !== document.body && n !== document.documentElement; n = up(n)) {
      if (n.nodeType !== 1 || (over && within(over, n))) continue;
      if (n.matches(DIALOG)) { found = n; continue; }
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || (pos === 'absolute' && coversMuch(n))) found = n;
    }
    return found;
  }
  const popupLayer = (n) => n.matches(DIALOG) || !!qsa(DIALOG, n).length || coversMuch(n);
  // A drawn checkbox / switch with its real (see-through) input beneath it: a press on the drawing is a press on the control.
  function sameWidget(hit, el) {
    if (!isToggle(el)) return false;
    for (let n = up(el), k = 0; n && k < 2; n = up(n), k++) {
      if (within(hit, n)) return qsa(CONTROL + ',' + CLICKABLE, n).every((c) => c === el || within(c, el) || within(el, c));
    }
    return false;
  }
  // A see-through tick box laid over its own label (a menu button drawn as a label): a press on it is a press on the label.
  const labelledBy = (hit, el) => hit.nodeType === 1 && !!hit.labels && [...hit.labels].some((l) => l === el || within(el, l) || within(l, el));
  let lastBlocker = null;                                   // the element that actually covers the control of the step in hand
  let curTarget = null;                                     // that control
  let lastTouch = -Infinity;                                // when the plan last typed into something in this document
  function probe(el) {
    const r = el.getBoundingClientRect();
    const pts = [[r.left + r.width / 2, r.top + r.height / 2]];
    const parts = [...el.getClientRects()].filter((q) => q.width > 2 && q.height > 2);
    if (parts.length > 1) for (const q of parts.slice(0, 3)) pts.push([q.left + q.width / 2, q.top + q.height / 2]);      // a link wrapped over two lines: each piece
    pts.push([r.left + Math.min(r.width / 2, 12), r.top + r.height / 2], [r.right - Math.min(r.width / 2, 12), r.top + r.height / 2]);
    let blocker = null, node = null;
    for (const [x, y] of pts) {              // reachable if a user could hit it at its middle or near either end
      const hit = deepHit(x, y);
      if (!hit) continue;
      if (hit === el || within(hit, el) || (hit.tagName === 'LABEL' && (hit.control === el || within(el, hit)))) return { ok: true, x, y };
      if (el.labels && [...el.labels].some((l) => within(hit, l))) return { ok: true, x, y };
      if (sameWidget(hit, el) || labelledBy(hit, el) || (el.editContext && el.parentElement && within(hit, el.parentElement))) return { ok: true, x, y };
      const ov = overlayOf(hit, el);
      if (ov && !blocker) { blocker = describe(ov); node = ov; }
      else if (!blocker) { blocker = describe(hit); node = hit; }
    }
    lastBlocker = node;
    return { ok: false, blocker };
  }
  const centre = (el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  function hitTest(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) centre(el);
    let h = probe(el);
    if (!h.ok) { centre(el); h = probe(el); }     // a sticky header/footer may be covering it: move it to the middle and look again
    return h;
  }

  // ---------- stable selector (cache + careful-mode fallbacks) ----------
  const refTag = Math.random().toString(36).slice(2, 7); let refSeq = 0;
  function cssPath(el) {
    const only = (sel) => { try { const m = qsa(sel); return m.length === 1 && m[0] === el; } catch { return false; } };
    if (el.getRootNode() === document) {
      if (el.id) { const sel = '#' + CSS.escape(el.id); if (only(sel)) return sel; }
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
        if (n !== el && n.id) { const sel = '#' + CSS.escape(n.id); let c = 0; try { c = qsa(sel).length; } catch {} if (c === 1) { parts.unshift(sel); break; } }
        let sel = n.tagName.toLowerCase();
        const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
        if (sib.length > 1) sel += `:nth-of-type(${sib.indexOf(n) + 1})`;
        parts.unshift(sel);
      }
      const own = parts.join(' > ');
      if (only(own)) return own;
    }
    // inside a shadow root, or nothing structural singles it out: tag the element itself
    let ref = el.getAttribute('data-fs-ref');
    if (!ref || !only(`[data-fs-ref="${ref}"]`)) { ref = `${refTag}${++refSeq}`; el.setAttribute('data-fs-ref', ref); }
    return `[data-fs-ref="${ref}"]`;
  }

  // ---------- resolution: plan target -> element, with a score and a uniqueness margin ----------
  const CONTROL = 'input:not([type=hidden]),select,textarea,[contenteditable=true],[role=combobox],[role=textbox],[role=searchbox],[role=checkbox],[role=switch],[role=radio],[role=slider]';
  const CLICKABLE = 'button,a[href],[role=button],input[type=submit],input[type=button],[role=link],[role=tab],[role=menuitem],[role=option],summary';
  const EXPANDABLE = '[aria-expanded],details';
  function kindOk(op, el) {
    const t = (el.type || '').toLowerCase();
    if (op === 'fill') return (el.tagName === 'INPUT' && !/checkbox|radio|submit|button|file/.test(t)) || el.tagName === 'TEXTAREA' || el.isContentEditable || isSlider(el) || !!el.editContext;
    if (op === 'pick') return (el.tagName === 'INPUT' && !/checkbox|radio/.test(t)) || isOpener(el);
    if (op === 'select') return el.tagName === 'SELECT';
    if (op === 'check' || op === 'uncheck') return t === 'checkbox' || el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch';
    if (op === 'radio') return t === 'radio' || el.getAttribute('role') === 'radio';
    if (op === 'expand') return el.matches(EXPANDABLE);
    return true;
  }
  // "the Delete next to 'Invoice 1002'": the words must belong to the control's own row or card. Take the smallest
  // block around the control that mentions the words. The control is NOT theirs when
  //  (1) it sits in a list item / table row / definition of its own that does not mention them;
  //  (2) they are in a sibling block that looks like the control's own block, and the control's block says something
  //      of its own (two rows, two cards, two chips);
  //  (3) in a flat layout (grid cells, lines split by line breaks) they are on another line, while the control's line
  //      carries words of its own from the same series.
  // And the block must hold only this one candidate: a second control that fits the step equally well makes it a guess.
  const ITEM = 'tr,li,dd,[role=row],[role=listitem],[role=option],[role=treeitem]';
  const alike = (a, b) => a !== b && a.nodeType === 1 && b.nodeType === 1 && a.tagName === b.tagName && String(a.className) === String(b.className);
  const overlaps = (a, b) => { const low = Math.min(a.height, b.height); return low > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= 0.5 * low; };
  const textRect = (tn) => { const rg = document.createRange(); rg.selectNodeContents(tn); return rg.getBoundingClientRect(); };
  function wordsAt(n, want, skip) {
    let h = n;
    for (let more = true; more; ) { more = false; for (const c of h.children) if (!(h === n && c === skip) && has(norm(textOf(c)), want)) { h = c; more = true; break; } }
    const tn = [...h.childNodes].find((x) => x.nodeType === 3 && has(norm(x.textContent), want));
    return { holder: h, node: tn || null, rect: tn ? textRect(tn) : h.getBoundingClientRect() };
  }
  function ownWords(branch, el) {
    if (branch === el) return false;
    let t = textOf(branch);
    for (const c of [el, ...branch.querySelectorAll(CLICKABLE + ',' + CONTROL + ',option')]) { const x = textOf(c); if (x) t = t.split(x).join(' '); }
    return norm(t).length > 0;
  }
  function nearFactor(el, near, rival) {
    const want = norm(near); if (!want) return 0.2;
    for (let n = up(el), prev = el, k = 0; n && n !== document.body && n !== document.documentElement && k < 8; prev = n, n = up(n), k++) {
      if (!has(norm(textOf(n)), want)) continue;
      if (!has(norm(textOf(prev)), want)) {
        const item = el.closest(ITEM);                                                       // (1)
        if (item && item !== n && within(item, n) && !has(norm(textOf(item)), want)) {
          const dt = item.tagName === 'DD' ? item.previousElementSibling : null;             // a <dd> is described by the <dt> just before it
          if (!(dt && dt.tagName === 'DT' && has(norm(textOf(dt)), want))) return 0.2;
        }
        const w = wordsAt(n, want, prev);
        const ux = [...n.children].find((c) => c !== prev && within(w.holder, c)) || null;
        if (ux && alike(ux, prev) && ownWords(prev, el)) return 0.2;                         // (2)
        let box = el; while (box && !visible(box)) box = up(box);                            // (a button that only shows on hover: go by its row)
        const b = (box || el).getBoundingClientRect();
        if (!overlaps(w.rect, b)) {                                                          // (3)
          const peerWords = [...n.childNodes].some((c) => {
            if (c === prev || c === ux || c === w.node) return false;
            if (c.nodeType === 3) return !!w.node && w.holder === n && norm(c.textContent) && overlaps(textRect(c), b);
            return c.nodeType === 1 && ux && alike(c, ux) && norm(textOf(c)) && !c.matches(CLICKABLE + ',' + CONTROL) && overlaps(c.getBoundingClientRect(), b);
          });
          if (peerWords) return 0.2;
        }
      }
      return qsa('*', n).some((o) => o !== el && !within(o, el) && !within(el, o) && rival(o)) ? 0.35 : 1;
    }
    return 0.2;
  }
  // Table cells by row key and column header, with merged cells counted properly.
  const gridCache = new WeakMap();
  function gridOf(table) {
    const now = performance.now(), c = gridCache.get(table);
    if (c && now - c.at < 40) return c;
    const pos = new Map(), occ = [], heads = [];
    [...table.rows].forEach((tr, r) => {
      occ[r] ||= []; let col = 0;
      for (const cell of tr.cells) {
        while (occ[r][col]) col++;
        const cs = Math.max(1, cell.colSpan || 1), rs = Math.max(1, cell.rowSpan || 1);
        pos.set(cell, { col, row: r });
        for (let i = 0; i < rs; i++) { occ[r + i] ||= []; for (let j = 0; j < cs; j++) occ[r + i][col + j] = cell; }
        col += cs;
      }
      if (tr.parentElement?.tagName === 'THEAD') heads.push(r);
    });
    if (!heads.length) for (let r = 0; r < table.rows.length && [...table.rows[r].cells].every((x) => x.tagName === 'TH'); r++) heads.push(r);
    const g = { at: now, pos, occ, heads }; gridCache.set(table, g); return g;
  }
  function scoreEl(step, el) {
    const base = baseScore(step, el), near = step.target.near;
    if (!near || step.target.row) return base;
    return base * nearFactor(el, near, (o) => o.matches(CLICKABLE + ',' + CONTROL + ',' + EXPANDABLE) && kindOk(step.op, o) && shown(o) && baseScore(step, o) >= base - 0.05);
  }
  function baseScore(step, el) {
    const t = step.target;
    if (t.row) {                                    // table cell: row key + column header
      const td = el.closest('td,th'), table = td?.closest('table'); if (!table) return 0;
      const g = gridOf(table), at = g.pos.get(td); if (!at || g.heads.includes(at.row)) return 0;
      // the row is named by one of its cells (usually the first; a leading tick-box column does not count)
      const key = Math.max(0, ...[...new Set(g.occ[at.row] || [])].filter((c) => c && c !== td).map((c) => sim(textOf(c), t.row)));
      const col = Math.max(0, ...g.heads.map((r) => g.occ[r]?.[at.col]).filter(Boolean).map((h) => sim(textOf(h), t.col)));
      return Math.min(key, col) || 0;
    }
    if (step.op === 'radio') {
      const gn = groupName(el);
      if (step.value == null) return Math.max(0, ...namesOf(el).map((n) => sim(n, t.label)), sim(gn, t.label), sim(el.name, t.label));
      const own = Math.max(0, ...namesOf(el).map((n) => sim(n, step.value)), sim(el.value, step.value));
      // the group is named by its legend / the question before it, or by its internal name; only a group with no name at all cannot contradict the plan
      const grp = !t.label ? 1 : gn ? Math.max(sim(gn, t.label), sim(el.name, t.label)) : Math.max(sim(el.name, t.label), 0.94);
      return Math.min(own, grp);
    }
    const want = t.label ?? t.text;
    const seen = visibleNames(el), hidden = hiddenNames(el), strong = namesOf(el);
    if (step.op === 'expand' && !strong.length) strong.push(expName(el));
    // an internal name is weak evidence, unless it is all the control has and it matches exactly
    const weakBest = Math.max(0, ...weakNames(el).map((n) => sim(n, want)));
    const weak = strong.length ? weakBest * 0.6 : weakBest >= 0.999 ? 0.95 : weakBest * 0.9;
    let base = want == null ? 0.95 : Math.max(weak, ...strong.map((n) => sim(n, want)));
    // an unlinked caption next to an otherwise unnamed field: decent evidence, never as strong as a real label
    if (want != null && !strong.length && isField(el)) base = Math.max(base, sim(nearbyLabel(el), want) * 0.94);
    // "click/double-click <text>" means the text itself; a checkbox that merely sits beside that text is not the target
    if (borrowed.has(el) && (step.op === 'click' || step.op === 'hover')) base *= 0.6;
    // A control that visibly says one thing while a hidden label says another: what people can read decides. A hidden
    // label that only spells the visible text out further ("Delete" / "Delete invoice 1002") is fine.
    if (want != null && base >= MATCH && hidden.length) {
      const read = seen.filter((x) => /\p{L}{2}/u.test(x));
      if (read.length && !read.some((x) => sim(x, want) >= MATCH || has(norm(want), norm(x)))) base = Math.min(base, 0.8);
    }
    return base;
  }
  // Two links count as one target only when they really go to the same other page.
  const here = () => location.href.split('#')[0];
  const hrefOf = (a) => (typeof a.href === 'string' ? a.href : String(a.href?.baseVal || a.getAttribute('href') || ''));      // (a link inside an SVG keeps its address elsewhere)
  const sameTarget = (a, b) => a === b || (a.tagName === 'A' && b.tagName === 'A' && !!hrefOf(a) && hrefOf(a) === hrefOf(b) && !/^javascript:/i.test(hrefOf(a)) && hrefOf(a).split('#')[0] !== here());

  // Icon-only controls: something with a title/aria-label and a pointer cursor that is not a normal button or link.
  const iconButtons = (root) => qsa('[title],[aria-label]', root).filter((e) => !e.matches(CLICKABLE + ',' + CONTROL) && !e.closest(CLICKABLE) && !e.querySelector(CLICKABLE + ',' + CONTROL) && getComputedStyle(e).cursor === 'pointer');
  let lastCandidates = [], lastFilled = null;
  // What the planner was shown at its last look. A control that was not there then (by element or by kind + name)
  // but is there when the run starts has turned up on its own, whatever it is built from: it is a stranger, and no
  // step uses it until the planner has looked again. What appears once the run is under way is the run's doing.
  let lookedAt = -Infinity; let shownSet = new WeakSet(), shownSigs = new Set(), strangers = new WeakSet();
  const sigOf = (el) => el.tagName + '|' + norm(anyName(el));
  function markShown() {
    lookedAt = performance.now(); shownSet = new WeakSet(); shownSigs = new Set(); strangers = new WeakSet();
    for (const el of [...qsa(CONTROL + ',' + CLICKABLE + ',' + EXPANDABLE), ...iconButtons(document)]) if (shown(el)) { shownSet.add(el); shownSigs.add(sigOf(el)); }
    for (const d of noteDialogs()) infoOf(d).seen = true;
  }
  const touched = new WeakSet();                           // controls this plan has acted on (their dialog is never auto-dismissed)

  // ---------- whose pop-up is it? ----------
  // caused : it showed up right after one of the plan's own actions, so it is that action's answer
  // seen   : the planner has been shown it (`observe`)
  // helper : it opened as a field took focus (a calendar, a list of suggestions)
  // work   : the plan has already filled something inside it
  // A pop-up with none of these is the page's own doing. The plan never acts inside one of those: if the page has a
  // control of the wanted name the plan means the page's, and otherwise the run stops and shows the pop-up.
  let lastAct = -Infinity;                                 // when this plan last did something in this document
  let awaiting = false;                                    // the engine is waiting for the next step's control to turn up after a press
  let pressedBefore = false;                               // the plan had already pressed things before this document loaded
  const dlgInfo = new WeakMap();
  let openSet = new Set();
  function noteDialogs() {
    const now = performance.now(), open = openDialogs();
    const did = Math.max(lastAct, lastTouch);
    for (const d of open) if (!openSet.has(d)) dlgInfo.set(d, { caused: now - did <= 1500 || (awaiting && did > -Infinity), pressed: now - lastAct <= 1500 || (awaiting && lastAct > -Infinity), seen: false, helper: false });
    openSet = new Set(open);
    return open;
  }
  const infoOf = (d) => dlgInfo.get(d) || { caused: false, pressed: false, seen: false, helper: false };
  const holdsWork = (d) => qsa(CONTROL, d).some((c) => touched.has(c));
  const known = (d) => { const i = infoOf(d); return i.seen || i.helper || holdsWork(d); };
  const mine = (d) => infoOf(d).pressed || known(d);
  const dialogBrief = (d) => ({ text: textOf(d).slice(0, 160), buttons: [...new Set(qsa(CLICKABLE, d).filter(visible).map((b) => anyName(b).slice(0, 40)).filter(Boolean))].slice(0, 8), opened: infoOf(d).caused ? 'right after a step of this plan' : 'by the page itself' });
  const begins = (a, b) => { const x = words(norm(a).replace(/[\s:*.]+$/, '')), y = words(norm(b).replace(/[\s:*.]+$/, '')); const [long, short] = x.length >= y.length ? [x, y] : [y, x]; return short.length > 0 && short.length < long.length && short.every((w, i) => long[i] === w); };
  // What a field's name stood for the first time this run used it. Fields named by their placeholder, or by what
  // was last chosen in them, lose that name the moment they are used; the control is still the same one.
  let namedBefore = new Map();
  // the row of a table or list a control sits in, by the first words of that row
  function rowWord(el) {
    const row = el.closest('tr,li,[role=row],[role=listitem]'); if (!row) return '';
    const tw = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { const tx = flat(n.data); if (tx.length > 1 && visible(n.parentElement) && !within(n.parentElement, el) && !n.parentElement.closest('label,button,select,option')) return `in the row "${tx.slice(0, 30)}"`; }
    return '';
  }
  function resolve(step) {
    const alive = (el) => !!el && el.isConnected && shown(el) && kindOk(step.op, el);
    // a retry of a step that has already typed into its field goes back to that very field
    if (step.pin) { let el = null; try { el = qsa(step.pin)[0]; } catch {} if (alive(el)) return { el, score: 1, margin: 1, strategy: 'pinned' }; }
    let r = resolveAny(step);
    const t = step.target, key = (step.op === 'pick' || step.op === 'fill') && t && !t.css && !t.row && (t.label ?? t.text) != null ? step.op + JSON.stringify([t.label ?? null, t.text ?? null, t.near ?? null, t.nth ?? null]) : null;
    if (key) {
      const was = namedBefore.get(key), sure = !!r.el && r.score >= MATCH && confidence(step, r) >= (step.threshold ?? 0.9);
      // counted by position, the count changes as names change: the earlier answer stands while that control is there
      if (alive(was) && was !== r.el && (t.nth != null || !sure)) {
        const keep = lastCandidates;
        r = { el: was, score: 1, margin: 1, strategy: 'same-control', picked: `the control this plan reached by that name before${anyName(was) ? ` (it now reads "${anyName(was).slice(0, 40)}")` : ''}` };
        lastCandidates = keep;
      } else if (sure && !namedBefore.has(key)) namedBefore.set(key, r.el);
    }
    if (r.el && strangers.has(r.el)) return { el: null, score: 0, margin: 0, strategy: r.strategy, unshown: true };
    return r;
  }
  const kindWord = (el) => (el.closest('th,[role=columnheader]') ? 'column header' : el.matches('a[href],[role=link]') ? 'link' : el.matches('button,[role=button],input[type=submit],input[type=button],summary') ? 'button' : el.matches('[role=option],option') ? 'option' : el.matches('[role^=menuitem]') ? 'menu item' : el.matches('[role=tab]') ? 'tab' : el.matches('[role=treeitem]') ? 'tree row' : isToggle(el) ? 'tick box' : isField(el) ? 'field' : el.tagName.toLowerCase());
  // where on the page it is, in a few words: the pop-up, table or headed section it belongs to
  function placeWord(el) {
    if (el.closest(DIALOG)) return 'in the dialog';
    if (el.closest('[role=listbox],[role=menu]') && !el.closest('main,article')) return 'in the open list';
    for (let n = up(el), k = 0; n && n !== document.body && k < 8; n = up(n), k++) {
      const h = n.matches('section,article,fieldset,form,li,tr,[role=group],[role=region]') || k > 1 ? [...n.children].find((c) => c.matches('h1,h2,h3,h4,h5,h6,legend,caption') && visible(c) && !c.contains(el)) : null;
      if (h && textOf(h)) return `under "${textOf(h).slice(0, 40)}"`;
    }
    return '';
  }
  function resolveAny(step) {
    const t = step.target;
    lastCandidates = [];
    // "the 2nd": counted the way a person reads the page, top to bottom, then left to right
    const byPage = (a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : ra.left - rb.left; };
    const nthOf = (list) => { const o = [...list].sort(byPage); return t.nth > 0 ? o[t.nth - 1] : o[o.length + t.nth]; };
    if (t.css) {
      let els = []; try { els = [...qsa(t.css)]; } catch { return { el: null, score: 0, margin: 0, strategy: 'css', badSelector: true }; }
      if (t.near) { const all = els; els = els.filter((e) => nearFactor(e, t.near, (o) => all.includes(o)) === 1); }
      els = els.filter((e) => shown(e) || els.length === 1);              // people count what they can see
      // (a stale copy of a pop-up that the page parked far off the page is not something a person can see either)
      if (els.length > 1) { const off = (e) => { const b = e.getBoundingClientRect(); return b.right + scrollX < -200 || b.bottom + scrollY < -200; }, on = els.filter((e) => !off(e)); if (on.length) els = on; }
      const total = els.length;
      if (t.nth) els = [nthOf(els)].filter(Boolean);
      if (!els.length) return { el: null, score: 0, margin: 0, strategy: 'css' };
      if (t.nth) return { el: els[0], score: 1, margin: 1, strategy: 'css', hidden: !shown(els[0]), picked: `match ${t.nth > 0 ? t.nth : total + t.nth + 1} of ${total} for ${t.css}: ${describe(els[0]).tag}${anyName(els[0]) ? ' "' + anyName(els[0]).slice(0, 40) + '"' : ''}` };
      lastCandidates = els.length > 1 ? [`the selector matches ${els.length} elements: add "nth" or "near"`] : [];
      return { el: els[0], score: 1, margin: els.length === 1 ? 1 : 0, strategy: 'css', hidden: !shown(els[0]) };
    }
    const sel = step.op === 'expand' ? EXPANDABLE : step.op === 'click' || step.op === 'hover' ? CLICKABLE + ',' + CONTROL + ',' + EXPANDABLE : step.op === 'pick' ? CONTROL + ',[aria-haspopup]' : CONTROL;
    // Pop-ups. The plan's own top-most one comes first; pop-ups that are not the plan's are left out altogether.
    const open = noteDialogs(), foreign = open.filter((d) => !mine(d)), active = open.filter(mine).at(-1) || null;
    const inForeign = (el) => foreign.some((d) => within(el, d));
    const clicky = step.op === 'click' || step.op === 'hover';
    const pass = (root, skip) => {
      let best = null, bestS = 0;
      const scored = [], unseen = [];
      for (const el of [...qsa(sel, root), ...(clicky ? iconButtons(root) : [])]) {
        if (!kindOk(step.op, el) || (skip && skip(el))) continue;
        const sc = scoreEl(step, el);
        if (!shown(el)) { if (sc >= MATCH) unseen.push([el, sc]); continue; }
        if (sc > 0.3) scored.push([el, sc]);
        if (sc > bestS) { bestS = sc; best = el; }
      }
      if (clicky && best) {
        const top = scored.filter(([, sc]) => sc >= bestS - 0.001), say = new Map(top.map(([o]) => [o, norm(textOf(o))]));
        const outer = new Set(top.filter(([o]) => say.get(o) && top.some(([n]) => n !== o && within(n, o) && say.get(n) === say.get(o))).map(([o]) => o));
        if (outer.size) {
          const kept = scored.filter(([o]) => !outer.has(o));
          if (outer.has(best)) best = (kept.find(([o, sc]) => sc >= bestS - 0.001 && within(o, best)) || [best])[0];
          scored.length = 0; scored.push(...kept);
        }
      }
      return { best, bestS, scored, unseen };
    };
    let scope = document, both = false, found = active ? pass(active) : null;
    if (found && found.bestS >= MATCH) {
      scope = active;
      // it has only just opened, the page behind it can still be used, and the page has that name too: which is meant?
      if (!known(active) && !isModal(active) && pass(document, (el) => within(el, active) || inForeign(el)).bestS >= MATCH) both = true;
    } else {
      found = pass(document, foreign.length ? inForeign : null);
      if (found.bestS < MATCH) for (const d of foreign) if (pass(d).bestS >= MATCH) return { el: null, score: 0, margin: 0, strategy: 'semantic', foreign: dialogBrief(d) };
    }
    const { best, bestS, scored, unseen } = found;
    lastCandidates = [...scored].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([el, sc]) => `${anyName(el).slice(0, 60)} (${sc.toFixed(2)})`);
    { const top = [...scored].sort((a, b) => b[1] - a[1]).slice(0, 5);        // the same name several times: say what each one is
      if (top.length > 1 && top[0][1] >= MATCH && top[1][1] >= top[0][1] - 0.001 && norm(anyName(top[0][0])) === norm(anyName(top[1][0])))
        lastCandidates = [...top.map(([el, sc]) => `${anyName(el).slice(0, 60)} (${sc.toFixed(2)}, ${kindWord(el)}${placeWord(el) ? ', ' + placeWord(el) : ''})`), `${scored.filter(([, sc]) => sc >= top[0][1] - 0.001).length} controls go by that name: add "near" or "nth" to say which`]; }
    if (!lastCandidates.length) {                          // nothing came close: show the names that are spelt most like it
      const grams = (z) => { const tx = ' ' + norm(z) + ' ', g = new Set(); for (let i = 0; i < tx.length - 2; i++) g.add(tx.slice(i, i + 3)); return g; };
      const spelt = (a, b) => { const A = grams(a), B = grams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n || 1); };
      const asked = t.label ?? t.text ?? '';
      lastCandidates = [...new Set(qsa(sel, scope).filter((el) => kindOk(step.op, el) && shown(el) && !inForeign(el)).map((el) => anyName(el).slice(0, 60)).filter(Boolean))]
        .map((n) => [n, spelt(n, asked)]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
    }
    if (both) { lastCandidates = [`"${anyName(best).slice(0, 40)}" in the dialog that has just opened`, 'a control of the same name on the page behind it']; return { el: best, score: bestS, margin: 0, strategy: 'semantic', why: 'a dialog has just opened, and both it and the page behind it have a control of that name: look at the page, then say which one' }; }
    // nothing visible matches, but a hidden control does (e.g. a delete button that only shows on hover)
    if (bestS < 0.5 && unseen.length) { unseen.sort((a, b) => b[1] - a[1]); return { el: unseen[0][0], score: unseen[0][1], margin: unseen.length === 1 ? 1 : unseen[0][1] - unseen[1][1], strategy: 'hidden', hidden: true }; }
    if (t.nth) {
      const ties = scored.filter(([, sc]) => sc >= bestS - 0.001).map(([el]) => el);
      const pick = nthOf(ties);
      if (pick && bestS >= MATCH) return { el: pick, score: bestS, margin: 1, strategy: 'nth', picked: `match ${t.nth > 0 ? t.nth : ties.length + t.nth + 1} of ${ties.length} named "${anyName(pick).slice(0, 40)}"` };
    }
    // Two controls whose names differ only in punctuation ("Search:" and "Search..."): the one written exactly as the plan wrote it
    if (bestS >= MATCH && (t.label ?? t.text) != null) {
      const asked = flat(t.label ?? t.text).toLowerCase(), top = scored.filter(([, sc]) => sc >= bestS - 0.001).map(([el]) => el);
      const exact = top.filter((el) => namesOf(el).some((n) => flat(n).toLowerCase() === asked));
      if (top.length > 1 && exact.length === 1) return { el: exact[0], score: bestS, margin: 1, strategy: 'semantic' };
    }
    // "click Search" where a search box and a Search button share the name: a click means the button
    if (clicky && bestS >= MATCH) {
      const top = scored.filter(([, sc]) => sc >= bestS - 0.001).map(([el]) => el);
      const press = top.filter((el) => el.matches(CLICKABLE) && !isField(el));
      if (top.length > 1 && press.length === 1 && top.every((el) => el === press[0] || isField(el))) return { el: press[0], score: bestS, margin: 1, strategy: 'semantic' };
    }
    let second = 0;
    for (const [el, sc] of scored) if (!sameTarget(el, best) && sc > second) second = sc;
    const want = t.label ?? t.text;
    // A field is harmless to try and its result is read back, so an obvious relative is good enough for one: the ONLY
    // field whose name starts the way the plan's does ("Email" for "Email address", or the other way round), with
    // nothing else on the page even resembling it. Never for a button, a tick box or an irreversible step.
    if (bestS < MATCH && want != null && ['fill', 'select', 'pick'].includes(step.op) && step.risk !== 'irreversible' && !t.near && !t.nth) {
      const kin = scored.filter(([el]) => [...namesOf(el), isField(el) ? nearbyLabel(el) : ''].some((n) => n && begins(n, want)));
      if (kin.length === 1 && scored.filter(([, sc]) => sc >= 0.6).length === 1) return { el: kin[0][0], score: MATCH, margin: 1, strategy: 'kin', picked: `no field is named exactly that; used "${anyName(kin[0][0]).slice(0, 60)}", the only field whose name begins the same way` };
    }
    // A tab or link that carries a count after its name ("Issues 44", "Inbox (3)"): the count is not part of the name.
    // Only when exactly one control reads like that; never for an irreversible step.
    if (bestS < MATCH && want != null && clicky && step.risk !== 'irreversible' && !t.nth) {
      const w = norm(want), counted = scored.filter(([el]) => namesOf(el).some((n) => { const x = norm(n); return x.startsWith(w + ' ') && /\d/.test(x.slice(w.length)) && /^[\s\d.,()\[\]+km]+$/i.test(x.slice(w.length)); }));
      if (w && counted.length === 1) return { el: counted[0][0], score: MATCH, margin: 1, strategy: 'counted', picked: `nothing is named exactly that; used "${anyName(counted[0][0]).slice(0, 60)}", the only control whose name is those words and a count` };
    }
    // Two fields of one name where one is a 1-pixel stand-in kept for screen readers or for the form: the real one
    if (bestS >= MATCH && !clicky && !t.nth) {
      const top = scored.filter(([, sc]) => sc >= bestS - 0.001).map(([el]) => el), real = top.filter((el) => { const b = el.getBoundingClientRect(); return b.width > 4 && b.height > 4; });
      if (top.length > 1 && real.length === 1) return { el: real[0], score: bestS, margin: 1, strategy: 'semantic' };
    }
    // Text that is not a button or link but is plainly meant to be pressed (div-based options, table headers, chips):
    // an element whose whole line reads exactly the wanted words. Never a fragment of something bigger that can be
    // pressed and says more than that.
    if (step.op === 'click' && bestS < MATCH && want != null) {
      const w = norm(want), raw = String(want);
      const blockOf = (el) => { for (let n = el; n && n !== document.body; n = up(n)) { if (n.nodeType === 1 && !/^(inline|contents)$/.test(getComputedStyle(n).display)) return n; } return el; };
      // the biggest pressable thing around the text that is still about the size of a button or a row (a whole list
      // that listens for clicks on behalf of its rows is not "a button around this text")
      const pressRoot = (el) => { let root = null; const h = Math.max(el.getBoundingClientRect().height, 12);
        for (let n = el, k = 0; n && n !== document.body && k < 6; n = up(n), k++) {
          if (n.nodeType !== 1 || n.getBoundingClientRect().height > 2.5 * h) continue;
          if (n.matches(CLICKABLE + ',' + CONTROL + ',label') || n.hasAttribute('onclick') || typeof n.onclick === 'function' || n.hasAttribute('tabindex') || getComputedStyle(n).cursor === 'pointer') root = n;
        }
        return root; };
      // (the line may also hold other controls, such as a delete button: their own captions are not part of what it says)
      const lineSays = (blk, el) => { let tx = textOf(blk); for (const c of blk.querySelectorAll(CLICKABLE + ',' + CONTROL)) if (!c.contains(el) && !el.contains(c)) { const x = textOf(c); if (x) tx = tx.split(x).join(' '); } return norm(tx); };
      const whole = (el) => { if (lineSays(blockOf(el), el) !== w) return false; const pr = pressRoot(el); return !pr || norm(textOf(pr)) === w || sim(anyName(pr), raw) >= MATCH; };
      const hits = w ? qsa('*', scope).filter((el) => el.children.length <= 3 && el.textContent.length <= raw.length * 2 + 8 && visible(el) && norm(textOf(el)) === w && !inForeign(el) && whole(el)) : [];
      let deepest = hits.filter((el) => !hits.some((o) => o !== el && within(o, el)));
      if (t.near) { const all = deepest; deepest = deepest.filter((el) => nearFactor(el, t.near, (o) => all.includes(o)) === 1); }
      if (deepest.length && t.nth) { const pick = nthOf(deepest); if (pick) return { el: pick, score: 0.95, margin: 1, strategy: 'text-nth', picked: `match ${t.nth > 0 ? t.nth : deepest.length + t.nth + 1} of ${deepest.length} pieces of text reading "${textOf(pick).slice(0, 40)}"` }; }
      if (deepest.length > 1) lastCandidates = [`${deepest.length} places on the page show exactly that text: add "near" or "nth" to say which`];
      if (deepest.length) return { el: deepest[0], score: 0.95, margin: deepest.length === 1 ? 1 : 0, strategy: 'text', picked: 'no button or link has that name; pressed the text itself' };
    }
    // A selector remembered from an earlier run counts only when the full search picks that very element again.
    let cached = null; if (step.cacheCss) { try { cached = qsa(step.cacheCss)[0] || null; } catch {} }
    return { el: best, score: bestS, margin: bestS - second, strategy: cached && cached === best ? 'cache' : step.cacheCss ? 'heal' : 'semantic' };
  }

  // ---------- confidence: evidence, plus history only for a target the cache has already confirmed ----------
  const logit = (p) => Math.log(p / (1 - p)), sigm = (z) => 1 / (1 + Math.exp(-z));
  function confidence(step, r) {
    if (!r.el) return 0;
    // Ambiguous only if a second control is a match too. An exact name still wins over one that is merely written alike.
    const second = r.score - r.margin;
    const uniq = second < MATCH || (r.score >= 0.999 && second < 0.999) ? 1 : 0.55;
    const ev = Math.min(0.995, Math.max(0.005, r.score * Math.min(1, uniq)));
    return sigm(logit(ev) + (r.strategy === 'cache' ? step.priorShift || 0 : 0));
  }

  // ---------- low-level actions (framework-safe: native setters + real events) ----------
  // A drawn slider (not an <input type=range>): it says where it stands, and moves with the arrow keys.
  const isSlider = (el) => el.getAttribute?.('role') === 'slider' && el.tagName !== 'INPUT';
  const sliderAt = (el) => { const v = el.getAttribute('aria-valuenow'); return v == null || v === '' ? NaN : Number(v); };
  async function slide(el, value) {
    const want = Number(value); if (!Number.isFinite(want)) return { no: 'a slider takes a number' };
    const lo = Number(el.getAttribute('aria-valuemin') ?? NaN), hi = Number(el.getAttribute('aria-valuemax') ?? NaN);
    if ((Number.isFinite(lo) && want < lo) || (Number.isFinite(hi) && want > hi)) return { no: `the slider goes from ${lo} to ${hi}` };
    if (!Number.isFinite(sliderAt(el))) return { no: 'the slider does not say where it stands (no aria-valuenow), so nothing could confirm the value: drag it, or use "clickAt"' };
    try { el.focus({ preventScroll: true }); } catch {}
    const key = (k, code) => { for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true })); };
    let right = 1, moved = false;                           // which way the right arrow moves it is found out on the first press
    for (let n = 0; n < 400 && sliderAt(el) !== want; n++) {
      const before = sliderAt(el), up = want > before;
      if (up === right > 0) key('ArrowRight', 39); else key('ArrowLeft', 37);
      await Promise.resolve(); if (sliderAt(el) === before) await frame();
      const after = sliderAt(el);
      if (after === before) return moved ? { no: `the slider stopped at ${before}`, acted: true } : { keys: true };
      if (!moved && (after > before) !== up) { right = -right; moved = true; continue; }
      moved = true;
      if ((up && after > want) || (!up && after < want)) return { no: `the slider moves in steps: ${before} and ${after} are the nearest values it can show`, acted: true };
    }
    return sliderAt(el) === want ? { ok: true } : { no: 'the slider did not reach that value', acted: true };
  }
  function setNative(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  }
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  function fill(el, v) {
    if (el.isContentEditable) { el.textContent = v; el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
    setNative(el, v);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v }));
    fire(el, 'change');
  }
  // exact visible text first; a looser match only if it is the only one (never "< 5 years" for "> 5 years")
  function findOption(sel, v) {
    const raw = flat(v), opts = [...sel.options];
    const byText = opts.filter((o) => flat(o.text) === raw);
    if (byText.length) return byText.every((o) => o.value === byText[0].value) ? byText[0] : byText.find((o) => o.value === String(v)) || 'twins';
    const byValue = opts.filter((o) => o.value === String(v)); if (byValue.length === 1) return byValue[0];
    const same = opts.filter((o) => norm(o.text) && norm(o.text) === norm(v)); if (same.length === 1) return same[0];
    const close = opts.filter((o) => sim(o.text, v) >= MATCH); return close.length === 1 ? close[0] : null;
  }
  function pickOption(sel, v) {
    const wanted = (Array.isArray(v) ? v : [v]).map((x) => findOption(sel, x));
    if (wanted.includes('twins')) return 'twins';
    if (wanted.some((o) => !o)) return 'none';
    if (wanted.some((o) => o.disabled || (o.parentElement?.tagName === 'OPTGROUP' && o.parentElement.disabled))) return 'disabled';
    if (wanted.length > 1 && !sel.multiple) return 'single';
    if (sel.multiple) for (const o of sel.options) o.selected = wanted.includes(o);      // exactly these
    else setNative(sel, wanted[0].value);
    fire(sel, 'input'); fire(sel, 'change'); return true;
  }
  const selectedTexts = (sel) => [...sel.selectedOptions].map((o) => flat(o.text)).sort().join('|');
  function pressDown(el) {
    const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerover', o)); el.dispatchEvent(new MouseEvent('mouseover', o)); el.dispatchEvent(new MouseEvent('mousemove', o));
    const down = el.dispatchEvent(new PointerEvent('pointerdown', o)) & el.dispatchEvent(new MouseEvent('mousedown', o));
    if (down) { const f = el.closest('button,a[href],input,select,textarea,[tabindex],[contenteditable=true]'); if (f && f !== document.activeElement && !isDisabled(f)) try { f.focus({ preventScroll: true }); } catch {} }
    return o;
  }
  function pointerClick(el) {
    const o = pressDown(el);
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }
  // Would a click on this start loading another page? (so the engine waits for it instead of racing it)
  function mayNavigate(el) {
    const a = el.closest('a[href]');
    if (a) return !/^javascript:/i.test(a.getAttribute('href') || '') && typeof a.href === 'string' && a.href.split('#')[0] !== here() && a.target !== '_blank';
    const b = el.closest('button,input[type=submit],input[type=image]');
    return !!b && !!b.form && (b.type === 'submit' || b.type === 'image');
  }

  // ---------- waiting without round trips ----------
  function until(fn, timeout = 3000) {
    return new Promise((resolve) => {
      const v0 = fn(); if (v0) return resolve(v0);
      let done = false;
      const finish = (v) => { if (done) return; done = true; mo.disconnect(); clearInterval(iv); clearTimeout(to); resolve(v); };
      const check = () => { let v; try { v = fn(); } catch { v = null; } if (v) finish(v); };
      const mo = new MutationObserver(check);
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const iv = setInterval(check, 25);
      const to = setTimeout(() => finish(null), timeout);
    });
  }
  const EXPECT_KEYS = ['text', 'title', 'url', 'selector', 'gone', 'label'];
  function expectMet(e) {
    if (!e) return true;
    if (!EXPECT_KEYS.some((k) => e[k] != null)) return false;                // nothing checkable = not met (never vacuously true)
    if (e.text != null && (!norm(e.text) || !affirms(pageText(), e.text))) return false;
    if (e.title != null && (!norm(e.title) || !has(norm(document.title), norm(e.title)))) return false;
    if (e.url != null && !location.href.includes(e.url)) return false;
    try {
      if (e.selector != null && ![...qsa(e.selector)].some(visible)) return false;     // must be on screen, not just in the page
      if (e.gone != null && [...qsa(e.gone)].some(visible)) return false;             // removed OR hidden both count as gone
    } catch { return false; }
    if (e.label != null) { const r = resolve({ op: 'any', target: { label: e.label } }); if (!r.el || r.score < MATCH || !shown(r.el)) return false; }
    return true;
  }

  // ---------- postconditions ----------
  const pickLists = new WeakMap();                          // field -> the floating list its last choice was picked from
  const pickProof = new WeakMap();                          // field -> the chip that appeared beside it when the choice was made
  // What a custom dropdown itself shows, leaving out the list of choices it may contain.
  function ownText(el) {
    const menu = pickLists.get(el), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const pe = n.parentElement; if (!pe || !visible(pe)) continue;
      const list = pe.closest('[role=listbox],[role=option],[role=menu],[role=menuitem],ul,ol');
      if ((menu && within(pe, menu)) || (list && list !== el && el.contains(list))) continue;
      t += ' ' + n.textContent;
    }
    return flat(t);
  }
  // The list a suggestion floats in: marked as a list, or lifted out of the page flow.
  function floatRoot(o) {
    for (let n = o, k = 0; n && n !== document.body && k < 8; n = up(n), k++) {
      if (n.nodeType !== 1) continue;
      if (/^(listbox|menu|tree|grid)$/.test(n.getAttribute('role') || '') || /absolute|fixed/.test(getComputedStyle(n).position)) return n;
    }
    return null;
  }
  const bodyText = () => String(document.body?.innerText ?? '');
  // What a control says about itself without showing it as text.
  const saidNames = (el) => ['aria-label', 'title', 'aria-description', 'aria-valuetext'].map((a) => el.getAttribute(a)).filter(Boolean).map(norm);
  function verify(step, el) {
    switch (step.op) {
      case 'fill': {
        if (isSlider(el)) return sliderAt(el) === Number(step.value);
        // a code editor draws its text beside the surface that takes the keys: it must show the lines that were typed
        if (el.editContext && !el.isContentEditable) { const sq = (x) => String(x ?? '').replace(/[\s​﻿ ]+/g, ''), host = el.closest('[role=code]') || el.parentElement; return sq(step.value) !== '' && !!host && sq(host.innerText).includes(sq(step.value)); }
        // an editor draws each line as a block of its own: compare what it shows, whatever it puts between the lines
        if (el.isContentEditable) { const sq = (x) => String(x ?? '').replace(/[\s​﻿]+/g, ''); return flat(el.textContent) === flat(step.value) || (sq(step.value) !== '' && sq(el.innerText) === sq(step.value)); }
        return el.value === String(step.value) || (el.value !== '' && looseEq(el.value, step.value));
      }
      case 'select': {
        const want = (Array.isArray(step.value) ? step.value : [step.value]).map((x) => flat(findOption(el, x)?.text ?? '\u0000' + x)).sort().join('|');
        return selectedTexts(el) === want;
      }
      case 'check': return isChecked(el) === true;
      case 'uncheck': return isChecked(el) === false;
      case 'radio': return isChecked(el) === true;
      case 'expand': return el.tagName === 'DETAILS' ? el.open : el.getAttribute('aria-expanded') === 'true';
      case 'pick': {
        const want = norm(step.value); if (!want) return false;
        if (flat(el.value) && norm(el.value) === want) return true;
        const pf = pickProof.get(el);
        // the field holds the line that was chosen, or part of it
        if (pf?.line && flat(el.value ?? '')) { const vw = tokens(el.value); if (vw.size && [...vw].every((t) => pf.line.has(t))) return true; }
        // the control was renamed to say what was chosen (a flag button: "Change country, selected United States (+1)")
        if (pf?.name && el.isConnected && saidNames(el).some((n) => has(n, want))) return true;
        // the field shows a short form of the choice (a flag and "+1" for "United States +1"): the same short form, still there
        if (pf?.part && pf.box.isConnected && [...pf.box.querySelectorAll('*')].some((d) => d !== el && d.children.length <= 4 && visible(d) && !(pf.menu.isConnected && within(d, pf.menu)) && textOf(d) === pf.part)) return true;
        // multi-value widgets clear the input and show a chip instead: the one that appeared when the choice was made
        // (pages re-draw their chips, so the proof is "where it appeared and what was already there", not one node)
        const chip = () => !!pf && !!pf.old && pf.box.isConnected && [...pf.box.querySelectorAll('*')].some((d) => d !== el && d.children.length <= 4 && !pf.old.has(d) && !(pf.menu.isConnected && within(d, pf.menu)) && visible(d) && sim(textOf(d), step.value) >= MATCH);
        if (isOpener(el) || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return has(norm(ownText(el)), want) || chip();          // a custom dropdown shows its choice as its own text
        return chip();
      }
      default: return true;
    }
  }

  // ---------- tripwire: notice the world changing under a speculative run ----------
  let trip = null;
  let recent = [];                                          // [element, time] for subtrees added in the last moments
  const tripObserver = new MutationObserver((muts) => {
    const now = performance.now();
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      recent.push([n, now]);
      maybeFloater(n); for (const c of n.children) maybeFloater(c);
      const d = n.matches?.(DIALOG) ? n : n.querySelector?.(DIALOG);
      if (d) { noteDialogs(); if (!trip) trip = { kind: 'overlay', node: describe(d) }; }
    }
  });
  tripObserver.observe(document.documentElement, { childList: true, subtree: true });
  // ... including ones that were in the page all along and are only now switched on
  new MutationObserver((ms) => { for (const m of ms) { const t = m.target, pp = t.parentElement; if (pp && (pp === document.body || pp.parentElement === document.body)) maybeFloater(t); } })
    .observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
  let leavingAt = -Infinity;
  addEventListener('beforeunload', () => { trip = { kind: 'navigation' }; leavingAt = performance.now(); });
  addEventListener('pagehide', () => { trip = { kind: 'navigation' }; leavingAt = performance.now(); });

  // People cannot act on something in the instant it appears; pages rely on that (a dialog clicked mid fade-in can
  // get stuck). So: if the target sits in something that just appeared, give it two frames, then let any finite
  // animation on it or its ancestors finish. Costs nothing on a page that is standing still.
  const frame = () => new Promise((res) => { const t = setTimeout(res, 50); requestAnimationFrame(() => { clearTimeout(t); res(); }); });
  async function settleFor(el) {
    const now = performance.now();
    recent = recent.filter(([n, t]) => now - t < 400 && n.isConnected);
    if (recent.some(([n]) => within(el, n))) { await frame(); await frame(); }
    const running = () => (document.getAnimations ? document.getAnimations() : []).filter((a) => {
      const tg = a.effect?.target; let it = 1; try { it = a.effect.getComputedTiming().iterations; } catch {}
      return tg && within(el, tg) && it !== Infinity && (a.playState === 'running' || a.playState === 'pending');
    });
    const end = performance.now() + 1000;
    for (let list = running(); list.length && performance.now() < end; list = running()) {
      await Promise.race([Promise.allSettled(list.map((a) => a.finished)), new Promise((res) => setTimeout(res, Math.max(0, end - performance.now())))]);
    }
  }

  async function waitLeaving(node) {
    const list = (document.getAnimations ? document.getAnimations() : []).filter((an) => {
      const tg = an.effect?.target; let it = 1; try { it = an.effect.getComputedTiming().iterations; } catch {}
      return tg && node && (within(node, tg) || within(tg, node)) && it !== Infinity && an.playState !== 'finished' && an.playState !== 'idle';
    });
    if (!list.length) return false;
    await Promise.race([Promise.allSettled(list.map((an) => an.finished)), new Promise((res) => setTimeout(res, 1000))]);
    await frame(); await frame();
    return true;
  }

  // What this run wrote, so it can be re-read right before something commits (a click, Enter, an irreversible step).
  // A control still on screen that no longer holds its value is drift, with two exceptions, both "the page took the
  // value because the plan told it to": the field was emptied by Enter pressed in that very field (a search box, a
  // to-do box), or by the plan's very next click on a button of the same form / the same small block (an Add button).
  // Before an irreversible step only the first exception counts.
  let pending = new Map();
  // same content, different dress: "(555) 014-2000" for "5550142000", "5,000.00" for "5000". Never a different value.
  const looseEq = (a, b) => {
    const A = String(a ?? '').trim(), B = String(b ?? '').trim();
    if (A === B) return true;
    // a number: plain, or with commas only where thousands separators go ("5,000.00" yes, "1,5" no)
    const num = (x) => { const t = x.replace(/[\s$€£]/g, ''); return /^[-+]?(\d+|\d{1,3}(,\d{3})+)?(\.\d*)?$/.test(t) && /\d/.test(t) ? parseFloat(t.replace(/,/g, '')) : NaN; };
    const na = num(A), nb = num(B);
    if (Number.isFinite(na) && Number.isFinite(nb)) {                                       // two numbers: equal as numbers ("5.00" is not "500")
      const coded = (x) => /^[-+]?0\d/.test(x.replace(/[\s$€£,]/g, ''));                    // "00501" is a code, not a quantity: its zeros count
      const grouped = (x) => /^[-+]?\d{1,3}(\.\d{3})+$/.test(x.replace(/[\s$€£]/g, ''));    // "1.000" may be a thousand: never the same as "1"
      if (grouped(A) || grouped(B)) return false;
      return coded(A) || coded(B) ? A.replace(/[^\d.]/g, '') === B.replace(/[^\d.]/g, '') : na === nb;
    }
    if (Number.isFinite(na) || Number.isFinite(nb)) {                                       // a number against a dressed-up form of it
      const plain = Number.isFinite(na) ? A : B, other = Number.isFinite(na) ? B : A;
      if (!/^\d+$/.test(plain)) return false;                                                // only a plain run of digits can be "dressed" (a phone mask)
      const k = (x) => x.toLowerCase().replace(/(\d)[.,](?=\d)/g, '$1\u0001').replace(/[^\p{L}\p{N}\u0001]+/gu, '');
      if (/[.,]\d{1,2}$/.test(other) || (other.includes('.') && other.includes(','))) return false;      // that is a number with decimals, not a mask ("1234567" is not "12.345,67")
      // (a phone field may put its own country code in front: "+7 (911) 555-01-42" for 9115550142)
      if (plain.length >= 7 && /^\+\d{1,3}[\s(.-]/.test(other) && !/\p{L}/u.test(other)) { const d = other.replace(/\D+/g, ''); if (d.endsWith(plain) && d.length - plain.length <= 3 && other.replace(/^\+\d{1,3}/, '').replace(/\D+/g, '') === plain) return true; }
      return plain.length >= 7 ? other.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === plain : k(other) === plain;   // short ones: "1,5" is not "15"
    }
    // text: only capitals and spacing may differ. Punctuation is content ("john.doe@x.com" is not "johndoe@xcom").
    const t = (x) => x.toLowerCase().replace(/[\s\u00a0]+/g, ' ');
    return t(A) === t(B);
  };
  const shownNow = (el) => (el.type === 'checkbox' || el.type === 'radio' || isToggle(el) ? isChecked(el) : isSlider(el) ? sliderAt(el) : el.isContentEditable ? flat(el.textContent) : el.value);
  const emptied = (el) => !isToggle(el) && el.tagName !== 'SELECT' && (el.isContentEditable ? flat(el.textContent) === '' : el.value === '');
  const closeBy = (field, button) => { if (!button) return false; const f = button.form || button.closest?.('form'); if (field.form && field.form === f) return true; for (let n = up(field), k = 0; n && n !== document.body && k < 4; n = up(n), k++) if (within(button, n)) return true; return false; };
  // A press that can commit something happened: `by` is 'keys' (the focused field took it) or the element clicked.
  function acted(by) {
    lastAct = performance.now();
    const focus = by === 'keys' ? keyFocus : null;
    for (const e of pending.values()) {
      if (!e.used) { if (by === 'keys') e.byEnter = !!focus && (focus === e.el || within(focus, e.el)); else if (by && by.nodeType === 1) e.byClick = closeBy(e.el, by); }
      e.used = true;
    }
    return true;
  }
  let keyFocus = null;                                     // where the keyboard focus was when the plan pressed a key
  // put back to how the page shows it by default (a form that was reset)
  const reverted = (el) => emptied(el) || (el.tagName === 'SELECT' ? (el.multiple ? [...el.options].every((o) => o.selected === o.defaultSelected) : el.selectedIndex === Math.max(0, [...el.options].findIndex((o) => o.defaultSelected))) : isToggle(el) && el.tagName === 'INPUT' ? el.checked === el.defaultChecked : el.value !== undefined && el.value === el.defaultValue);
  function drifted(strict) {
    const bad = [];
    for (const [key, e] of [...pending]) {
      if (!e.el.isConnected) {                              // the page drew the control again (or the screen changed)
        const r = resolveAny(e.step);
        const again = r.el && r.score >= MATCH && kindOk(e.step.op, r.el) && shown(r.el) ? r.el : null;
        if (!again || [...pending.values()].some((o) => o !== e && o.el === again)) { pending.delete(key); continue; }      // gone, or it is another field the plan wrote later
        if (verify(e.step, again)) { e.el = again; continue; }
        if (e.used && emptied(again)) { pending.delete(key); continue; }      // a press came in between and the field is blank: the next screen, or a fresh form
        bad.push({ i: e.step.i, wanted: e.step.value, now: shownNow(again) }); continue;
      }
      if (!shown(e.el)) continue;                           // an earlier screen
      if (verify(e.step, e.el)) continue;
      if ((e.byEnter && emptied(e.el)) || (e.byClick && !strict && reverted(e.el))) { pending.delete(key); continue; }
      bad.push({ i: e.step.i, wanted: e.step.value, now: shownNow(e.el) });
    }
    return bad;
  }
  // A careful-mode repair wrote this field from outside the page: keep track of it like any other.
  function track(step) {
    const r = resolveAny(step);
    if (!r.el || !verify(step, r.el)) return false;
    touched.add(r.el);
    pending.set(step.op === 'radio' ? (r.el.name || r.el) : r.el, { step, el: r.el, used: false });
    return true;
  }
  // A new run starts clean. A resumed run takes over the fields its earlier steps wrote: those that still hold their
  // value, and those that now hold a different one (so the difference is reported again instead of forgotten).
  function begin(seed, o = {}) {
    pending = new Map(); namedBefore = new Map();
    for (const step of seed || []) {
      const r = resolveAny(step);
      if (r.el && r.score >= MATCH && kindOk(step.op, r.el) && shown(r.el) && (verify(step, r.el) || !emptied(r.el))) pending.set(step.op === 'radio' ? (r.el.name || r.el) : r.el, { step, el: r.el, used: false });
    }
    if (o.pressed) pressedBefore = true;
    if (o.seen) markShown();
    else {
      noteDialogs();
      if (lookedAt > -Infinity) for (const el of [...qsa(CONTROL + ',' + CLICKABLE + ',' + EXPANDABLE), ...iconButtons(document)]) if (shown(el) && !shownSet.has(el) && !shownSigs.has(sigOf(el))) strangers.add(el);
    }
    return true;
  }
  // Is it safe to send real keys now? Not if a pop-up the plan knows nothing about would receive them.
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  function keysSafe() {
    const a = deepActive();
    for (const d of noteDialogs()) {
      if (mine(d)) continue;
      if (a && within(a, d)) return { ok: false, why: 'a pop-up the plan did not open has the keyboard focus, so the keys would go to it', dialog: dialogBrief(d) };
      if (isModal(d)) return { ok: false, why: 'a pop-up the plan did not open is in front of the page', dialog: dialogBrief(d) };
    }
    return { ok: true };
  }

  // ---------- the click guard ----------
  // A real mouse press lands on whatever is under the pointer at that instant. Between choosing the point and the
  // press the page may move (a list re-sorts, a banner slides in). The guard watches the press in the capture phase:
  // if it lands anywhere but on the intended control it is cancelled before the page sees it, and reported.
  // On release it also re-reads the fields this plan wrote: widgets that rewrite a value when something else is
  // pressed are caught before the click goes through.
  let openedAt = -Infinity;                                // when this page last asked the browser for a new window or tab
  try { const nativeOpen = window.open; window.open = function (...a) { openedAt = performance.now(); return nativeOpen.apply(this, a); }; } catch {}
  let guard = null;
  const GUARDED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu', 'dblclick'];
  function onGuarded(e) {
    const g = guard; if (!g || !e.isTrusted) return;
    const hit = (e.composedPath && e.composedPath()[0]) || e.target;
    const el = g.el;
    const inside = hit === el || within(hit, el) || (hit.tagName === 'LABEL' && (hit.control === el || within(el, hit))) || (el.labels && [...el.labels].some((l) => within(hit, l))) || (hit.nodeType === 1 && (sameWidget(hit, el) || labelledBy(hit, el)));
    const cancel = () => { e.stopImmediatePropagation(); e.preventDefault(); };
    const box = () => { const q = el.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(Math.round).join(); };
    if (!inside) {
      if (!g.mishit) { g.mishit = describe(hit.nodeType === 1 ? hit : hit.parentElement || document.body); g.stayed = g.down && g.box === box() && !within(el, hit); }
      cancel(); return; }
    if (!g.down && (e.type === 'pointerdown' || e.type === 'mousedown')) g.box = box();
    if (g.cancelled) { cancel(); return; }
    lastAct = performance.now();                                 // whatever the page opens from here on is its answer to this press
    // Re-read what the plan wrote before the press goes down, and again on release (by then every press-down handler
    // has run: did one of them rewrite a field?).
    if ((e.type === 'pointerdown' && !g.down) || e.type === 'mouseup') {
      const bad = drifted();
      if (bad.length) { g.drift = bad; g.cancelled = true; cancel(); return; }
    }
    if (e.type === 'pointerdown' || e.type === 'mousedown') g.down = true;      // from here on the control has felt the press
    if (e.type === 'click') g.hit = true;
  }
  function armGuard(el, step, preMet) {
    disarm();
    guard = { el, preMet, mutations: 0, url: location.href, hit: false, down: false, mishit: null, drift: null, cancelled: false, at: performance.now() };
    guard.watcher = new MutationObserver((m) => { if (guard) guard.mutations += m.length; });
    guard.watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    for (const t of GUARDED) addEventListener(t, onGuarded, true);
    trip = null;
  }
  function disarm() {
    if (!guard) return null;
    const g = guard; guard = null;
    for (const t of GUARDED) removeEventListener(t, onGuarded, true);
    return g;
  }
  // Called after the engine's real press: what happened?
  async function finishClick(step) {
    const g = guard;
    if (!g) return { status: 'error', why: 'no click was being guarded' };
    if (!g.hit && !g.mishit && !g.drift) await until(() => g.hit || g.mishit || g.drift, 150);     // the click event may arrive a tick after the release
    const reacted = () => g.mutations > 0 || location.href !== g.url || trip?.kind === 'navigation';
    const done = (r) => { g.watcher.disconnect(); disarm(); return r; };
    if (g.drift) return done({ status: 'verify-failed', why: 'a field no longer holds the value that was entered (the page changed it); the click was cancelled', fields: g.drift, acted: false });
    // The press went down on the control, but the page moved before the release, so the release was cancelled and no
    // click happened. A control that acts on the press alone has acted; one that waits for the click has not. Only an
    // expectation can tell which, so without one this is reported as unknown - and never pressed again.
    const viaDown = !g.hit && g.down;
    // The control did not move: what took the release is something the press itself opened on top of it (a calendar
    // under a date field, a list under a button). That is the control's answer to the press, as a person would get it.
    if (viaDown && g.stayed && g.el.isConnected && visible(g.el)) {
      if (step.op === 'click') acted(g.el); else lastAct = performance.now();
      const o = { status: 'ok', mayNavigate: false, reacted: true, opened: (g.mishit.text || g.mishit.tag).slice(0, 60) };
      if (step.expect && !(await until(() => expectMet(step.expect), step.expect.timeout || 5000))) { noteDialogs(); return done({ status: 'timeout', why: 'expectation not met', expect: step.expect, acted: true, reacted: true }); }
      await until(() => false, 60); noteDialogs();
      return done(o);
    }
    if (viaDown && !step.expect) { acted(g.el); return done({ status: 'unsure', why: 'the press went down on the control, then the page moved and the release was cancelled. If the control acts on the press alone it has acted; if it waits for a full click it has not. Look at the page', released: g.mishit || undefined, acted: 'unknown', reacted: reacted() }); }
    if (!g.hit && !viaDown) return done({ status: 'moved', why: g.mishit ? 'the control moved or was covered at the moment of the press; the press was cancelled' : 'the press never arrived in this document', blocker: g.mishit, arrived: !!g.mishit, acted: false });
    if (step.op === 'click') acted(g.el); else lastAct = performance.now();     // a press on a button may use up what was typed; ticking a box does not
    const out = { status: 'ok', mayNavigate: g.el.isConnected && mayNavigate(g.el) };
    if (viaDown) out.warn = 'the page moved between press and release; the expectation shows the control acted on the press itself';
    if (step.op !== 'click') { await until(reacted, 250); noteDialogs(); return done(out); }
    // A link (or form) that says of itself that it opens in a new tab: what the click leads to is over there, so the
    // engine checks the expectation where the click went. A tab opened by the page's own script is only reported.
    const link = g.el.isConnected ? g.el.closest('a[href]') : null, form = g.el.isConnected && out.mayNavigate ? g.el.closest('form') : null;
    if ((link && link.target === '_blank') || (form && form.target === '_blank')) { out.opensTab = 'link'; out.mayNavigate = false; out.reacted = true; if (step.expect) out.expectLater = true; noteDialogs(); return done(out); }
    if (step.expect) {
      if (g.preMet) out.warn = 'the expectation was already true before this step, so it proves nothing';
      const ok = await until(() => expectMet(step.expect), step.expect.timeout || 5000);
      if (!ok) {
        noteDialogs();
        // the page opened a tab of its own on this press and the expectation is not met here: let the engine look for it there
        if (openedAt >= g.at) return done({ status: 'ok', opensTab: 'script', expectLater: true, reacted: true, mayNavigate: false });
        return done({ status: 'timeout', why: 'expectation not met', expect: step.expect, acted: true, reacted: reacted() });
      }
      lastAct = performance.now();                           // the page has just answered the press: what shows up now is still its answer
    } else if (out.mayNavigate) await until(() => trip?.kind === 'navigation', 400);
    else await until(reacted, 250);
    noteDialogs();
    out.reacted = reacted(); out.trip = trip;
    if (openedAt >= g.at) { out.opensTab = 'script'; out.reacted = true; }
    return done(out);
  }
  // Careful mode for a tick box / switch / expander that ignored the scripted press: hand the engine a point for a real, guarded one.
  function expandToggle(el, want) {
    if (el.tagName === 'DETAILS') { const sm = [...el.children].find((c) => c.tagName === 'SUMMARY'); return sm && visible(sm) ? sm : null; }
    if (el.matches('button,[role=button],[role=tab],summary,a[href]')) return el;
    // a plain header that carries the open/closed state itself (it holds no list or panel of its own)
    if (!el.querySelector('ul,ol,[role=group],' + EXPANDABLE + ',' + CONTROL) && (getComputedStyle(el).cursor === 'pointer' || el.hasAttribute('tabindex') || el.hasAttribute('onclick'))) {
      // (pressed on its own words, so that a handler on an inner part of the row hears it too; never on a link inside it)
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.data.trim() && visible(n.parentElement)) { const p = n.parentElement, c = p.closest(CLICKABLE); return c && c !== el && el.contains(c) ? el : p; }
      return el;
    }
    const kids = [...el.querySelectorAll('*')].filter((d) => d.closest(EXPANDABLE) === el && visible(d));
    // its header: a button or link inside it that carries the node's own name
    const header = kids.find((d) => d.matches(CLICKABLE) && want != null && sim(anyName(d), want) >= MATCH);
    if (header) return header;
    // its arrow: a small pressable mark with no name of its own that comes BEFORE the node's text (never a trailing icon)
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let first = null;
    for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.textContent.trim() && visible(n.parentElement)) { first = textRect(n); break; }
    if (!first) return null;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const inControl = (d) => { const c = d.closest(CLICKABLE + ',' + CONTROL); return !!c && el.contains(c) && c !== el; };
    return kids.find((d) => { if (inControl(d) || d.matches(CLICKABLE + ',' + CONTROL) || d.querySelector(CLICKABLE + ',' + CONTROL) || textOf(d) || d.getAttribute('aria-label') || d.getAttribute('title') || getComputedStyle(d).cursor !== 'pointer') return false;
      const q = d.getBoundingClientRect(); return q.width <= 48 && overlaps(q, first) && (rtl ? q.left >= first.right - 2 : q.right <= first.left + 2); }) || null;
  }
  function armAt(step) {
    const r = resolve(step); if (!r.el) return { found: false };
    const el = r.el;
    const target = step.op === 'expand' ? expandToggle(el, step.target.label ?? step.target.text) : isToggle(el) && !visible(el) ? [...(el.labels || [])].find(visible) || el : el;
    if (!target) return { found: true, none: true };
    const h = hitTest(target); if (!h.ok) return { found: true, blocker: h.blocker };
    armGuard(el, step, false);
    return { found: true, x: h.x, y: h.y };
  }

  // ---------- one speculative window ----------
  async function runWindow(steps) {
    const out = []; trip = null; noteDialogs();
    const t0 = performance.now();
    for (const step of steps) {
      const s0 = performance.now();
      const rec = { i: step.i, op: step.op };
      out.push(rec);
      const stop = (status, extra) => { Object.assign(rec, { status, ms: +(performance.now() - s0).toFixed(2) }, extra); return true; };

      lastBlocker = null; curTarget = null;
      let r = resolve(step);
      if (!r.el && !r.foreign && !r.unshown && step.waitMs) { await until(() => resolve(step).el, step.waitMs); r = resolve(step); }
      if (r.foreign) { stop('interrupt', { why: 'the only control with that name is inside a pop-up that the plan did not open and that you have not been shown', dialog: r.foreign, acted: false }); break; }
      if (r.unshown) { stop('interrupt', { why: 'a control with that name is on the page, but it was not there when you last looked: it turned up by itself before this run started. Look again before using it', acted: false }); break; }
      if (!r.el) { stop('notfound', r.badSelector ? { why: 'the css selector is not valid' } : { closest: lastCandidates }); break; }
      curTarget = r.el;
      const p = confidence(step, r);
      rec.p = +p.toFixed(4); rec.strategy = r.strategy; rec.css = cssPath(r.el);
      if (r.picked) rec.note = r.picked;
      else {                                              // say so whenever the control is not written exactly as the plan wrote it
        const want = step.target.label ?? step.target.text, key = (x) => norm(x).replace(/[\s:*.]+$/, '');
        if (want != null && step.op !== 'radio' && !step.target.row && r.score >= MATCH && ![...namesOf(r.el), ...weakNames(r.el), nearbyLabel(r.el)].some((n) => n && key(n) === key(want))) rec.note = `the control is written "${(anyName(r.el) || expName(r.el)).slice(0, 60)}"`;
      }
      if (p < step.threshold) { stop('lowconf', { score: +r.score.toFixed(3), margin: +r.margin.toFixed(3), closest: lastCandidates, why: r.why }); break; }
      // A dialog that does not contain our target means the page is no longer the page we planned for.
      // Only a dialog that declares itself modal blocks by its mere presence; a side panel, chat bubble or helper is
      // judged like anything else on the page: by whether it actually covers the control (the reachability test below).
      // And a dialog that opened right after one of the plan's own steps is that step's question: the plan answers it
      // (its next step is inside it) or the run stops. It is never worked around.
      const unanswered = (d) => { const i = infoOf(d); return i.caused && !known(d); };
      const inWay = () => noteDialogs().filter((d) => !within(r.el, d) && ((isModal(d) && !infoOf(d).helper) || unanswered(d)));
      let way = inWay();
      if (way.length && (await waitLeaving(way.at(-1)))) way = inWay();                    // a dialog fading away after Submit
      if (way.length) {
        lastBlocker = way.at(-1);
        stop(isModal(lastBlocker) ? 'blocked' : 'interrupt', { blocker: describe(lastBlocker), dialog: dialogBrief(lastBlocker), why: unanswered(lastBlocker) ? 'a dialog opened right after one of the plan\'s own steps and the plan does not answer it' : undefined, acted: false }); break;
      }
      if (r.hidden) {                                   // exists but is not shown: usually revealed by hovering its row
        let a = up(r.el); while (a && !visible(a)) a = up(a);
        stop('hidden', { why: 'the control exists but is not visible (it may only appear on hover)', hoverCss: a ? cssPath(a) : null }); break;
      }
      const el = r.el;
      await settleFor(el);
      if (!el.isConnected) { stop('notfound', { why: 'the control was replaced while the page was still changing', closest: lastCandidates }); break; }
      // disabled / read-only controls do nothing: wait a moment for them to enable, otherwise say so
      const listBox = (x) => x.getAttribute('role') === 'combobox' || x.hasAttribute('aria-haspopup') || x.hasAttribute('aria-controls') || x.hasAttribute('aria-owns');
      const inert = () => isDisabled(el) || (step.op === 'fill' && el.readOnly === true) || (step.op === 'pick' && el.readOnly === true && !listBox(el));
      if (inert()) await until(() => !inert(), 1200);
      if (inert()) { stop('disabled', { why: el.readOnly ? 'the field is read-only' : 'the control is disabled' }); break; }

      const target = isToggle(el) && !visible(el) ? [...(el.labels || [])].find(visible) || el : el;
      let h = hitTest(target);
      if (!h.ok && lastBlocker && (await waitLeaving(lastBlocker))) h = hitTest(target);     // whatever covers it may be on its way out
      if (!h.ok) { const dl = lastBlocker && noteDialogs().find((d) => within(lastBlocker, d) || within(d, lastBlocker)); stop('blocked', { blocker: h.blocker, dialog: dl ? dialogBrief(dl) : undefined }); break; }

      // things that pop up while the plan is in this field (a calendar, a list) are remembered as its helpers
      const popped = new Set(), popWatch = new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') popped.add(m.target); else for (const n of m.addedNodes) if (n.nodeType === 1) popped.add(n); } });
      const drain = () => { let k = 0; for (const m of popWatch.takeRecords()) { k++; if (m.type === 'attributes') popped.add(m.target); else for (const n of m.addedNodes) if (n.nodeType === 1) popped.add(n); } return k; };
      const keepHelpers = () => { drain(); popWatch.disconnect();
        helpers.set(el, [...popped].filter((n) => n.isConnected && !within(el, n) && !within(n, el) && visible(n) && /absolute|fixed/.test(getComputedStyle(n).position))); };
      if (step.op === 'fill' || step.op === 'pick' || step.op === 'select') {
        popWatch.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded'] });
        const had = new Set(noteDialogs());
        el.focus();
        // let the page answer the focus before anything is typed: one turn of its own task queue (frameworks draw a
        // calendar or a list there), and a frame more if something did change
        await new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
        if (drain()) await frame();
        // Focusing can itself open something. What opens as the field takes focus is the field's helper (a calendar, a
        // list of suggestions), whatever it calls itself. Any other dialog in front is not.
        // (one that calls itself modal counts as a helper only if it hangs right at the field, the way a calendar does)
        const hangsAt = (d) => { const f = el.getBoundingClientRect(), q = d.getBoundingClientRect(); return q.width * q.height < 0.35 * innerWidth * innerHeight && Math.min(f.right, q.right) > Math.max(f.left, q.left) && (Math.abs(q.top - f.bottom) <= 24 || Math.abs(f.top - q.bottom) <= 24); };
        for (const d of noteDialogs()) if (!had.has(d) && !within(el, d) && (!isModal(d) || hangsAt(d))) infoOf(d).helper = true;
        const over = openDialogs().find((d) => !within(el, d) && isModal(d) && !infoOf(d).helper);
        if (over) { lastBlocker = over; stop('interrupt', { trip: trip || { kind: 'overlay' }, dialog: dialogBrief(over) }); break; }
      }
      if (step.op === 'fill' && !kindOk('fill', el)) {      // (only a css target gets this far)
        if (el.editContext || /^(textbox|searchbox)$/.test(el.getAttribute('role') || '')) { stop('needs-keys', { why: 'this editor only accepts real typing' }); break; }
        stop('notfound', { why: `the selector points at a <${el.tagName.toLowerCase()}>, which is not a field that takes text: point at the field inside it, or click it and use a "type" step`, closest: [] }); break;
      }
      if (step.op === 'fill' && (el.isContentEditable || el.editContext)) { stop('needs-keys', { why: 'rich-text editors only accept real typing', surface: !!el.editContext && !el.isContentEditable }); break; }
      if (step.op === 'fill' && el.maxLength > 0 && String(step.value).length > el.maxLength) { stop('verify-failed', { why: `the field only accepts ${el.maxLength} characters and the value has ${String(step.value).length}`, acted: false }); break; }
      try { window.__fsProgress?.(step.i); } catch {}       // tell the engine which step is about to act
      const badSel = step.expect && ['selector', 'gone'].find((k) => { if (step.expect[k] == null) return false; try { document.querySelector(step.expect[k]); return false; } catch { return true; } });
      if (badSel) { popWatch.disconnect(); stop('bad-expect', { why: `"expect.${badSel}" must be a CSS selector, and ${JSON.stringify(step.expect[badSel])} is not one (to wait for words, use "text")`, acted: false }); break; }
      const preMet = step.expect ? expectMet(step.expect) : false;
      if (preMet && step.risk === 'irreversible') { stop('bad-expect', { why: 'the "expect" of this irreversible step is already true before the step, so it could never confirm that the step worked: expect something that only appears afterwards', expect: step.expect, acted: false }); break; }
      let mutations = 0; const urlBefore = location.href;
      const watcher = new MutationObserver((m) => { mutations += m.length; });
      watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const reacted = () => mutations > 0 || location.href !== urlBefore;
      touched.add(el);
      try {
        if (step.op === 'fill' && isSlider(el)) {
          const sl = await slide(el, step.value); lastTouch = performance.now();
          if (sl.keys) { watcher.disconnect(); popWatch.disconnect(); stop('needs-keys', { why: 'the slider only answers real arrow keys', slider: true }); break; }
          if (sl.no) { watcher.disconnect(); popWatch.disconnect(); stop('verify-failed', { why: sl.no, acted: !!sl.acted, slider: true }); break; }
        }
        else if (step.op === 'fill') { fill(el, String(step.value)); lastFilled = el; lastTouch = performance.now(); }
        else if (step.op === 'select') {
          const res = pickOption(el, step.value);
          lastAct = performance.now();
          if (res !== true) { watcher.disconnect(); stop('verify-failed', { why: res === 'disabled' ? 'that option is disabled' : res === 'single' ? 'this list takes one choice only' : res === 'twins' ? 'several options read exactly like that: give the option\'s internal value instead, or use css' : 'no option matches exactly', acted: false, options: [...el.options].map((o) => flat(o.text) + (o.disabled ? ' (disabled)' : '')).filter(Boolean).slice(0, 12) }); break; }
        }
        else if (step.op === 'check' || step.op === 'uncheck') { if (isChecked(el) !== (step.op === 'check')) { pointerClick(el); lastAct = performance.now(); } }
        else if (step.op === 'radio') { if (!isChecked(el)) { pointerClick(el); lastAct = performance.now(); } }
        else if (step.op === 'expand') {
          if (!verify(step, el)) {
            const tg = expandToggle(el, step.target.label ?? step.target.text);
            if (tg) pointerClick(tg);
            else if (/^(treeitem|row)$/.test(el.getAttribute('role') || '')) { try { el.focus({ preventScroll: true }); } catch {} el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true })); }
            else { watcher.disconnect(); stop('verify-failed', { why: 'it has no arrow or header of its own that is safe to press: click the right part yourself with {"click": {"css": ...}}', acted: false }); break; }
            lastAct = performance.now();
            await until(() => verify(step, el), 1500);
          }
        } else if (step.op === 'pick') {
          // A suggestion is something that reads like the value and was NOT there (or not visible) before the field was
          // typed into or opened, or that sits in the list the field itself points to. Nothing here knows any widget library.
          const want = norm(step.value), maxLen = String(step.value).length * 2 + 24;
          const cheap = (o) => o !== el && o.nodeType === 1 && o.children.length <= 4 && o.textContent.length <= maxLen && o.textContent.trim() !== '';
          const lineOf = (o) => { for (let n = o; n && n !== document.body; n = up(n)) { if (n.nodeType === 1 && (!/^(inline|contents)$/.test(getComputedStyle(n).display) || n.matches('[role=option],[role=menuitem],li,option'))) return n; } return o; };
          // the rest of an option's line may be a code or a number ("United States" + "+1", "Small" + "$5.00"), never more words
          const plusCode = (o) => { const line = lineOf(o); if (line === o) return false; const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let rest = ''; for (let n = w.nextNode(); n; n = w.nextNode()) if (!o.contains(n)) rest += ' ' + n.textContent; return !/[\p{L}]/u.test(rest); };
          // (a gap made by spacing instead of a space character is still a gap: "Jordan" "+962" reads "Jordan +962")
          const tight = (z) => norm(z).replace(/ /g, ''), like = (o) => norm(textOf(o)) === want || sim(textOf(o), step.value) >= MATCH || tight(textOf(o)) === tight(step.value);
          const reads = (o) => like(o) && visible(o) && (like(lineOf(o)) || plusCode(o));
          // Second best: the value is the first thing its line says, and the line goes on with more words (a place and
          // its country, a name and an e-mail address). Good only if exactly one line starts like that.
          const leads = (o) => { if (!like(o) || !visible(o)) return false; const line = lineOf(o); if (line === o) return false; const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (flat(n.textContent)) return o.contains(n); return false; };
          const before2 = new Set(qsa('*').filter((o) => cheap(o) && leads(o)));
          let led = null, rivals = [];
          const before = new Set(qsa('*').filter((o) => cheap(o) && reads(o)));
          const wasOpen = isOpener(el) ? el.getAttribute('aria-expanded') === 'true' : !!step.typed;
          const opens = !((el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file|image|reset)$/.test(el.type) && el.readOnly !== true) || el.tagName === 'TEXTAREA' || el.isContentEditable);
          const linked = () => ((el.getAttribute('aria-controls') || '') + ' ' + (el.getAttribute('aria-owns') || '')).split(/\s+/).filter(Boolean).map((id) => el.getRootNode().getElementById?.(id) || document.getElementById(id)).filter(Boolean);
          const fresh = new Set(); let dirty = true, lastHit = null, calls = 0, twins = 0;
          const mo = new MutationObserver((ms) => { dirty = true; for (const m of ms) { if (m.type === 'attributes') fresh.add(m.target); else for (const n of m.addedNodes) if (n.nodeType === 1) fresh.add(n); } });
          for (const r of roots()) mo.observe(r === document ? document.documentElement : r, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded'] });
          let did = !!step.typed;
          const text0 = bodyText();                         // what the page says before anything is typed
          const empty0 = !!step.typed || !flat(el.value ?? '');   // a field that already holds an answer is never overwritten on a guess
          const typable = (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file|image|reset)$/.test(el.type) && el.readOnly !== true) || el.tagName === 'TEXTAREA' || el.isContentEditable;
          if (typable && el.list && [...el.list.options].some((o) => sim(o.value || o.text, step.value) >= MATCH)) {      // a native list of suggestions: the value itself is the choice
            fill(el, [...el.list.options].find((o) => sim(o.value || o.text, step.value) >= MATCH).value); mo.disconnect(); watcher.disconnect(); keepHelpers();
            el.blur(); pending.set(el, { step: { ...step, op: 'fill' }, el, used: false }); lastTouch = performance.now(); stop('ok'); continue;
          }
          if (!typable) { if (el.getAttribute('aria-expanded') !== 'true') { pointerClick(el); did = true; lastAct = performance.now(); } }      // open the list
          else {
            if (!step.typed) { fill(el, step.typeText ?? String(step.value).slice(0, 3)); did = true; }
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
            lastTouch = performance.now();
          }
          const find = () => {
            if (!dirty && ++calls % 4) return lastHit && lastHit.isConnected && visible(lastHit) ? lastHit : null;
            dirty = false;
            const lists = linked(), cand = new Set();
            for (const n of fresh) if (n.isConnected) { cand.add(n); for (const d of n.querySelectorAll('*')) cand.add(d); }
            for (const l of lists) for (const d of l.querySelectorAll('*')) cand.add(d);
            let pool = [...cand].filter((o) => cheap(o) && (!before.has(o) || lists.some((l) => within(o, l))) && reads(o));
            if (!pool.length && wasOpen) pool = [...before].filter((o) => o.isConnected && floatRoot(o) && !within(el, floatRoot(o)) && reads(o));    // the list was already showing
            const deepest = pool.filter((o) => !pool.some((x) => x !== o && within(x, o)));
            const lines = new Set(deepest.map(lineOf));
            if (lines.size > 1) { twins = lines.size; rivals = [...lines].map((l) => textOf(l).slice(0, 80)); return (lastHit = deepest[0]); }      // several choices read exactly alike: not for the engine to choose
            twins = 0; led = null;
            if (!deepest.length) {
              const pool2 = [...cand].filter((o) => cheap(o) && (!before2.has(o) || lists.some((l) => within(o, l))) && leads(o));
              const lines2 = new Set(pool2.map(lineOf));
              if (lines2.size > 1) { twins = lines2.size; rivals = [...lines2].map((l) => textOf(l).slice(0, 80)); return (lastHit = pool2[0]); }
              if (lines2.size === 1) { led = pool2.find((o) => !pool2.some((x) => x !== o && within(x, o))) || pool2[0]; return (lastHit = led); }
            }
            return (lastHit = deepest[0] || null);
          };
          // First a short wait. If nothing shows, the engine checks whether the page asked its server for suggestions:
          // if it did we simply wait longer; if it did not, the field ignored scripted typing and real keys are tried.
          const quick = !step.typed && !opens && !step.timeout;
          // A text box that does not say it offers suggestions, on a page whose words did not change at all when it was
          // typed into (with scripted typing, then with real keys) and that asked its server for nothing, has no list
          // coming: waiting longer is pointless. `still` reports that for this attempt; `inert` is the engine's verdict
          // on the attempts so far. Only for a field that was empty: replacing an answer that is already there with
          // free text, because no suggestion matched, is not the engine's call.
          const declares = el.getAttribute('role') === 'combobox' || ['aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-owns', 'aria-expanded', 'list'].some((a) => el.hasAttribute(a));
          const bare = !!step.typed && !!step.inert && typable && !declares && !step.timeout;
          let opt = await until(find, step.timeout || (quick ? 700 : bare ? 1200 : 4000));
          if (!opt && bare && bodyText() !== text0) opt = await until(find, 2800);
          mo.disconnect();
          const still = typable && !declares && bodyText() === text0;
          if (!opt) { watcher.disconnect(); keepHelpers(); stop('timeout', { why: isOpener(el) ? 'no choice with that text appeared' : `no suggestion matching the value appeared; the field now holds ${JSON.stringify(el.value ?? '')}`, acted: did, reacted: mutations > 0, quick, quiet: mutations === 0, still: still && empty0, plain: bare && still }); break; }
          if (twins) { watcher.disconnect(); keepHelpers(); stop('verify-failed', { why: `${twins} choices read like that (perhaps under different headings, or with a different second line): give the fuller text of the one you mean, or choose by css`, options: rivals.slice(0, 8), acted: did }); break; }
          if (led === opt) rec.note = `no suggestion reads exactly "${String(step.value).slice(0, 40)}"; chose "${textOf(lineOf(opt)).slice(0, 60)}", the only one that starts with it`;
          if (isDisabled(opt) || opt.closest('[aria-disabled=true]')) { watcher.disconnect(); keepHelpers(); stop('verify-failed', { why: 'that choice is switched off', acted: did }); break; }
          const already = new Set(qsa('*').filter((o) => cheap(o) && reads(o)));          // whatever reads like the value before the choice is made proves nothing afterwards
          const menu = floatRoot(opt) || opt.parentElement;
          // for the two weaker proofs below: every word of the chosen line, what was on the page, and what the control said about itself
          // (pages split text into pieces as they please: "+" and "1", "United States" and "+1". The line counts both as it reads and piece by piece.)
          const wordsIn = (root) => { const out = new Set(tokens(textOf(root))), w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) for (const x of tokens(n.textContent)) out.add(x); return out; };
          // the whole row of the choice: its list item, or the part of the list that is its alone (a row laid out as
          // boxes side by side has its main text and its second line in boxes of their own)
          const rowOf = (o) => { const item = o.closest('[role=option],[role=menuitem],li,option'); if (item && within(item, menu)) return item;
            let n = lineOf(o); for (let pa = up(n); pa && pa !== menu && within(pa, menu); pa = up(n)) { const kids = [...pa.children]; if (kids.length >= 2 && kids.every((k) => k.tagName === kids[0].tagName && String(k.className) === String(kids[0].className))) break; n = pa; }
            return n; };
          const lineWords = wordsIn(rowOf(opt)), existed = new WeakSet(qsa('*')), saidBefore = saidNames(el).some((n) => has(n, want));
          pickLists.set(el, menu); pickProof.delete(el);
          pointerClick(opt); lastAct = performance.now();
          const old = new WeakSet(already);
          const closed = () => !menu.isConnected || !visible(menu) || !opt.isConnected || !visible(opt);
          // the list has closed and something new beside the field shows part of the chosen line and nothing else
          const shortForm = () => {
            if (!closed()) return null;
            for (let n = up(el), k = 0; n && k < 4 && n !== document.body; n = up(n), k++) {
              const d = [...n.querySelectorAll('*')].find((x) => { if (x === el || existed.has(x) || x.children.length > 4 || !visible(x) || (menu.isConnected && within(x, menu))) return false; const ws = tokens(textOf(x)); return ws.size > 0 && [...ws].every((t) => lineWords.has(t)); });
              if (d) return { box: n, part: textOf(d) };
            }
            return null;
          };
          const chipBox = () => { for (let n = up(el), k = 0; n && k < 4 && n !== document.body; n = up(n), k++) { if ([...n.querySelectorAll('*')].some((d) => cheap(d) && !already.has(d) && !(menu.isConnected && within(d, menu)) && reads(d))) return n; } return null; };
          // Proof of the choice: a chip that appears beside the field, or the field itself now showing the choice. When
          // the plan typed the whole value, the field showing it proves nothing yet, so the chip gets its chance first.
          const typedAll = !opens && norm(step.typeText ?? String(step.value).slice(0, 3)) === want;
          const typedText = norm(step.typeText ?? String(step.value).slice(0, 3));
          await until(() => {
            const box = chipBox(); if (box) { pickProof.set(el, { box, old, menu }); return true; }
            if (!typedAll && verify(step, el)) return true;
            // the field now holds the chosen line, or part of it ("Paris, France" for the suggestion "Paris" / "France"), not what was typed
            if (closed() && flat(el.value ?? '') && norm(el.value) !== typedText) { const vw = tokens(el.value); if (vw.size && [...vw].every((t) => lineWords.has(t))) { pickProof.set(el, { line: lineWords }); if (norm(el.value) !== want) rec.note = (rec.note ? rec.note + '; ' : '') + `the field shows "${flat(el.value).slice(0, 60)}"`; return true; } }
            if (!saidBefore && el.isConnected && saidNames(el).some((n) => has(n, want))) { pickProof.set(el, { name: true }); return true; }
            const sf = shortForm(); if (sf) { pickProof.set(el, { ...sf, menu }); rec.note = `the field shows "${sf.part.slice(0, 40)}" for this choice`; return true; }
            return false;
          }, 600);
          if (!step.stay && !opens) el.blur();     // do not leave a suggestion menu open over the next control
        } else if (step.op === 'click' && !step.scripted) {
          // A real mouse press is on its way from the engine. Arm a guard for it and hand over the point to press.
          rec.mayNavigate = mayNavigate(el);
          watcher.disconnect();
          armGuard(el, step, preMet);
          stop('armed', { x: h.x, y: h.y, acted: false });                // the spot where the control was found reachable
          break;
        } else if (step.op === 'click') {
          rec.mayNavigate = mayNavigate(el);
          if (el.matches('input,textarea,select,[contenteditable=true]')) el.focus();    // a real click focuses a field; many widgets open on focus
          const o = pressDown(el);
          const bad = drifted();
          if (bad.length) {                                // the click is NOT completed: nothing was submitted
            watcher.disconnect();
            stop('verify-failed', { why: 'a field no longer holds the value that was entered (the page changed it); the click was not completed', fields: bad, acted: false }); break;
          }
          el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
          el.click();
          acted(el);
        }
      } catch (e) { watcher.disconnect(); popWatch.disconnect(); stop('error', { why: String(e) }); break; }

      if (step.op === 'fill' && !el.isContentEditable) {
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        if (!step.stay) { el.blur(); await Promise.resolve(); }   // `stay`: a key press follows, focus must remain here
        if (!verify(step, el)) { watcher.disconnect(); keepHelpers(); stop('verify-failed', { why: el.maxLength > 0 && String(step.value).length > el.maxLength ? `the field only accepts ${el.maxLength} characters` : 'value did not survive leaving the field', got: el.value, acted: true }); break; }
      }
      if (step.op !== 'click' && !verify(step, el)) {
        // script-driven widgets update (or re-create) the control a moment later: look again, freshly resolved
        // (a control that was renamed by the choice is no longer found under its old name: the control itself is asked too)
        const late = step.op === 'fill' ? false : await until(() => { const r2 = resolve(step); return (!!r2.el && verify(step, r2.el)) || (step.op === 'pick' && el.isConnected && verify(step, el)); }, 700);
        if (!late) { watcher.disconnect(); keepHelpers(); stop('verify-failed', { why: step.op === 'pick' ? 'the choice was pressed but the field does not show it' : undefined, shows: step.op === 'pick' ? (ownText(up(el) || el) || undefined)?.slice(0, 80) : undefined, acted: true }); break; }
      }
      keepHelpers();
      if (step.expect) {
        if (preMet) rec.warn = 'the expectation was already true before this step, so it proves nothing';
        const ok = await until(() => expectMet(step.expect), step.expect.timeout || 5000);
        // `acted`: the step was performed. `reacted`: the page visibly responded. Together they tell a slow page from a dead click.
        if (!ok) { watcher.disconnect(); stop('timeout', { why: 'expectation not met', expect: step.expect, acted: true, reacted: reacted() }); break; }
        if (step.op !== 'fill') lastAct = performance.now();
      } else if (step.op === 'click') {
        // a click that should load another page: give the unload a moment to begin, so the engine can wait for the new page
        if (rec.mayNavigate) await until(() => trip?.kind === 'navigation', 400); else await until(reacted, 250);
        rec.reacted = reacted() || trip?.kind === 'navigation';
      }
      watcher.disconnect();
      noteDialogs();
      if (step.op !== 'click' && step.op !== 'expand') pending.set(step.op === 'radio' ? (el.name || el) : el, { step, el, used: false });
      if (step.op === 'fill' && !el.isContentEditable && el.value !== String(step.value)) rec.warn = `the page reformatted the value to ${JSON.stringify(el.value)}`;
      stop('ok');
      if (trip) break;                                    // something appeared or the page is leaving: end the window, let the next step look afresh
    }
    return { steps: out, ms: +(performance.now() - t0).toFixed(2), trip };
  }

  // Before an irreversible step: the step numbers whose controls no longer hold what this run wrote.
  const audit = () => drifted(true);

  // A pop-up is in the way. Foresight never decides by itself what to press in one. A plan may name buttons it allows
  // for this ("popups": ["Reject all", "No thanks"]); then the first of them that the pop-up has is pressed, once -
  // but never in a pop-up that showed up while the plan was at work (it may be the answer to one of its steps), never
  // in one that holds the plan's own work, and only in the layer that really covers the control.
  const pressedOnce = new WeakSet();
  function dismissInterrupt(o = {}) {
    noteDialogs();
    const blocker = lastBlocker?.isConnected ? lastBlocker : null;
    if (!blocker) return { clicked: null, why: 'nothing identifiable is blocking' };
    const layer = overlayOf(blocker, curTarget) || blocker;
    if (!visible(layer) || (curTarget && within(curTarget, layer))) return { clicked: null, why: 'what covers the control is part of the page the control lives in, not a pop-up' };
    const dlgs = openDialogs().filter((d) => within(d, layer) || within(layer, d));
    if (!dlgs.length && !popupLayer(layer)) return { clicked: null, why: 'the blocker is not a pop-up layer' };
    const brief = dialogBrief(dlgs.at(-1) || layer);
    if (qsa(CONTROL, layer).some((c) => touched.has(c)) || dlgs.some(holdsWork)) return { clicked: null, why: 'the dialog contains fields this plan filled', dialog: brief };
    if (dlgs.some((d) => infoOf(d).helper)) return { clicked: null, why: 'a helper for the previous field is still open' };
    if (dlgs.length ? dlgs.some((d) => infoOf(d).caused) : Math.max(lastAct, lastTouch) > -Infinity) return { clicked: null, why: 'a pop-up appeared while the plan was at work. It may be the answer to one of the plan\'s own steps, so it is yours to answer: add a step for it', dialog: brief };
    const names = o.press || [];
    if (!names.length) return { clicked: null, why: 'a pop-up is in the way. Add a step that answers it (or list the buttons you allow for such pop-ups under "popups")', dialog: brief };
    const b = qsa(CLICKABLE, layer).filter((x) => visible(x) && !pressedOnce.has(x)).find((x) => names.some((n) => sim(anyName(x), n) >= MATCH));
    if (!b) return { clicked: null, why: 'the pop-up has none of the buttons the plan allows under "popups"', dialog: brief };
    pressedOnce.add(b); pointerClick(b);
    return { clicked: anyName(b) };
  }
  // Escape closes a helper (a calendar, a list of suggestions) that the previous field left open over the next control.
  // Only then: what blocks must have popped up while the plan was in that field AND be something to choose from. Never
  // for a search box or an editor (Escape empties those), never while a dialog the plan must answer or work in is open.
  const helpers = new WeakMap();
  function helperBlocks(css) {
    let prev = null; try { prev = qsa(css)[0]; } catch {}
    if (!prev || !lastBlocker?.isConnected || prev.type === 'search' || prev.isContentEditable || prev.closest('[contenteditable=true],dialog')) return false;
    const choosable = (h) => h.matches(CLICKABLE + ',td,li') || !!h.querySelector(CLICKABLE + ',td,li,[role=option],[role=gridcell]');
    const hs = (helpers.get(prev) || []).filter((h) => h.isConnected && visible(h) && choosable(h));
    if (!hs.some((h) => within(lastBlocker, h) || within(h, lastBlocker))) return false;
    return noteDialogs().every((d) => infoOf(d).helper || hs.some((h) => within(d, h) || within(h, d)) || (!infoOf(d).caused && !holdsWork(d)));
  }

  function fingerprint() {
    const sig = [...qsa(CONTROL + ',' + CLICKABLE)].filter(visible)
      .map((el) => `${el.tagName}:${el.type || ''}:${norm(namesOf(el)[0] || '')}`).sort().join('|');
    let h = 2166136261; for (let i = 0; i < sig.length; i++) { h ^= sig.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  // a link that is drawn as a button: it has its own filled background or a border all round
  function drawnAsButton(a) {
    const cs = getComputedStyle(a), bg = cs.backgroundColor;
    const filled = !!bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg);
    const boxed = ['Top', 'Right', 'Bottom', 'Left'].every((d) => parseFloat(cs[`border${d}Width`]) > 0 && cs[`border${d}Style`] !== 'none');
    return (filled || boxed) && cs.display !== 'inline';
  }
  // Is this control inside a small box pinned to the window (a promotion, a chat bubble, a sticky bar)?
  function pinnedBox(el) {
    for (let n = up(el); n && n !== document.body && n !== document.documentElement; n = up(n)) {
      if (n.matches(DIALOG)) return null;
      if (getComputedStyle(n).position === 'fixed') { const r = n.getBoundingClientRect(); return r.width * r.height < 0.6 * innerWidth * innerHeight ? n : null; }
    }
    return null;
  }
  const pinNote = (el) => { const b = pinnedBox(el); if (!b) return ''; const t = textOf(b.querySelector('h1,h2,h3,h4,b,strong,legend') || b).slice(0, 30); return `  [in a box pinned to the window${t ? ': ' + JSON.stringify(t) : ''}]`; };
  // One compact look at the page for the planner: every control with its human name and current state.
  // A page that only wants to know whether you are human. No engine should try to get past it.
  function humanCheck(nControls) {
    const bodyText = pageText();
    const n = nControls ?? qsa(CONTROL + ',button,[role=button],input[type=submit]').filter(visible).length;
    const challengeFrame = qsa('iframe').some((f) => (/captcha|challenge|turnstile/i.test(f.src || '') || /captcha|challenge/i.test(f.title || '')) && visible(f) && !pinnedBox(f) && getComputedStyle(f).position !== 'fixed');
    const challengeText = /(verify|confirm|prove|make sure) (that )?you(['’]re| are) (a |not a )?(human|robot|bot)|are you (a )?(human|robot)\??|not a robot|human verification|verifying you are human|security verification|checking (if the site connection is secure|your browser)|unusual traffic|automated (queries|requests|access)|complete the (following )?(captcha|challenge|puzzle)|client challenge|made by a human|select all (squares|images|the)|press (and|&) hold/i.test((document.title + ' ' + bodyText).slice(0, 4000));
    return (challengeText && n <= 6) || (challengeFrame && n <= 2 && flat(bodyText).length < 600);
  }
  function observe() {
    markShown();                                                   // the planner is being shown what is here now
    const seen = new Set(), seenAt = new Map();
    // each line remembers the control it is about, so that lines that read alike can be told apart by where they are
    const lines = [], owner = []; let cur = null;
    { const push = lines.push.bind(lines); lines.push = (...a) => { for (const x of a) { push(x); owner.push(cur); } return lines.length; }; }
    const q = (s) => JSON.stringify(String(s));
    for (const el of qsa(CONTROL)) {
      const t = (el.type || '').toLowerCase(), role = el.getAttribute('role') || '';
      if (!shown(el)) continue;
      cur = el;
      const name = anyName(el) || '(no label)';
      const off = isDisabled(el) ? ' disabled' : '';
      if (t === 'radio' || role === 'radio') {
        const g = groupName(el) || el.name || '(radio)', home = (r) => r.closest('fieldset,[role=radiogroup]') || r.form || document, at = home(el);
        const done = seenAt.get(g) || seenAt.set(g, new Set()).get(g); if (done.has(at)) continue; done.add(at);
        const group = [...qsa('input[type=radio],[role=radio]')].filter((r) => (groupName(r) || r.name || '(radio)') === g && home(r) === at);
        const on = group.find(isChecked);
        lines.push(`radio ${q(g)} options: ${group.map((r) => (anyName(r) || r.value) + (isDisabled(r) ? ' (disabled)' : '')).join(' | ')}${on ? `  (selected: ${anyName(on) || on.value})` : ''}`); continue;
      }
      if (t === 'checkbox' || role === 'checkbox' || role === 'switch') { lines.push(`checkbox ${q(name)}${isChecked(el) ? ' (checked)' : ''}${off}${pinNote(el)}`); continue; }
      if (el.tagName === 'SELECT') {
        const cur = [...el.selectedOptions].map((o) => flat(o.text)).join(', ');
        lines.push(`select${el.multiple ? ' (multiple)' : ''} ${q(name)} options: ${[...el.options].map((o) => flat(o.text)).filter(Boolean).slice(0, 25).join(' | ')}${cur ? `  (selected: ${cur})` : ''}${off}`); continue;
      }
      if (/submit|button|file|image|reset/.test(t)) continue;
      if (role === 'slider' || t === 'range') {
        const at = (k, p) => (el.tagName === 'INPUT' ? el[p] : el.getAttribute('aria-value' + k)) ?? '';
        lines.push(`slider ${q(name)} value=${at('now', 'value')}${at('min', 'min') !== '' && at('max', 'max') !== '' ? ` (from ${at('min', 'min')} to ${at('max', 'max')})` : ''}${el.getAttribute('aria-valuetext') ? ` shown as ${q(el.getAttribute('aria-valuetext'))}` : ''} (set it with "fill")${off}`); continue;
      }
      if (isOpener(el)) { lines.push(`dropdown ${q(name)} (custom: use "pick")${textOf(el) ? `  (shows: ${textOf(el).slice(0, 40)})` : ''}${off}`); continue; }
      const auto = role === 'combobox' || el.getAttribute('aria-autocomplete') || el.getAttribute('list') ? ' (autocomplete)' : '';
      lines.push(`${el.tagName === 'TEXTAREA' ? 'textarea' : `input[${t || 'text'}]`} ${q(name)}${el.value ? ` value=${q(flat(el.value).slice(0, 80))}` : ''}${auto}${el.required ? ' required' : ''}${el.readOnly ? ' readonly' : ''}${off}${pinNote(el)}`);
    }
    { const files = qsa('input[type=file]');
      for (const el of files) {
        const n = anyName(el), cap = fileCaption(el, files), byCap = !!cap && sim(cap, n) < MATCH;      // the heading of its section says more than a shared button label
        lines.push(`upload ${q(byCap ? cap : n || cap || 'file')}${byCap && n ? `  (also: ${q(n)})` : ''}${el.multiple ? ' (several files allowed)' : ''}`);
      } }
    for (const el of qsa(EXPANDABLE)) {
      if (!visible(el) || el.matches('input,select') || opensList(el)) continue;
      const n = expName(el);
      if (n) lines.push(`expandable ${q(n)} (${(el.tagName === 'DETAILS' ? el.open : el.getAttribute('aria-expanded') === 'true') ? 'expanded' : 'collapsed'})`);
    }
    const links = [];
    cur = null;
    // column headers that sort the table when pressed
    { let k = 0; for (const el of qsa('th,[role=columnheader]')) { if (k >= 20) break; const tx = flat(el.textContent);      // (as written, not as a style sheet capitalises it)
        if (!visible(el) || !tx || tx.length > 40 || el.querySelector(CLICKABLE + ',' + CONTROL) || !(el.hasAttribute('aria-sort') || getComputedStyle(el).cursor === 'pointer' || /sort/i.test(String(el.className)))) continue;
        k++; lines.push(`column header ${q(tx)} (press to sort${el.getAttribute('aria-sort') && el.getAttribute('aria-sort') !== 'none' ? '; now ' + el.getAttribute('aria-sort') : ''})`); } }
    for (const el of qsa(CLICKABLE)) {
      if (!visible(el)) continue;
      cur = el;
      let n = anyName(el); if (!n) continue;
      if (opensList(el)) { lines.push(`dropdown ${q(n.slice(0, 80))} (custom: use "pick")${isDisabled(el) ? ' disabled' : ''}`); continue; }      // a button that opens a list of choices
      if (n.length > 150) n = n.slice(0, 150).replace(/\s+\S*$/, '') + ' …';
      // a hidden label that says more than the visible text can be used as the name too
      const more = hiddenNames(el).find((x) => visibleNames(el).length && norm(x) !== norm(n) && has(norm(x), norm(n)));
      const also = more ? `  (also: ${q(more.slice(0, 150))})` : '';
      const buttonish = el.tagName !== 'A' || el.getAttribute('role') === 'button' || drawnAsButton(el);
      if (buttonish) lines.push(`button ${q(n)}${also}${isDisabled(el) ? ' disabled' : ''}${pinNote(el)}`); else links.push(n + (more ? `  (also: ${more.slice(0, 150)})` : ''));
    }
    cur = null;
    for (const el of iconButtons(document)) { if (visible(el)) { const n = anyName(el).slice(0, 60); if (n) lines.push(`button ${q(n)}`); } }
    let loose = 0;
    for (const el of qsa('[tabindex]:not([tabindex="-1"])')) {
      if (loose >= 25) break;
      if (!visible(el) || el.matches(CONTROL + ',' + CLICKABLE + ',' + EXPANDABLE) || el.closest(CLICKABLE) || el.querySelector(CONTROL + ',' + CLICKABLE)) continue;
      const tx = textOf(el); if (!tx || tx.length > 50) continue;
      const cap = nearbyLabel(el); loose++;
      lines.push(`pressable ${q(tx)}${cap ? ` beside ${q(cap.slice(0, 40))}` : ''}`);
    }
    for (const el of qsa('button,[role=button]')) {
      if (visible(el) || !el.parentElement) continue;
      let a = up(el), k = 0; while (a && !visible(a) && k++ < 3) a = up(a);
      const cs = getComputedStyle(el);
      if (!a || !visible(a) || (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0')) continue;
      const cls = String(el.className || '').trim().split(/\s+/)[0];
      lines.push(`hidden button ${anyName(el) ? q(anyName(el).slice(0, 40)) + ' ' : ''}css ${q(el.tagName.toLowerCase() + (cls ? '.' + cls : ''))} (not visible now; may appear on hover)`);
    }
    // collapse repeats ("Add to basket" x20) so the list stays readable
    // fields and tick boxes of one name: say where each one is, when the page gives them places of their own
    const sameName = new Map(), told = lines.slice();
    lines.forEach((l, k) => { const key = owner[k] && (l.match(/^(?:input\[[a-z-]*\]|textarea|select(?: \(multiple\))?|checkbox|dropdown|slider|radio) "(?:[^"\\]|\\.)*"/) || [])[0]; if (key) (sameName.get(key) || sameName.set(key, []).get(key)).push(k); });
    for (const ks of sameName.values()) {
      if (ks.length < 2 || ks.length > 12) continue;
      const ws = ks.map((k) => rowWord(owner[k]) || placeWord(owner[k]));
      if (ws.every(Boolean) && new Set(ws).size > 1) ks.forEach((k, j) => { told[k] = `${told[k]}  ${ws[j]}`; });
    }
    const count = new Map(); for (const l of told) count.set(l, (count.get(l) || 0) + 1);
    const controls = [...count].map(([l, c]) => (c > 1 ? `${l}  x${c}` : l));
    const frames = [...qsa('iframe')].filter((f) => { const r = f.getBoundingClientRect(); return visible(f) && r.width > 80 && r.height > 40; }).length;
    const dlg = topDialog();
    // a page that only wants to know whether you are human: no engine should try to get past it
    // (a small "protected by ..." badge pinned to a corner of an ordinary page is not a check)
    const bodyText = pageText();
    const botCheck = humanCheck(controls.length);
    return { url: location.href, title: flat(document.title), frames, botCheck, dialog: dlg ? textOf(dlg).slice(0, 120) : null, dialogButtons: dlg ? dialogBrief(dlg).buttons : [],
      headings: [...qsa('h1,h2,h3,h4,h5,legend')].filter(visible).map(textOf).filter(Boolean).slice(0, 12), controls, links: [...new Set(links)] };
  }
  // Tables as rows of cells, for reading data out.
  function tables() {
    return [...qsa('table')].filter(visible).slice(0, 6).map((t) => [...t.rows].slice(0, 80).map((r) => [...r.cells].map((c) => textOf(c).slice(0, 60)).join(' | ')));
  }
  // Lines of visible text that mention something, with a line of context.
  // What the page says about some words: for each place they occur, the text of the record they belong to (the card,
  // the table row, the paragraph), never lines from the record before or after it.
  function find(needle) {
    const want = norm(needle); if (!want) return [];
    const low = String(needle).toLowerCase(), head = (norm(needle).split(' ')[0] || '');
    const starts = [];
    for (const root of roots()) {
      const base = root === document ? document.body : root; if (!base) continue;
      const tw = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n && starts.length < 60; n = tw.nextNode()) {
        const pe = n.parentElement;
        if (!pe || !n.textContent.toLowerCase().includes(head.slice(0, 3)) || !has(norm(n.textContent), want) || pe.closest('script,style,noscript,template') || !visible(pe)) continue;
        starts.push(pe);
      }
    }
    if (!starts.length) {                                    // the words are spread over several elements: go by whole lines
      const ls = pageText().split('\n').map(flat).filter(Boolean), out = [];
      for (const l of ls) if (has(norm(l), want)) { const at = Math.max(0, l.toLowerCase().indexOf(low)); out.push(l.length <= 320 ? l : (at > 100 ? '… ' : '') + l.slice(Math.max(0, at - 100), at + 220) + ' …'); }
      return out.slice(0, 20);
    }
    const out = [], seen = new Set();
    for (const el of starts) {
      let blk = el;
      for (let k = 0; k < 6; k++) {
        const par = blk.parentElement, len = textOf(blk).length;
        if (!par || par === document.body || len >= 200 || textOf(par).length > Math.max(160, 4 * len)) break;      // the parent holds far more than this record
        const peers = [...par.children].some((c) => alike(c, blk));
        if (peers && len > String(needle).length + 10 && !/^(TD|TH)$/.test(blk.tagName)) break;      // one of several records of the same kind: this is the record
        blk = par;
      }
      if (seen.has(blk)) continue; seen.add(blk);
      let tx = (blk.innerText || blk.textContent || '').split(/\n+/).map(flat).filter(Boolean).join('  /  ');
      if (tx.length > 320) { const at = Math.max(0, tx.toLowerCase().indexOf(low)); tx = (at > 100 ? '… ' : '') + tx.slice(Math.max(0, at - 100), at + 220) + ' …'; }
      if (tx) out.push(tx);
      if (out.length >= 20) break;
    }
    return out;
  }
  // The cell where a row (named by its first column) meets a column (named by its header), in any table on the page.
  function readCell(row, col) {
    const out = [];
    for (const t of qsa('table').filter(visible)) {
      const g = gridOf(t);
      for (let r = 0; r < g.occ.length; r++) {
        const key = g.occ[r]?.[0];
        if (g.heads.includes(r) || !key || sim(textOf(key), row) < MATCH) continue;
        for (let c = 0; c < g.occ[r].length; c++) {
          if (!g.heads.some((h) => g.occ[h]?.[c] && sim(textOf(g.occ[h][c]), col) >= MATCH)) continue;
          const cell = g.occ[r][c], f = cell && cell.querySelector('input:not([type=hidden]),select,textarea');
          if (cell) out.push((f && f.value ? flat(f.value) : textOf(cell)).slice(0, 300));
        }
      }
    }
    return out;
  }

  // Upload fields often share one button label ("Attach", "Choose file"). What tells them apart for a person is the
  // block each one sits in: the largest part of the page that holds this upload field and no other.
  function fileBlock(el, all) {
    let block = null;
    for (let n = up(el); n && n !== document.body && n !== document.documentElement; n = up(n)) {
      if (all.some((o) => o !== el && within(o, n))) break;
      block = n;
    }
    return block;
  }
  // ... and the heading of that block: the label of the group it is in, or the first words of the block.
  function fileCaption(el, all) {
    for (let n = up(el), k = 0; n && n !== document.body && k < 8; n = up(n), k++) {
      if (all.some((o) => o !== el && within(o, n))) break;
      const lab = (n.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(' ')
        || n.getAttribute('aria-label') || (n.tagName === 'FIELDSET' ? textOf(n.querySelector('legend')) : '');
      if (flat(lab)) return flat(lab).slice(0, 80);
    }
    if (all.length < 2) return '';
    const block = fileBlock(el, all); if (!block) return '';
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const pe = n.parentElement;
      if (!pe || !flat(n.textContent) || !visible(pe) || pe.closest('button,a,[role=button],label[for],select,option,textarea,script,style')) continue;
      return textOf(pe).slice(0, 80);
    }
    return '';
  }
  // File inputs are usually hidden behind a styled button, so they are matched by name even when not visible.
  function locateFile(step) {
    const t = step.target, all = qsa('input[type=file]');
    // "the 2nd": by where a person sees each field (its nearest visible box), top to bottom, then left to right
    const order = (list) => {
      const box = (e) => { let b = e; while (b && !visible(b)) b = up(b); return (b || e).getBoundingClientRect(); };
      return [...list].sort((a, b) => { const ra = box(a), rb = box(b); return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : Math.abs(ra.left - rb.left) > 4 ? ra.left - rb.left : (a.compareDocumentPosition(b) & 4 ? -1 : 1); });
    };
    // "near" and "nth" choose among upload fields that fit the name equally well; they never replace the name
    const narrow = (cands) => {
      let c = cands;
      if (t.near) c = c.filter((e) => nearFactor(e, t.near, (o) => cands.includes(o)) === 1);
      if (t.nth) { const o = order(c), pick = t.nth > 0 ? o[t.nth - 1] : o[o.length + t.nth]; c = pick ? [pick] : []; }
      return c;
    };
    const label = (e) => { const c = fileCaption(e, all), n = anyName(e); return c && sim(c, n) < MATCH ? `${n || 'file input'} in "${c.slice(0, 40)}"` : n || c || 'file input'; };
    if (t.css) {
      let els = []; try { els = qsa(t.css).filter((e) => e.matches('input[type=file]')); } catch { return { found: false, why: 'the css selector is not valid' }; }
      if (els.length > 1 && (t.near || t.nth)) els = narrow(els);
      return els.length === 1 ? { found: true, css: cssPath(els[0]), p: 0.99, multiple: els[0].multiple } : { found: false, count: els.length };
    }
    const want = t.label ?? t.text;
    const scoreOf = (el) => Math.max(0, ...namesOf(el).map((n) => sim(n, want)), ...weakNames(el).map((n) => sim(n, want) * 0.8), sim(nearbyLabel(el), want) * 0.94, sim(textOf(up(el) || el), want) * 0.85, sim(fileCaption(el, all), want) * 0.97);
    const scored = all.map((el) => [el, scoreOf(el)]).sort((a, b) => b[1] - a[1]);
    if (!scored.length) return { found: false, count: 0 };
    const closest = scored.slice(0, 5).map(([e, x]) => `${label(e)} (${x.toFixed(2)})`);
    const [el, sc] = scored[0];
    if ((t.near || t.nth) && sc >= MATCH) {
      const ties = scored.filter(([, x]) => x >= sc - 0.001).map(([e]) => e), left = narrow(ties);
      if (left.length === 1) return { found: true, css: cssPath(left[0]), p: sc, closest, multiple: left[0].multiple, picked: ties.length > 1 ? `${ties.length} upload fields are named "${anyName(left[0]).slice(0, 40)}"; used the one ${t.near ? `near "${t.near}"` : `counted ${t.nth > 0 ? t.nth : ties.length + t.nth + 1} of ${ties.length}`}${fileCaption(left[0], all) ? ` ("${fileCaption(left[0], all).slice(0, 40)}")` : ''}` : undefined };
      return { found: true, css: cssPath(el), p: 0.5, closest, why: left.length ? 'several upload fields with that name are near those words' : t.near ? 'no upload field with that name is near those words' : `there are only ${ties.length} upload fields with that name` };
    }
    const named = namesOf(el).length > 0 || !!nearbyLabel(el);
    // the only upload field on the page is the upload field, unless it carries a name that says it is for something else
    const p = scored.length === 1 ? (!named ? Math.max(sc, 0.95) : sc) : (scored[1][1] < MATCH ? sc : 0.5);
    return { found: true, css: cssPath(el), p, closest, multiple: el.multiple, why: p === 0.5 && sc >= MATCH ? 'several upload fields have that name: add "near" (words of its section) or "nth", or use the section heading as the name' : undefined };
  }
  // Proof of an upload. Many pages take the file and then swap the <input> for the file's name and a remove button,
  // so "the input holds the file" cannot be the only proof. Before the file is set the engine notes what the field's
  // block looks like; afterwards one of these must be true:
  //   - the input holds the files;
  //   - the input is gone and the file's name now shows on the page, or a control to remove/replace the file appeared in its block;
  //   - the input is still there but empty, the file's name now shows AND a new control appeared in its block
  //     (a page that rejects a file may name it in an error message, so the name alone is not enough there).
  const UNDO = /(^|[^\p{L}])(remove|delete|clear|replace|change|discard|entfernen|löschen|supprimer|retirer|eliminar|quitar|rimuovi|verwijderen|удалить|إزالة|حذف)([^\p{L}]|$)/iu;
  const shownTimes = (name) => {
    const hay = String(document.body?.innerText || '').toLowerCase(), low = name.toLowerCase(), stem = low.replace(/\.[^.]+$/, '');
    const count = (x) => (x ? hay.split(x).length - 1 : 0);
    return [count(low), stem.length >= 4 ? count(stem) : 0, stem.length >= 14 ? count(stem.slice(0, 12)) : 0];      // whole name / without extension / cut short by the page
  };
  let uploadMark = null;
  function markUpload(css, names) {
    const el = qsa(css)[0]; if (!el) return false;
    const all = qsa('input[type=file]');
    let block = fileBlock(el, all);
    if (all.length < 2) { block = el; for (let k = 0; k < 4 && up(block) && up(block) !== document.body; k++) block = up(block); }      // the only upload field: its near surroundings
    uploadMark = { el, block, names, had: new WeakSet(block ? [block, ...block.querySelectorAll('*')] : []), before: names.map(shownTimes) };
    return true;
  }
  function uploadProof() {
    const m = uploadMark; if (!m) return { ok: false };
    const held = m.el.isConnected && m.el.files ? [...m.el.files].map((f) => f.name) : null;
    if (held && held.length === m.names.length && m.names.every((n) => held.includes(n))) return { ok: true, by: 'input' };
    const shown = m.names.every((n, i) => shownTimes(n).some((x, k) => x > m.before[i][k]));
    const block = m.block && m.block.isConnected ? m.block : null;
    const fresh = block ? [...block.querySelectorAll(CLICKABLE)].filter((o) => !m.had.has(o) && visible(o)) : [];
    const gone = !m.el.isConnected && !(block && block.querySelector('input[type=file]'));
    const undo = fresh.find((o) => UNDO.test([...namesOf(o), textOf(o)].join(' ')));
    if (gone && shown) return { ok: true, by: 'name', note: 'the page replaced the upload field with the file\'s name' };
    if (gone && undo) return { ok: true, by: 'control', note: `the page replaced the upload field with "${(anyName(undo) || textOf(undo)).slice(0, 40)}"` };
    if (!gone && shown && fresh.length) return { ok: true, by: 'name', note: 'the page emptied the upload field and now shows the file\'s name' };
    return { ok: false, held, gone, shown, appeared: fresh.map((o) => (anyName(o) || textOf(o)).slice(0, 40)).filter(Boolean).slice(0, 4) };
  }
  const fileNames = (css) => { const el = qsa(css)[0]; return el && el.files ? [...el.files].map((f) => f.name) : null; };
  // Text of what a target points at, for plans that need to read something back.
  function read(target) {
    const all = readAll(target), n = target && typeof target === 'object' ? target.nth : null;
    if (!Number.isInteger(n) || n === 0) return all.slice(0, 30);
    const one = n > 0 ? all[n - 1] : all[all.length + n];
    return one === undefined ? [] : [one];
  }
  function readAll(target) {
    if (typeof target === 'string') return find(target);
    if (target.row != null) return readCell(target.row, target.col);
    try { if (target.css) return qsa(target.css).filter(visible).slice(0, 200).map((e) => (e.value !== undefined && e.value !== '' && /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) ? flat(e.value) : textOf(e))).map((x) => (x.length > 1500 ? x.slice(0, 1500) + ' …(cut)' : x)); } catch { return ['(the css selector is not valid)']; }
    return find(target.text ?? target.label ?? '');
  }
  function scrollPage(dir) {
    const el = document.scrollingElement || document.documentElement, before = el.scrollTop;
    if (dir === 'top') el.scrollTop = 0; else if (dir === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop += (dir === 'up' ? -1 : 1) * Math.round(innerHeight * 0.85);
    return { moved: el.scrollTop !== before, atEnd: el.scrollTop + innerHeight >= el.scrollHeight - 2 };
  }
  const frameText = () => flat(pageText()).slice(0, 240);
  const boxOf = (css) => { const el = qsa(css)[0]; if (!el) return null; centre(el); const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };

  // Where is this target? (used for real-mouse actions from the node side)
  function locate(step) {
    const r = resolve(step);
    if (!r.el) return { found: false, closest: lastCandidates };
    let el = r.el; if (!visible(el)) { while (el && !visible(el)) el = up(el); }
    if (!el) return { found: false };
    centre(el); const b = el.getBoundingClientRect();
    const reach = probe(el);
    return { found: true, reach: reach.ok, blocker: reach.ok ? undefined : reach.blocker, picked: r.picked, p: confidence(step, r), score: r.score, margin: r.margin, css: cssPath(r.el), hoverCss: cssPath(el), hidden: !!r.hidden, disabled: isDisabled(r.el), x: b.left + b.width / 2, y: b.top + b.height / 2, closest: lastCandidates };
  }
  // Resolves once the page has stopped changing for a moment (so nothing acts on, or snapshots, a half-built page).
  function quiet(idle = 150, max = 1500) {
    return new Promise((res) => {
      let t = setTimeout(done, idle); const end = setTimeout(done, max);
      const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, idle); });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      function done() { mo.disconnect(); clearTimeout(t); clearTimeout(end); res(true); }
    });
  }
  // A freshly loaded page: let its own scripts finish wiring up (handlers bound on ready/load run a beat after DOMContentLoaded).
  async function ready(max = 1200) {
    const end = performance.now() + max;
    if (document.readyState !== 'complete') await new Promise((res) => { const t = setTimeout(res, max); addEventListener('load', () => { clearTimeout(t); res(); }, { once: true }); });
    await new Promise((res) => setTimeout(res, 0)); await new Promise((res) => setTimeout(res, 0));
    await quiet(60, Math.max(60, Math.min(500, end - performance.now())));
    return true;
  }
  const focusInfo = () => { const a = deepActive(); return { editable: !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || !!a.editContext || (/^(textbox|searchbox|combobox)$/.test(a.getAttribute?.('role') || '') && a !== document.body)) && a.readOnly !== true && !isDisabled(a), tag: a?.tagName?.toLowerCase() || null, name: a && a !== document.body ? anyName(a).slice(0, 60) : '' }; };

  window.__FS = {
    version: 14, dialogs: () => noteDialogs().map((d) => ({ tag: d.tagName.toLowerCase(), id: d.id || undefined, modal: isModal(d), ...infoOf(d), holdsWork: holdsWork(d) })), seen: () => { markShown(); return true; }, track, unit: { sim, has: (h, n) => has(norm(h), norm(n)), looseEq }, begin, acted, helperBlocks, pressing: () => { lastAct = performance.now(); keyFocus = deepActive(); return true; }, carry: (pressed) => { if (pressed) pressedBefore = true; return true; }, keysSafe, armAt, leaving: () => performance.now() - leavingAt < 4000, finishClick, disarm: () => { const g = disarm(); if (g) g.watcher.disconnect(); return true; }, frameText, locateFile, fileNames, markUpload, uploadProof, bodyText, read, scrollPage, boxOf, pageText, drifted, consume: acted, observe, tables, find, locate, quiet, ready, focusInfo, runWindow, audit, dismissInterrupt, fingerprint,
    check: (step) => { const r = resolve(step); return !!r.el && verify(step, r.el); },
    humanCheck: () => humanCheck(),
    // (a layer that no longer takes presses is on its way out: give it a moment more to leave altogether, since a
    // widget may ignore a new press while its old list is still closing)
    blockerGone: (ms) => {
      const b = lastBlocker;
      return until(() => { if (!b || !b.isConnected || !b.getClientRects().length) return true; const cs = getComputedStyle(b); return cs.display === 'none' || cs.visibility === 'hidden'; }, ms);
    },
    focusInHelper: (css) => { let prev = null; try { prev = qsa(css)[0]; } catch {} const a = deepActive(); return !!prev && !!a && (helpers.get(prev) || []).some((h) => h.isConnected && within(a, h)); },
    sliderNow: (css) => { const el = qsa(css)[0]; return el ? sliderAt(el) : NaN; },
    emptyNow: (css) => { const el = qsa(css)[0]; return !el || !/[\p{L}\p{N}]/u.test(el.isContentEditable ? el.innerText : el.value ?? el.innerText ?? ''); },
    expect: (e) => until(() => expectMet(e), e.timeout || 5000).then(Boolean),
    expectNow: (e) => expectMet(e),
    // Wait for a step's control to become choosable. `settle`: something similar is already on the page, so the wait
    // is short (a list still re-drawing); a name that is merely close does not become exact by waiting.
    waitFor: (step, ms, afterPress) => { const good = () => { const r = resolve(step); return !!r.el && !r.hidden && confidence(step, r) >= step.threshold; };
      awaiting = !!afterPress; return until(good, ms).then((v) => { awaiting = false; noteDialogs(); return !!v; }); },
  };
}
