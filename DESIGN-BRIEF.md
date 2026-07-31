# BOX — visual design brief

> Hand this whole file to a design chat. It is self-contained — you do not need the repo.
> Engineering detail lives in `PROJECT.md`; this file only covers look and motion.

---

## 1. What the game is

A mobile-first, real-time multiplayer **Dots and Boxes** for 2–8 people, played in a browser
on phones. One person creates a room, shares a 4-letter code, everyone joins.

Draw a line between two dots. Complete the fourth side of a square and you claim it, your
initial appears in it, and **you go again**. Most squares wins.

There is a second ruleset, **Twist**: the board slowly collapses from the outside in, and
you can spend 10 of your claimed squares to buy an extra line.

**The game is fully built and working. This brief is about making it look and feel good.**

---

## 2. The feeling to aim for

A premium modern board game. Dark, calm, tactile. Think a well-made physical game on a
dark table under a warm light — not a neon arcade game, not a flat corporate app.

- Dark background, warm yellow dots, bright player colours.
- Minimal but highly polished. Soft shadows, gentle glow, restrained particles.
- Motion should feel **mechanical and satisfying** — things click into place.
- Nothing should feel cheap, bouncy, or cartoonish.

---

## 3. Current colours and type

Already in the code. Change them if you have something better, but say so explicitly so
they can be updated in one place (`src/shared/constants.ts` and `src/client/styles/base.css`).

```
Background      #0B0D12   with a radial gradient to #131722 at the top centre
Panel surface   #171B26
Dots            #FFC24B   warm yellow
Dot glow        #FFB020   soft, ~24% alpha
Text            #E8EAF0
Dim text        #7A8296
Spent/dead tile #2A3040
```

Player colours, assigned in join order, max 8. Chosen to stay distinguishable on dark and
under deuteranopia:

```
1 #22D3EE cyan     5 #A78BFA violet
2 #F472B6 magenta  6 #F87171 red
3 #A3E635 lime     7 #2DD4BF teal
4 #FB923C orange   8 #FBBF24 amber
```

Type is currently the system UI font stack. **A better typeface is welcome** — one variable
font, self-hosted. Numbers must be tabular, or the score counters jitter as they count up.

---

## 4. The screens

**Landing** — name field, big "Create room", a 4-character code field to join, and a small
"play on one device" link.

**Lobby** — the room code shown large, list of players with their colour and ready state,
Mode picker (Simple / Twist), Board size picker (Small / Medium / Large / Grand), a ready
button, and a start button for the host only.

**Game** — this is the important one. Fixed rows top to bottom:

```
 back  ·  "Now playing · Ada"  ·  room code        2.25rem tall
 scoreboard: one panel per player                  auto
 THE BOARD (canvas)                                fills remaining space
 powerup row (Twist only)                          2.4rem tall
 status line: "Your turn" / "Reconnecting…"        1.9rem tall
```

Each scoreboard panel has: a circular avatar with the player's initial, a draining ring
around it that is the 12-second turn timer, their score, their name, and a small ✦ badge
when they are holding a power.

**Result overlay** — winner name, score, and a rematch button.

---

## 5. Hard constraints — please design within these

1. **The board is drawn on a `<canvas>`.** Everything else is normal HTML and CSS. So board
   visuals must be describable as shapes, colours and easing — not CSS classes.
2. **Every row above and below the board must keep a fixed height at all times.** If a row
   appears or disappears mid-game the board resizes and the whole screen visibly jumps.
   This was a real bug. Elements grey out; they never vanish.
3. **Mobile portrait first.** Design for roughly 390 × 840. Must survive 320 px wide.
4. **No external assets.** No CDN links, no Google Fonts, no remote images. Everything
   self-hosted or inline. Fonts can be self-hosted files.
5. **60 fps on a mid-range Android.** Budget for the board is ~16 ms/frame total; it
   currently uses 0.7 ms, so there is room — but avoid heavy blur, huge particle counts, or
   animating hundreds of DOM elements.
