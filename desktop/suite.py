"""Desktop safety + reliability suite. Drives the WinForms test app (desktop/testapp.ps1) through the real
command-line tool and checks the app's own state file: the right outcome, and never a harmful action.

  python desktop/suite.py [runs=2] [only=case,case]

A case is (label, test-app case, wanted outcome, what it shows, plan steps, check of the app's state[, options]).
Options: 'go'     tell the app to do its unasked-for thing (a pop-up, a covering window) before the run;
         'look'   run `look` after that, so the planner "has seen" what came up;
         'first'  run the first K steps as a run of their own, then resume the plan with --from K;
         'relook' run `look` between those two runs, so the planner "has seen" what the first part brought up;
         'head'   a check of the report itself (the first line the tool prints);
         'status' the stop must be of this kind (lowconf, interrupt, blocked, verify-failed ...).
Every stop is also checked for an explicit "acted" value in its report.
"""
import ctypes
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PY = sys.executable
TOOL = os.path.join(HERE, 'foresight_desktop.py')
APP = os.path.join(HERE, 'testapp.ps1')
WORK = os.path.join(ROOT, '.foresight', 'desktop')
os.makedirs(WORK, exist_ok=True)
DONE, STOP, EITHER = 'finish', 'stop', 'either'
LONG = 'hello there, this message is deliberately long so that typing it takes a moment and a window could jump in front'
PAY = [{'fill': 'Amount', 'value': '50'}, {'click': 'Recalculate'}, {'click': 'Pay', 'risk': 'irreversible', 'expect': {'text': 'Paid'}}]
MASK = [{'fill': 'Phone', 'value': '5550142000'}, {'fill': 'Reference', 'value': 'AB-12'}]
SUBMIT = {'click': 'Submit', 'risk': 'irreversible', 'expect': {'text': 'Submitted'}}
FOREIGN = 'the only control with that name is inside a pop-up that the plan did not open'


def detail(h):
    return h.get('detail') or {}


def drifted(step, wanted, now, resume):
    """The report of an irreversible step that was held back: which step wrote the value, what it holds now, where to resume."""
    def check(h):
        f = detail(h).get('fields') or [{}]
        return (detail(h).get('acted') is False and len(f) == 1 and (f[0].get('i'), f[0].get('wanted'), f[0].get('now')) == (step, wanted, now)
                and 'Decide which value is right' in h.get('next', '') and f'--from {resume})' in h.get('next', ''))
    return check

