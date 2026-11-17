# Foresight — results (17 November 2026)

"The Foresight way" = the AI looks at the page once, writes the whole plan, the engine runs it in one go and checks
every step, and it goes back to the AI only when it is not sure.

## Where it stands

| What was measured | Result |
|---|---|
| Same task, both ways, on a real demo shop (4 clicks + read the cart total) | **14 s / 2 calls** with Foresight vs **43 s / 10 calls** step by step |
| 17-step form with date picker and custom dropdowns (real practice site) | **20 s / 2 calls** with Foresight; 64 s step by step on day one |
| Real-site suite (18 kinds of task, true end state checked independently) | 36 / 36 correct, 0 silent errors |
| Safety traps (49 pages built to trick it, 2 runs each) | 98 / 98 right outcome, 0 harmful actions |
| Repro pages from code review 3 (56) and review 4 (98) | 56 / 56 and 98 / 98, 0 harmful actions |
| Abilities (shadow DOM, uploads, drag, rich text, canvas, new tabs ...) | 34 / 34 |
| Matching rules (names, "mentions", value comparison) | 72 / 72 |
| Windows desktop suite (67 cases, 2 runs each) | 138 / 138, 0 harmful actions |
| Latest round of fresh testers (manual only, real sites, 20 tasks) | 20 / 20 correct, nothing done unasked |

## Speed

### With an AI in the loop (what a user feels)

Timed by the wall clock, the same AI doing both, on real sites:

| Task | Foresight | Step by step (one action per call) |
|---|---|---|
| Demo shop: open category, open product, add to cart, open cart, read total | 14 s, 2 calls | 43 s, 10 calls |
| Student form: 13 fields incl. date, autocomplete, two custom dropdowns, submit, read back | 20 s, 2 calls | 64 s (measured on day one, and that run left two fields empty) |
| Six local test tasks, first experiment | 21 s | 175 s (69 s with batched calls) |

The step-by-step run of the shop task was already a lean one (it searched for each control and clicked it, no
screenshots) and it ran second, knowing the site.

The fresh testers confirm the shape of it. In the last round two testers did 137 browser steps in 56 tool calls,
at about 15 seconds per task including their own thinking; a step-by-step agent makes at least one call per step.

### Engine only (no AI thinking time)

**Local browser**

| Task | Step-by-step agent loop | Hand-written Playwright script | Foresight, one step per round trip | Foresight |
|---|---|---|---|---|
| Registration (16 fields) | 930 ms | 183 ms | 113 ms | 104 ms |
| Flight search | 2.2 s | 1.8 s | 1.7 s | 1.7 s |
| Popup page | failed 10/10 | failed 10/10 | 145 ms (asked 10× in 10 runs) | 142 ms (asked 10× in 10 runs) |
| Checkout (3 screens) | 3.0 s | 2.4 s | 2.1 s | 2.2 s |
| Shifting layout | 465 ms | failed 10/10 | 3.0 s (asked 29× in 10 runs) | 3.4 s (asked 30× in 10 runs) |
| Grid (20 cells) | 1.3 s | 432 ms | 419 ms | 396 ms |

Median of 10 runs per cell.

**Through a simulated remote browser (40 ms per round trip)**

| Task | Step-by-step agent loop | Hand-written Playwright script | Foresight, one step per round trip | Foresight |
|---|---|---|---|---|
| Registration (16 fields) | 18.3 s | 6.9 s | 3.5 s | 1.9 s |
| Flight search | 11.0 s | 6.5 s | 3.8 s | 3.2 s |
| Popup page | failed 5/5 | failed 5/5 | 2.8 s (asked 5× in 5 runs) | 2.3 s (asked 5× in 5 runs) |
| Checkout (3 screens) | 17.5 s | 8.5 s | 5.1 s | 4.3 s |
| Shifting layout | 8.8 s | failed 5/5 | 5.8 s (asked 13× in 5 runs) | 5.0 s (asked 12× in 5 runs) |
| Grid (20 cells) | 21.8 s | 7.9 s | 4.2 s | 2.0 s |

Median of 5 runs per cell.

Autocomplete and checkout include the pages' own built-in delays (about 1.5 s). "Asked" = the engine stopped and put a question to the stand-in planner instead of guessing.

The shifting-labels page is the engine's worst case: it asks about three times per run there, which makes it slower
than the step-by-step loop on a local browser (3.4 s against 0.5 s) though still ahead over a remote link (5.0 s
against 8.8 s). With a real AI answering, each question also costs that AI's thinking time.

"Asked" = the engine stopped and put a question to the stand-in planner instead of guessing. Two pages now ask where
earlier versions decided by themselves: the pop-up page (the engine no longer closes pop-ups on its own) and the
shifting-labels page (a button or tick box must be named exactly; only fields get the benefit of the doubt).
That is deliberate: each of those earlier "decisions" was a way to press the wrong thing.