6. **Dark theme only.** No light mode needed.
7. **Respect `prefers-reduced-motion`** — keep state changes, drop the big sequences.
8. Touch targets stay tappable: the board can be up to 12 × 12 squares on a phone.

---

## 6. What to design — in priority order

### A. The start sequence ⭐ best fit for a design chat

Self-contained, no game state, pure CSS/canvas. **This is the ideal thing to prototype in
chat as a standalone HTML file.**

1. The **Play button is an open rectangular box with a hinged lid**, drawn in CSS 3D, lid
   rotated open about 105°.
2. Tapping it **closes the lid** over ~220 ms with a slight overshoot and settle. It should
   read as a satisfying mechanical latch.
3. The screen **shakes** — about 6 px, 180 ms, decaying.
4. The box scales up slightly and fades out over ~200 ms.
5. **The board rolls in like a carpet**: rows of glowing dots enter from the top, each row
   about 35 ms after the one above, dropping from -40 px with a small bounce and their glow
   ramping in. A 10-row board should fully land in ~700 ms.
6. Only dots appear. No grid lines. The empty board should feel like an invitation.

Deliverable: a standalone HTML file with the whole sequence, tunable timings.

### B. Overall visual pass ⭐ good fit

Restyle the landing, lobby and game screens. Type scale, spacing, button and chip styling,
the scoreboard panel, how the active player is highlighted, how the turn-timer ring reads,
how a parked player looks, how the room code is presented.

Deliverable: static HTML/CSS mockups of the three screens.

### C. Board look — describe, don't code

The canvas drawing. Worth exploring as a static picture or a description:
- dot size, glow falloff
- line thickness, cap style, glow
- how a claimed square is filled and how its initial sits
- how a "spent" (burned) square should read as dead
- how the doomed ring looks while it pulses red before collapsing

Deliverable: an image or a precise description. Not code.

### D. Endgame shatter — design the LOOK, not the code ⚠️

The intended sequence: the board pauses, cracks along every square boundary, each claimed
square flies to its owner's scoreboard panel and lands with a clack while their score counts
up, unclaimed squares crumble away, then the winner is celebrated.

**Do not build this in chat.** It needs live game state — who owns what, where each panel
is, and which squares already flew away earlier during a Twist collapse. Design the timing,
easing and particle look; it gets implemented against the real game.

---

## 7. What already has a spec

If you want to keep these, they are already decided. If you want to change them, say so.

| Moment | Current intent |
|---|---|
| Line placed | Draws on from the origin dot, 140 ms, ease-out |
| Square claimed | Pulse: scale 0.85 → 1.06 → 1.0 over 260 ms, fill fades in, then the initial |
| Turn handoff | Active panel glow crossfades, 180 ms |
| 4 seconds left | Ring turns amber and pulses; a small "4s" pill appears above the board |
| Board about to collapse | Doomed ring pulses red for a full round, with a countdown chip |
| Board collapses | Tiles burn away, board re-centres over ~500 ms |

Sound is specified but not built: a dry `tick` on each line, a woodier `click` on a claimed
square, a mechanical `thunk` for the Play lid, a low `whoosh` on collapse, a sharp `clack`
as endgame tiles land, and a short fanfare for the winner.

---

## 8. What to hand back

Most useful, in order:

1. **Standalone HTML files** for the start sequence — openable in a browser, self-contained.
2. **Static HTML/CSS mockups** of landing, lobby and game screens.
3. **A colour and type sheet** — exact values, so they can go straight into the two files
   that define them.
4. **Timing and easing values** for anything animated.

Please avoid: React or any framework, Tailwind or any CSS framework, external fonts or
images, and anything that needs a build step. Plain HTML, plain CSS, plain JS.

---

## 9. One thing worth knowing

The game already works and has been played on real phones. Nothing here is speculative —
every screen described above exists and functions today. This is a reskin and an animation
pass on a working game, not a design for something hypothetical.