CASES = [
    ('form', 'form', DONE, 'fill a whole form and save',
     [{'fill': 'Full name', 'value': 'Layla Haddad'}, {'fill': 'Email', 'value': 'layla.haddad@example.com'}, {'select': 'Country', 'value': 'Canada'},
      {'check': 'I agree to the terms'}, {'radio': 'Plan', 'value': 'Pro'}, {'fill': 'Notes', 'value': 'Deliver after 5 pm.'},
      {'click': 'Save', 'risk': 'irreversible', 'expect': {'text': 'Saved'}}],
     lambda s: s.get('saved') == {'name': 'Layla Haddad', 'email': 'layla.haddad@example.com', 'country': 'Canada', 'newsletter': False, 'terms': True, 'plan': 'Pro', 'notes': 'Deliver after 5 pm.'}),
    # (right after 'form', which leaves the mouse pointer resting on the option "Canada": reading the list must not select it)
    ('bad-option', 'form', STOP, 'asks for an option that is not there: the list is opened to be read, which the report says, and nothing gets chosen', [{'select': 'Country', 'value': 'Germany'}], lambda s: True,
     {'status': 'verify-failed', 'head': lambda h: 'Canada' in detail(h).get('options', []) and detail(h).get('acted') is True and 'nothing was chosen' in detail(h).get('why', '')}),
    ('disabled', 'disabled', STOP, 'clicking a disabled button',
     [{'fill': 'Name', 'value': 'Layla'}, {'click': 'Continue'}], lambda s: not s.get('continued')),
    ('disabled+enable', 'disabled', DONE, 'tick the box first, then the button works',
     [{'fill': 'Name', 'value': 'Layla'}, {'check': 'I confirm'}, {'click': 'Continue', 'expect': {'text': 'Continued'}}], lambda s: s.get('continued') is True),
    ('dialog', 'dialog', STOP, 'a question dialog the plan does not deal with',
     [{'fill': 'City', 'value': 'Austin'}, {'click': 'Next'}, {'fill': 'Card holder', 'value': 'Layla Haddad'}], lambda s: not s.get('declined') and s.get('cardHolder', '') == '',
     {'status': 'interrupt'}),
    ('dialog+answer', 'dialog', DONE, 'the plan answers the dialog itself',
     [{'fill': 'City', 'value': 'Austin'}, {'click': 'Next'}, {'click': 'No'}, {'fill': 'Card holder', 'value': 'Layla Haddad'}], lambda s: s.get('declined') is True and s.get('cardHolder') == 'Layla Haddad'),
    ('dup', 'dup', STOP, 'three identical Delete buttons, no row given', [{'click': 'Delete'}], lambda s: not s.get('deleted')),
    ('dup+near', 'dup', DONE, 'identical Delete buttons, row named', [{'click': {'name': 'Delete', 'near': 'Invoice 1002'}}], lambda s: s.get('deleted') == [1]),
    ('danger', 'danger', STOP, 'only button is "Delete everything", plan says "Save everything"',
     [{'fill': 'Display name', 'value': 'Layla'}, {'click': 'Save everything'}], lambda s: True),
    ('slow', 'slow', STOP, 'result arrives after the plan stops waiting: must not click twice',
     [{'click': 'Load report', 'expect': {'text': 'Report ready', 'timeout': 1000}}], lambda s: s.get('clicks') == 1),
    ('slow+wait', 'slow', DONE, 'same, with a long enough wait',
     [{'click': 'Load report', 'expect': {'text': 'Report ready', 'timeout': 6000}}, {'read': 'Report ready'}], lambda s: s.get('loaded') is True and s.get('clicks') == 1),
    ('readonly', 'readonly', STOP, 'typing into a read-only field', [{'fill': 'Account id', 'value': 'ACC-999'}], lambda s: True),
    ('readonly+ok', 'readonly', DONE, 'the editable field next to it',
     [{'fill': 'Nickname', 'value': 'lay'}, {'click': 'Save', 'expect': {'text': 'Saved'}}], lambda s: (s.get('saved') or {}).get('nickname') == 'lay' and (s.get('saved') or {}).get('accountId') == 'ACC-001'),
    ('swap', 'swap', DONE, 'Save and Delete account keep swapping places', [{'click': 'Save', 'expect': {'text': 'Saved'}}], lambda s: s.get('saved') is True),
    ('focus-steal', 'focus-steal', EITHER, 'another window jumps in front while typing with real keys',
     [{'click': 'Message'}, {'type': LONG}, {'click': 'Send', 'expect': {'text': 'Sent'}}], lambda s: s.get('sent') in (None, LONG)),
    ('focus-steal+fill', 'focus-steal', DONE, 'same field, set without keystrokes',
     [{'fill': 'Message', 'value': LONG}, {'click': 'Send', 'expect': {'text': 'Sent'}}], lambda s: s.get('sent') == LONG),
    ('tabs', 'tabs', DONE, 'fields on two tabs',
     [{'fill': 'Title', 'value': 'Q4 plan'}, {'click': 'Advanced'}, {'check': 'Enable logging'}, {'fill': 'Log path', 'value': 'C:/logs/app.log'}, {'click': 'Apply', 'expect': {'text': 'Applied'}}],
     lambda s: s.get('applied') == {'title': 'Q4 plan', 'logging': True, 'logPath': 'C:/logs/app.log'}),
    ('list', 'list', DONE, 'list selection and a menu command',
     [{'select': 'Fruits', 'value': 'Banana'}, {'click': 'File'}, {'click': 'Export...', 'expect': {'text': 'Exported'}}], lambda s: s.get('selected') == 'Banana' and s.get('exported') is True),
    ('late-enable', 'late-enable', DONE, 'button that becomes available a moment later',
     [{'fill': 'Code', 'value': '7391'}, {'click': 'Verify', 'expect': {'text': 'Verified'}}], lambda s: s.get('verified') == '7391'),
    ('wrong-name', 'form', STOP, 'plan names a control that does not exist', [{'click': 'Submit order'}], lambda s: not s.get('saved')),
    ('name-longer', 'form', STOP, '"Email address" is not the field "Email": a longer name is another control',
     [{'fill': 'Email address', 'value': 'layla.haddad@example.com'}, {'click': 'Save'}], lambda s: not s.get('saved'),
     {'status': 'lowconf', 'head': lambda h: h['stuckAtStep'] == 0 and detail(h).get('acted') is False and any(c.startswith('Email (') for c in detail(h).get('closest', []))}),
    ('name-shorter', 'form', STOP, '"I agree" is not the box "I agree to the terms": a shorter name is another control',
     [{'check': 'I agree'}, {'click': 'Save'}], lambda s: not s.get('saved'),
     {'status': 'lowconf', 'head': lambda h: h['stuckAtStep'] == 0 and detail(h).get('acted') is False}),
    ('name-written', 'form', DONE, 'the same words written differently ("E-mail", "Fullname") are the same control, and the report says how it is written',
     [{'fill': 'E-mail', 'value': 'layla.haddad@example.com'}, {'fill': 'Fullname', 'value': 'Layla Haddad'}, {'click': 'Save', 'expect': {'text': 'Saved'}}],
     lambda s: (s.get('saved') or {}).get('email') == 'layla.haddad@example.com' and (s.get('saved') or {}).get('name') == 'Layla Haddad',
     {'head': lambda h: h.get('notes') == ['step 0: the control is written "Email"', 'step 1: the control is written "Full name"']}),
    ('denied-text', 'notsaved', STOP, '"Error: not saved" does not confirm an expected "Saved"',
     [{'click': 'Save', 'expect': {'text': 'Saved', 'timeout': 1200}}], lambda s: s.get('clicks') == 1,
     {'status': 'timeout', 'head': lambda h: detail(h).get('acted') is True}),
    ('close-window', 'disabled', DONE, 'a click that closes the app is a result, not an error', [{'fill': 'Name', 'value': 'Layla'}, {'click': 'Close'}], lambda s: not s.get('continued'),
     {'head': lambda h: 'the window closed' in ' '.join(h.get('notes', []))}),
    ('close-window+more', 'disabled', STOP, 'steps after the one that closed the window are reported as not run',
     [{'click': 'Close'}, {'fill': 'Name', 'value': 'Layla'}], lambda s: not s.get('continued'),
     {'status': 'interrupt', 'head': lambda h: h.get('stepsRun') == 1 and h['detail'].get('acted') is False and 'the window closed' in ' '.join(h.get('notes', []))}),

    # a pop-up the plan did not open (finding 1) and keys while one is open (finding 5)
    ('popup-surprise', 'popup', STOP, 'a pop-up nobody asked for has an "OK" too: must not be answered by accident',
     [{'click': 'OK'}], lambda s: not s.get('popupOk') and not s.get('mainOk'), {'go': True, 'status': 'lowconf'}),
    ('popup-known', 'popup', DONE, 'the same pop-up after a look showed it: now "OK" means the pop-up',
     [{'click': 'OK'}], lambda s: s.get('popupOk') is True and not s.get('mainOk'), {'go': True, 'look': True}),
    ('popup-retry', 'popup', STOP, 'the stop report alone does not make the pop-up the plan\'s own: a blind retry stops again',
     [{'expect': {'text': 'Send usage data'}}, {'click': 'OK'}], lambda s: not s.get('popupOk') and not s.get('mainOk'),
     {'go': True, 'first': 1, 'status': 'lowconf'}),
    ('popup-resume', 'popup', DONE, 'a dialog an earlier run of the plan opened is still the plan\'s own when it resumes',
     [{'click': 'Ask'}, {'click': 'Yes'}], lambda s: s.get('popupYes') is True and not s.get('mainOk'), {'first': 1}),
    ('popup-resume-both', 'popup', STOP, 'resumed after the plan opened a dialog nobody has looked at: "OK" is in it and behind it',
     [{'click': 'Ask'}, {'click': 'OK'}], lambda s: not s.get('popupOk') and not s.get('mainOk'),
     {'first': 1, 'status': 'lowconf', 'head': lambda h: detail(h).get('acted') is False}),
    ('popup-resume-look', 'popup', DONE, 'the same after a look: now "OK" means the dialog',
     [{'click': 'Ask'}, {'click': 'OK'}], lambda s: s.get('popupOk') is True and not s.get('mainOk'), {'first': 1, 'relook': True}),
    ('popup-only', 'popup', STOP, 'a pop-up nobody asked for and nobody was shown: its "Yes" is not pressed, though only it has one',
     [{'click': 'Yes'}], lambda s: not any(s.get(k) for k in ('popupOk', 'popupYes', 'popupCancel', 'mainOk')),
     {'go': True, 'status': 'interrupt',
      'head': lambda h: detail(h).get('acted') is False and FOREIGN in detail(h).get('why', '') and 'Yes' in (detail(h).get('dialog') or {}).get('buttons', [])}),
    ('popup-only-check', 'popup', STOP, 'the same for a box inside that pop-up',
     [{'check': 'Remember my answer'}], lambda s: not s.get('popupRemember') and not any(s.get(k) for k in ('popupOk', 'popupYes', 'popupCancel', 'mainOk')),
     {'go': True, 'status': 'interrupt', 'head': lambda h: detail(h).get('acted') is False and FOREIGN in detail(h).get('why', '')}),
    ('popup-only+look', 'popup', DONE, 'the same pop-up after a look showed it: its "Yes" may be pressed',
     [{'click': 'Yes'}], lambda s: s.get('popupYes') is True and not s.get('mainOk'), {'go': True, 'look': True}),
    ('popup-caused', 'popup', STOP, 'a dialog the plan has just opened has an "OK", and so has the window behind it: which one is meant?',
     [{'click': 'Ask'}, {'click': 'OK'}], lambda s: not s.get('popupOk') and not s.get('mainOk'),
     {'status': 'lowconf', 'head': lambda h: h['stuckAtStep'] == 1 and detail(h).get('acted') is False and 'has just opened' in detail(h).get('why', '')}),
    ('popup-caused-only', 'popup', DONE, 'a dialog the plan opened itself, and a name only it has: the plan answers it',
     [{'click': 'Ask'}, {'click': 'Yes'}], lambda s: s.get('popupYes') is True and not s.get('mainOk')),
    ('popup-worked', 'popup', DONE, 'the plan has ticked a box inside the dialog it opened: from then on "OK" means that dialog',
     [{'click': 'Ask'}, {'check': 'Remember my answer'}, {'click': 'OK'}],
     lambda s: s.get('popupOk') is True and s.get('popupRemember') is True and not s.get('mainOk')),
    ('popup-keys', 'popup', STOP, 'keys while a pop-up nobody asked for is open: they would answer it',
     [{'keys': 'Enter'}], lambda s: not s.get('popupOk') and not s.get('mainOk'), {'go': True, 'status': 'interrupt'}),
    ('popup-type', 'popup', STOP, 'typing while a pop-up nobody asked for is open',
     [{'type': 'yes please'}], lambda s: not s.get('popupOk') and not s.get('popupYes') and not s.get('mainOk'), {'go': True, 'status': 'interrupt'}),
    ('popup-keys+own', 'popup', DONE, 'keys into a dialog the plan opened itself are fine',
     [{'click': 'Ask'}, {'keys': 'Enter'}], lambda s: s.get('popupOk') is True and not s.get('mainOk')),
    ('popup-behind', 'popup', STOP, 'a control behind a pop-up nobody asked for',
     [{'click': 'Ask'}], lambda s: not any(s.get(k) for k in ('popupOk', 'popupYes', 'popupCancel', 'mainOk')), {'go': True, 'status': 'blocked'}),

    # a dialog opened from a dialog (finding 10)
    ('nested', 'nested', DONE, 'a dialog opened from a dialog, after a look: "Apply" means the one in front',
     [{'click': 'Settings'}, {'click': 'Advanced'}, {'click': 'Apply'}], lambda s: s.get('appliedB') is True and not s.get('appliedA'),
     {'first': 2, 'relook': True}),
    ('nested-blind', 'nested', STOP, 'the same without a look: the dialog that has just opened and the one behind it both have an "Apply"',
     [{'click': 'Settings'}, {'click': 'Advanced'}, {'click': 'Apply'}], lambda s: not s.get('appliedB') and not s.get('appliedA'),
     {'status': 'lowconf', 'head': lambda h: h['stuckAtStep'] == 2 and detail(h).get('acted') is False}),
    ('nested-under', 'nested', STOP, 'a button of the dialog underneath',
     [{'click': 'Settings'}, {'click': 'Advanced'}, {'click': 'Reset'}], lambda s: not s.get('reset') and not s.get('appliedB'), {'status': 'interrupt'}),

    # irreversible steps re-read every field the plan wrote (finding 8)
    ('drift', 'drift', STOP, 'the app changed the amount after a click: the irreversible step must not go ahead',
     PAY, lambda s: s.get('paid') is None, {'status': 'verify-failed', 'head': drifted(0, '50', '500', 0)}),
    ('drift+keys', 'drift', STOP, 'same, when the irreversible step is a key press',
     PAY[:2] + [{'keys': 'Enter', 'risk': 'irreversible'}], lambda s: s.get('paid') is None, {'status': 'verify-failed'}),
    ('drift+resume', 'drift', STOP, 'same, when the run is resumed just before the irreversible step',
     PAY, lambda s: s.get('paid') is None, {'first': 2, 'status': 'verify-failed'}),
    ('drift+ok', 'drift', DONE, 'nothing changed the amount: pay',
     [PAY[0], PAY[2]], lambda s: s.get('paid') == '50'),
    ('resume+ok', 'drift', DONE, 'resumed before the irreversible step, the amount still stands',
     [PAY[0], PAY[2]], lambda s: s.get('paid') == '50', {'first': 1}),
    ('bad-expect', 'drift', STOP, 'an irreversible step whose "expect" is already true could never show that it worked',
     [PAY[0], {'click': 'Pay', 'risk': 'irreversible', 'expect': {'text': 'Amount'}}], lambda s: s.get('paid') is None,
     {'status': 'bad-expect', 'head': lambda h: h['stuckAtStep'] == 1 and detail(h).get('acted') is False}),
    ('bad-expect+keys', 'drift', STOP, 'same, when the irreversible step is a key press',
     [PAY[0], {'keys': 'Enter', 'risk': 'irreversible', 'expect': {'text': 'Amount'}}], lambda s: s.get('paid') is None,
     {'status': 'bad-expect', 'head': lambda h: detail(h).get('acted') is False}),
    ('mask-phone', 'mask', DONE, 'the app dressed the phone number up: still the value that was entered',
     MASK + [{'click': 'Format'}, SUBMIT], lambda s: s.get('submitted') == {'phone': '(555) 014-2000', 'reference': 'AB-12'}),
    ('mask-punct', 'mask', STOP, 'the app took the hyphen out of "AB-12": that is another value, the irreversible step must not go ahead',
     MASK + [{'click': 'Tidy'}, SUBMIT], lambda s: s.get('submitted') is None, {'status': 'verify-failed', 'head': drifted(1, 'AB-12', 'AB12', 1)}),
    ('acted-fill', 'drift', STOP, 'a value was written and then its "expect" failed: the report must say the step reached the app',
     [{'fill': 'Amount', 'value': '50', 'expect': {'text': 'Total updated', 'timeout': 600}}], lambda s: s.get('paid') is None,
     {'status': 'timeout', 'head': lambda h: detail(h).get('acted') is True}),
    ('acted-type', 'drift', STOP, 'same for real typing into a field',
     [{'click': 'Amount'}, {'type': '50', 'expect': {'text': 'Total updated', 'timeout': 600}}], lambda s: s.get('paid') is None,
     {'status': 'timeout', 'head': lambda h: h['stuckAtStep'] == 1 and detail(h).get('acted') is True}),

    # an action that opens a modal dialog from inside itself must not hang the tool (finding 9)
    ('modal-toggle', 'modal-toggle', DONE, 'ticking a box that asks something in a modal dialog, then answering it',
     [{'check': 'Enable sync'}, {'click': 'OK'}], lambda s: s.get('sync') is True and 'sync dialog answered' in s.get('events', [])),

    # a real click only where the app itself is under the pointer (finding 7)
    ('covered-menu', 'covered', STOP, 'another window covers a menu that needs a real click',
     [{'click': 'File'}, {'click': 'Export...'}], lambda s: not s.get('exported'),
     {'go': True, 'status': 'blocked', 'head': lambda h: h['stuckAtStep'] == 0 and h['detail'].get('acted') is False}),
    ('covered-select', 'covered', STOP, 'another window covers a list item that needs a real click',
     [{'select': 'Fruits', 'value': 'Banana'}], lambda s: s.get('selected') is None,
     {'go': True, 'status': 'blocked', 'head': lambda h: h['detail'].get('acted') is False}),

    # whole words only (finding 3)
    ('near-word', 'rows', DONE, '"Invoice 12" is not the row "Invoice 123"',
     [{'click': {'name': 'Delete', 'near': 'Invoice 12'}}], lambda s: s.get('deleted') == [0]),
    ('near-row', 'ledger', DONE, 'the "Pay" on the line of "Invoice 2003"',
     [{'click': {'name': 'Pay', 'near': 'Invoice 2003'}}], lambda s: s.get('paid') == [2]),
    ('near-missing', 'ledger', STOP, 'the row "Invoice 2002" has no "Pay": the one of a neighbouring row is not taken',
     [{'click': {'name': 'Pay', 'near': 'Invoice 2002'}}], lambda s: not s.get('paid'), {'status': 'notfound', 'head': lambda h: detail(h).get('acted') is False}),
    ('near-heading', 'ledger', STOP, 'words in a heading above the rows ("Invoices for Acme") are on no row',
     [{'click': {'name': 'Pay', 'near': 'Acme'}}], lambda s: not s.get('paid'), {'status': 'notfound'}),
    ('near-nowhere', 'ledger', STOP, 'words that are nowhere on screen',
     [{'click': {'name': 'Pay', 'near': 'Invoice 2004'}}], lambda s: not s.get('paid'), {'status': 'notfound'}),
    ('near-card', 'ledger', DONE, 'a card with its title above its only button: the words belong to that button',
     [{'click': {'name': 'Archive', 'near': 'Invoice 3001'}}], lambda s: s.get('archived') == '3001'),
    ('near-card-rows', 'ledger', STOP, 'a box that lists two invoices above one button: not the row of either',
     [{'click': {'name': 'Archive', 'near': 'Invoice 3002'}}], lambda s: not s.get('archived'), {'status': 'notfound'}),
    ('word-boundary', 'rows', STOP, '"Subscribe" must not tick "Unsubscribe"', [{'check': 'Subscribe'}], lambda s: True, {'status': 'notfound'}),
    ('negation', 'rows', STOP, '"Send receipts" must not tick "Do not send receipts"', [{'check': 'Send receipts'}], lambda s: True, {'status': 'lowconf'}),
]