## How it was tested

1. **Suites** that run on every change (`npm test`, `node bench/suite.mjs`, `python desktop/suite.py`).
2. **Four adversarial code reviews** by separate AI sessions told to break it. Reviews 3 and 4 wrote 156 repro pages;
   all of them are now permanent tests.
3. **Fresh testers**: separate AI sessions that may read only `GUIDE.md`, pick real sites, write their own plans and
   check the true end state themselves. Sonnet and Haiku are smaller models than the one that built the engine.

| Round | Testers | Tasks | Correct | Said OK but was wrong | Did something unasked | What it led to |
|---|---|---|---|---|---|---|
| 1–4 (before the rework) | 7 | 67 | 52 | 4 | 0 | hover, frames, reading data, dialogs, date widgets |
| 5 (after review 3) | K, L | 18 | 17 | 2 | 0 | new tabs followed and reported; table reads by row/column |
| 6 real-world | M shopping, N work apps, O research | 24 | 22 | 2 | 0 | reads return the whole record; calendars; browser bubbles; home-made dropdowns |
| 7 confirmation | P, Q | 20 | 20 | 1 | 0 | stale read after a re-sort; long page prints; "Search:" vs "Search..." |

"Said OK but was wrong" in rounds 6 and 7 were all reads, never actions: one returned the neighbouring card's numbers
(reads now return the record the words belong to; that task was re-run and is right), and two were taken while the
page was still re-sorting (reads now wait for the page's own data requests). The testers caught each one and their
final answers were right. One round-6 task was abandoned because typing passwords (even published demo logins) was
ruled out half-way through.

## What the engine does to stay right

- **Names.** Buttons, links, tick boxes, radio options and anything irreversible must be named as the page shows them
  ("Save" is not "Save changes", "Send" is not "Do not send"). A field to fill is more forgiving, because its result
  is read back: the only field whose name begins the same way is used, and the result says so.
- **Pop-ups.** It never decides what to press in one. A dialog raised by the plan's own step must be answered by the
  plan. A control that turned up by itself after the AI last looked is never used. A plan may name buttons it allows
  for pop-ups that get in the way (`"popups": ["Reject all"]`).
- **Clicks** are real mouse presses, watched inside the page: a press that would land anywhere else is cancelled before
  the page sees it, also for controls inside embedded frames. A click that may have worked is never repeated.
- **What was written is re-read** before a click, before Enter and before anything irreversible. If the page changed a
  value, the step is not performed and the AI is shown what the field holds.
- **Reads** wait for data the page asked its server for, and return the record the words belong to.
- **Every stop** says whether the step reached the page (`acted`: false / true / "unknown") and what to do next.

## What it costs

- A pop-up that appears by itself costs one extra round trip to the AI (it used to be closed automatically).
- A button or tick box whose wording differs from the plan costs one extra round trip (it used to be guessed).
- Before an irreversible step, a field that the page emptied is treated as a problem even when the page had simply
  used the value (a coupon box). The run stops once; resuming from that step goes through.

## Known limits

- **Not a guarantee.** Every adversarial review found new ways to trick it. It is built to stop when unsure, and the
  suites hold what was found, but a page built to deceive can still succeed.
- **Opening a tree node or accordion**: it presses the node's own header, or the small unnamed mark in front of its
  text, once. A page whose unnamed leading mark or same-named header button does something else gets that pressed.
  Two review pages are built exactly so; they are run and reported, not counted.
- **A pop-up that appears within about a second and a half of one of the plan's own presses** is taken to be that
  press's answer. If it holds a control with a name found nowhere else on the page, a step naming it will use it.
- **Numbers** are compared the US/UK way (comma for thousands, dot for decimals). "1500" shown as "1.500,00" stops.
- **Words lists**: only the "not saved" check for expectations uses a small list of denying words in a few languages.
- **Frames scaled with CSS transforms** are reported as covered rather than pressed.
- **Logins**: Foresight runs its own clean browser, not the user's signed-in one. No passwords were typed in the final
  rounds, so flows behind a login are untested there. Bot checks are detected and never attempted.
- **Not measured**: a comparison against the built-in "computer use" tools (not available in the session that ran
  these tests), and models from other vendors (only Claude-family models wrote plans).
- **Desktop**: verified through its own test app after the last rule changes; Calculator, WordPad and Paint were
  driven successfully earlier but not re-checked since. Windows only.
- Canvas-drawn apps need a screenshot and `clickAt`. Downloads and closed shadow roots are not handled.
- **Mac and Linux**: the web engine looks for Chrome on Mac, but every test here ran on Windows.
