# Design decisions — public cluster page

Settled layout and chart choices for `index.html` (built by `build_cluster_page.R`). A settled
decision is not reopened unless its "Reopen if" condition holds or the operator asks.

Last verified: 2026-11-15

## 2026-11-15 — Over-time plots fill the screen on desktop

**Question.** Removing the Totals section and the Monthly volume slide left a gap above the
footer that grows with screen height: about 70 px at 1440x900 and 280 px at 1920x1200 (none on
phones, where the page already scrolls).

**Options** (built with the real data and compared side by side at 1440x900, 1920x1200,
2560x1440 and 390x844):

- Now: fixed 190 px plots (220 px at 1700 px and wider). The gap stays.
- A: fixed taller plots, 300 px on desktop and 360 px at 1700 px and wider. Simple, but about
  160 px of gap remains at 1920x1200 and the footer drops below the fold at 1440x900.
- B: the Over-time cards take the remaining screen height. Plots are at least 220 px tall, and
  the card row stops growing at 820 px. There is no gap at 1440x900 or 1920x1200, and about
  50 px at 2560x1440.

**Choice.** B, chosen by the operator. Above 1000 px, `main` is a flex column and the Over-time
`.deckrow` grows into the free space. Each visible slide and its `.plot` stretch with it.
Phones and narrow windows keep the fixed 190 px plots. The bars and y-axis ticks are
percentages, so no chart code changed. `scripts/test_page.mjs` §18b pins the rules.

**Evidence.** Screenshots of every option at the four sizes, including the Researchers slide
(paired bars); axe on the built page at 320, 390 and 1920 px wide, with no violations.

**Reopen if** a section is added below the Over-time cards (the stretch would then push it off
screen), or readers report that the bars on very tall screens are hard to compare.