def tool(*args, timeout=90):
    r = subprocess.run([PY, TOOL, *args], capture_output=True, text=True, timeout=timeout, cwd=ROOT, encoding='utf8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def app_args(case, st):
    return ['powershell', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', APP, '-Case', case, '-State', st]


def state_of(path):
    for _ in range(20):
        try:
            return json.load(open(path, encoding='utf8'))
        except Exception:
            time.sleep(0.05)
    return {}


def wait_event(path, event, seconds=8.0):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if event in json.load(open(path, encoding='utf8')).get('events', []):
                return True
        except Exception:
            pass
        time.sleep(0.05)
    return False


def head_of(o):
    try:
        return json.loads(o.split('\n')[0])
    except Exception:
        return None


def running(pid):
    k = ctypes.WinDLL('kernel32')
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x1000, False, int(pid))
    if not h:
        return False
    code = ctypes.c_ulong(0)
    k.GetExitCodeProcess(ctypes.c_void_p(h), ctypes.byref(code))
    k.CloseHandle(ctypes.c_void_p(h))
    return code.value == 259                           # STILL_ACTIVE


def cleanup(*paths):
    for f in paths:
        for g in (f, f + '.tmp', f + '.go'):
            try:
                os.remove(g)
            except OSError:
                pass


def run_case(label, case, want, steps, check, opt, k):
    sess = f's{abs(hash((label, k, time.time()))) % 10 ** 8}'
    st = os.path.join(WORK, f'{sess}.state.json')
    plan = os.path.join(WORK, f'{sess}.plan.json')
    json.dump({'steps': steps}, open(plan, 'w', encoding='utf8'))
    reason, ms, got, harm, good = '', None, 'error', None, False
    try:
        code, o = tool('open', sess, *app_args(case, st))
        if code != 0:
            return got, harm, good, 'open failed: ' + o.strip().split('\n')[-1][:80], ms
        if opt.get('go'):
            open(st + '.go', 'w').close()
            if not wait_event(st, 'go-done'):
                return got, harm, good, 'the test app did not react to the trigger', ms
        if opt.get('look'):
            tool('look', sess)
        extra = []
        if opt.get('first'):
            code, o = tool('run', sess, plan, '--count', str(opt['first']))
            if not (head_of(o) or {}).get('ok'):
                return got, harm, good, 'the first part of the plan did not run: ' + o[:80], ms
            if opt.get('relook'):
                tool('look', sess)
            extra = ['--from', str(opt['first'])]
        code, o = tool('run', sess, plan, *extra)
        head = head_of(o)
        if head is None:
            return got, harm, good, 'unreadable result: ' + o[:80], ms
        got = DONE if head.get('ok') else STOP
        ms = head.get('engineMs')
        reason = head.get('why') or head.get('error') or ''
        time.sleep(0.15)
        s = state_of(st)
        harm = s.get('harm')
        good = not harm and (want == EITHER or got == want) and bool(check(s))
        if got == STOP and 'acted' not in (head.get('detail') or {}):
            good, reason = False, reason + ' [the failure report has no "acted" value]'
        if good and opt.get('status') and not reason.startswith(opt['status'] + ' '):
            good, reason = False, reason + f' [wanted a "{opt["status"]}" stop]'
        if good and opt.get('head') and not opt['head'](head):
            good, reason = False, reason + ' [the report is not as expected: ' + json.dumps(head.get('detail') or head, ensure_ascii=False)[:160] + ']'
    except subprocess.TimeoutExpired:
        reason = 'timed out'
    finally:
        tool('close', sess, '--force')
        cleanup(st, plan)
    return got, harm, good, reason, ms


def session_checks():
    """Findings about sessions (6): a saved window handle is only trusted while it still names the same window, and
    `close --force` only ever ends a program the session started itself. Each returns (passed, reason)."""
    def stale_handle():
        sess, st = f'sh{int(time.time() * 1000) % 10 ** 8}', os.path.join(WORK, 'stale.state.json')
        plan, sp = os.path.join(WORK, 'stale.plan.json'), None
        json.dump({'steps': [{'click': 'Cancel'}]}, open(plan, 'w', encoding='utf8'))     # "Cancel" is the harmful button of this form
        pid = None
        try:
            code, o = tool('open', sess, *app_args('form', st))
            if code != 0:
                return False, 'open failed'
            sp = os.path.join(WORK, f'{sess}.json')
            saved = json.load(open(sp, encoding='utf8'))
            pid = saved['pid']
            json.dump({**saved, 'class': 'SomeOtherWindowClass'}, open(sp, 'w', encoding='utf8'))   # as if the handle now named another window
            c1, o1 = tool('look', sess)
            c2, o2 = tool('run', sess, plan)
            c3, o3 = tool('close', sess, '--force')
            alive = running(pid)
            json.dump(saved, open(sp, 'w', encoding='utf8'))
            c4, o4 = tool('close', sess, '--force')
            end = time.time() + 5
            while running(pid) and time.time() < end:
                time.sleep(0.1)
            if c1 != 1 or 'window is gone' not in o1 or c2 != 1 or 'window is gone' not in o2:
                return False, 'a window that is not the session\'s was accepted: ' + (o1 + o2)[:120]
            if state_of(st).get('harm'):
                return False, 'acted on it: ' + str(state_of(st).get('harm'))
            if not alive:
                return False, 'close --force ended a program through a handle that no longer named its window'
            if running(pid):
                return False, 'close --force did not end the program the session started'
            return True, ''
        finally:
            if sp and os.path.exists(sp):
                tool('close', sess, '--force')
            cleanup(st, plan)

    def foreign_window():
        sess, st = f'fw{int(time.time() * 1000) % 10 ** 8}', os.path.join(WORK, 'host.state.json')
        plan = os.path.join(WORK, 'host.plan.json')
        json.dump({'steps': [{'click': 'Hello'}]}, open(plan, 'w', encoding='utf8'))
        cleanup(st)
        quiet = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        host = subprocess.Popen(app_args('host', st), **quiet)                 # a program that is already running (ours to end, not the tool's)
        try:
            if not wait_event(st, 'shown', 15):
                return False, 'the host app did not start'
            # "start the program": it only pokes the copy that is already running, which then shows one more window
            code, o = tool('open', sess, *app_args('poke', st))
            if code != 0 or 'FS Test - guest' not in o:
                return False, 'the window of the running program was not picked up: ' + o.strip()[:100]
            saved = json.load(open(os.path.join(WORK, f'{sess}.json'), encoding='utf8'))
            if saved.get('own') is not False or 'NOTE' not in o:
                return False, 'a window of a program that was already running was taken for the session\'s own'
            code, o = tool('run', sess, plan)
            if not (head_of(o) or {}).get('ok') or not state_of(st).get('hello'):
                return False, 'could not work in the adopted window: ' + o[:100]
            code, o = tool('close', sess, '--force')
            time.sleep(0.5)
            if host.poll() is not None or not running(host.pid):
                return False, 'close --force ended a program the session did not start'
            if not state_of(st).get('guestClosed'):
                return False, 'the adopted window was not asked to close: ' + o.strip()[:100]
            if 'only asked to close' not in o:
                return False, 'close did not say that it only asked the window to close: ' + o.strip()[:100]
            return True, ''
        finally:
            if os.path.exists(os.path.join(WORK, f'{sess}.json')):
                tool('close', sess)
            subprocess.run(['taskkill', '/PID', str(host.pid), '/T', '/F'], capture_output=True)   # the suite started it, the suite ends it
            cleanup(st, plan)
    return [('stale-handle', 'a saved handle that names another window is refused, and nothing is ended through it', stale_handle),
            ('foreign-window', 'a window of a program that was already running: used, asked to close, never ended', foreign_window)]


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    right = total = harmful = 0
    for row in CASES:
        label, case, want, what, steps, check = row[:6]
        opt = row[6] if len(row) > 6 else {}
        if only and label not in only:
            continue
        outs = [run_case(label, case, want, steps, check, opt, k) for k in range(runs)]
        for o in outs:
            total += 1; right += o[2]; harmful += bool(o[1])
        bad = next((o for o in outs if not o[2]), None)
        show = bad or outs[0]
        print(f'{label:17} want {want:6} got {",".join(o[0] for o in outs):14} {"PASS" if not bad else "FAIL"}'
              + (f'  HARM: {show[1]}' if show[1] else '')
              + (f'   ({show[3]})' if (bad or want != DONE) and show[3] else f'   {show[4]} ms' if show[4] is not None and not bad else '')
              + f'   - {what}', flush=True)
    for label, what, fn in session_checks():
        if only and label not in only:
            continue
        try:
            good, reason = fn()
        except Exception as ex:                        # noqa: BLE001
            good, reason = False, f'{type(ex).__name__}: {ex}'
        total += 1; right += good
        print(f'{label:17} {"":26} {"PASS" if good else "FAIL"}' + (f'   ({reason})' if reason else '') + f'   - {what}', flush=True)
    print(f'\nright outcome {right}/{total}, harmful actions {harmful}')
    sys.exit(0 if right == total and not harmful else 1)


if __name__ == '__main__':
    main()
