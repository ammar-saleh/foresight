# Results

Measured on 17 November 2026, on Windows.

## Summary

| What was measured | Result |
|---|---|
| Real practice form, 13 steps, both ways through a remote browser | 14.4 s step by step, 3.3 s with Foresight |
| Demo shop task with a real AI planning (4 clicks, read the cart total) | 14 s and 2 calls with Foresight, 43 s and 10 calls step by step |
| Real-site suite: 18 kinds of task, end result checked independently | 36 of 36 correct |
| Safety traps: 49 pages built to trick it, 2 runs each | 98 of 98 right outcome, 0 harmful actions |
| Pages written to break it | 154 of 156 pass, 2 are known limits |
| Abilities: shadow DOM, uploads, drag, rich text, canvas, new tabs | 34 of 34 |
| Windows desktop suite | 138 of 138, 0 harmful actions |

## Speed, engine only

No AI thinking time. Local benchmark pages.

**Local browser** (median of 10 runs)

| Task | Step-by-step agent | Hand-written script | Foresight |
|---|---|---|---|
| Registration, 16 fields | 930 ms | 183 ms | 104 ms |
| Flight search | 2.2 s | 1.8 s | 1.7 s |
| Popup page | failed | failed | 142 ms, asks once |
| Checkout, 3 screens | 3.0 s | 2.4 s | 2.2 s |
| Shifting labels | 465 ms | failed | 3.4 s, asks 3 times |
| Grid, 20 cells | 1.3 s | 432 ms | 396 ms |

**Remote browser, 40 ms per round trip** (median of 5 runs)

| Task | Step-by-step agent | Hand-written script | Foresight |
|---|---|---|---|
| Registration, 16 fields | 18.3 s | 6.9 s | 1.9 s |
| Flight search | 11.0 s | 6.5 s | 3.2 s |
| Popup page | failed | failed | 2.3 s, asks once |
| Checkout, 3 screens | 17.5 s | 8.5 s | 4.3 s |
| Shifting labels | 8.8 s | failed | 5.0 s, asks about 3 times |
| Grid, 20 cells | 21.8 s | 7.9 s | 2.0 s |

"Asks" means the engine stopped and put a question to the planner instead of guessing. The shifting-labels page is its worst case: on a local browser it is slower than going step by step.

## How it was tested

1. Suites that run on every change: `npm test`, `node bench/suite.mjs`, `python desktop/suite.py`.
2. Adversarial reviews whose only job was to break it. They wrote 156 pages, all kept as permanent tests.
3. Testers who were given only `GUIDE.md`, picked real sites, wrote their own plans and checked the end state themselves. In the last round 20 of 20 tasks were correct and nothing was done unasked.

## What a stop tells the planner

Every stop says which step it reached, whether that step touched the page (`acted`: false, true or "unknown"), what the page shows now, and where to resume.

## Known limits

- **Not a guarantee.** Every review found new ways to trick it. It is built to stop when unsure, and each trick found is now a test, but a page built to deceive can still succeed.
- **Opening a tree node or accordion** presses the node's header or the small mark in front of it, once. A page where that mark does something else gets it pressed. Two test pages are built that way and are reported, not counted.
- **A pop-up that appears within about a second and a half of one of the plan's own presses** is treated as that press's answer.
- **Numbers** are compared the US and UK way. "1500" shown as "1.500,00" stops the run.
- **Logins.** It runs its own clean browser. Nothing behind a login was tested. Bot checks are detected and never attempted.
- **Planner models.** The plans in these tests were written by one family of AI models. Others are untested.
- **Platforms.** Everything ran on Windows. The web engine looks for Chrome on Mac, untested. The desktop engine is Windows only.
- Canvas-drawn apps need a screenshot and a click by position. Downloads and closed shadow roots are not handled.
