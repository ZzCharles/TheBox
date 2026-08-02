# Tiki — design handover

Everything below came out of a design pass on the existing, working game.
Nothing here is speculative UI — it was prototyped and reviewed.

---

## 0. Read this first

The four HTML files are **reference prototypes, not source code.**

They each contain their own fake players, fake scores, fake board state and their own
layout code. **Do not copy code out of them into the app.** They exist so you can open them
in a browser, see the intended result, and change the real files to match.

The parts that *are* meant to be copied are:

- this document, and
- the `Copy values` output inside each prototype's gear panel.

Every prototype has a gear icon that opens a live tuning panel. Every timing, colour and
easing curve is a slider, and `Copy values` writes the whole set out as plain text. If a
number in this document ever disagrees with a freshly copied sheet, **the sheet wins** —
it reflects the last tuning session.

| File | What it is for |
|---|---|
| `box-start-sequence.html` | The original lid-and-shake sequence. Superseded by the Tiki mark, but the shake, box-exit and board roll-in timings are still the reference. |
| `tiki-ui.html` | Home, Settings, Lobby (host and guest), the Tiki transition, and the game screen. Clickable. |
| `tiki-board.html` | The canvas board. Playable. Every visual state, plus the Twist burn. |
| `Archivo.woff2` | The actual font file. See §2. |

---

## 1. The rename

The game is now **Tiki**, not BOX.

The wordmark is set in title case — `Tiki` — because the mark depends on a dotted lowercase
`i`. **The first `i` is the logo**: its dot is a real game dot (round, warm, glowing) and its
stem is a real drawn line. The second `i` keeps its normal rectangular type dot, which is
what makes the first one read as deliberate.

**On load, the mark assembles itself:** the dot drops in over 260 ms with a slight overshoot,
then 200 ms later the stem draws downward from it over **140 ms — the same duration and
easing as placing a line in game.** The logo performs the game's own gesture.

Exact geometry, as fractions of font-size so it scales:

```
mark container   width .20em   height .80em   vertical-align baseline   margin 0 .035em
dot              .19em diameter, centred, at the top
stem             .135em wide, .52em tall, at the baseline, radius .07em
gap between      .09em (falls out of the above)
dot glow         0 0 .10em .035em rgba(255,176,32,.75), 0 0 .34em .08em rgba(255,176,32,.30)
stem glow        0 0 .12em rgba(255,176,32,.55)
stem draw-on     transform: scaleY(0 -> 1), transform-origin: top centre
                 140ms cubic-bezier(.2,.7,.3,1)
```

---

## 2. Type

**One variable font: Archivo.** `Archivo.woff2` is included — self-host it, no CDN.
It carries both a weight axis (100–900) and a **width axis (62–125%)**, which is why one
file covers both the heavy wide wordmark and normal UI text. Its figures are tabular, so
score counters won't jitter as they count up.

```css
@font-face{
  font-family:"Archivo";
  src:url("/fonts/Archivo.woff2") format("woff2");
  font-weight:100 900;
  font-stretch:62% 125%;
  font-display:block;
}
body{ font-family:"Archivo",ui-sans-serif,system-ui,-apple-system,sans-serif;
      font-variant-numeric:tabular-nums; }
```

`font-display:block` rather than `swap` — the wordmark is the first thing on screen and a
flash of fallback type ruins the reveal.

### Scale actually used

| Role | Size | Weight | Width | Tracking |
|---|---|---|---|---|
| Wordmark, home | 80px | 800 | 112% | -.035em |
| Room code tiles | 36px | 800 | — | — |
| Score number | 19px | 800 | — | -.02em |
| Greeting | 17px | 520 (name 700) | — | -.01em |
| Big button | 16px | 800 | — | — |
| Settings row key | 14.5px | 600 | — | — |
| Player name, lobby | 14.5px | 650 | — | — |
| Body / notes | 12.5–13px | 520–680 | — | — |
| Section label | 10px | 700 | — | .20em, uppercase |
| Tag pill (HOST/YOU) | 9.5px | 800 | — | .16em, uppercase |
| Panel name | 10.5px | 600 (750 if it's you) | — | — |

---

## 3. Colour

Unchanged from the existing constants unless marked **NEW**. These belong in
`src/shared/constants.ts` and `src/client/styles/base.css`.

```
--ink        #0B0D12   page background
--rise       #131722   top of the background gradient
--panel      #171B26   card and panel surface
--panel2     #1C2130   NEW  raised / active surface
--edge       #242B3D   NEW  default border
--edge2      #323B52   NEW  hover / emphasis border
--dot        #FFC24B   dot core
--glow       #FFB020   dot glow
--text       #E8EAF0
--dim        #7A8296
--dead       #2A3040   dead dot
```

**NEW — the warm lamp.** The existing gradient is cool blue, but the brief asks for a warm
light over a dark table. A very low amber wash on top fixes it without changing the
constants:

```css
background:
  radial-gradient(120% 62% at 50% -10%, rgba(255,176,32,.055), transparent 60%),
  radial-gradient(150% 90% at 50% 0%, #131722, #0B0D12 58%);
```

**NEW — grain.** A 3 % dot texture over everything at `opacity:.03`,
`pointer-events:none`, so the dark reads as a surface rather than a void:

```css
background-image:radial-gradient(circle at 1px 1px,#fff 1px,transparent 0);
background-size:3px 3px;
```

**NEW — primary button.** `linear-gradient(#FFCF63,#F5A82A)`, text `#22160A`,
`inset 0 1px 0 rgba(255,255,255,.35)`, `0 10px 24px -12px rgba(255,176,32,.7)`.

**Player colours are unchanged.** All eight, same order.

**NEW — fire palette** (see §6):

```
doomed dot core   #FF7044      doomed dot glow   rgb(255,80,40)
ash fill          rgba(15,19,28,.94)   ash edge   rgba(35,42,59,.85)
flame ramp        rgb(255,252,240) -> (255,232,168) -> (255,186,74)
                       -> (255,126,44) -> (214,62,26) -> (104,26,12)
smoke             rgba(60,54,52,.55) centre, transparent edge
```

---

## 4. Behaviour changes

These change how the app works, not just how it looks.

**1. The device remembers the player.** Name is stored locally and read back on open; the
home screen greets them by it. This removes the name field from the landing screen
entirely. Caveats worth knowing: it is per-browser, so a new phone or a cleared browser
loses it, and a typo is permanent — which is why Settings exists.

**2. No ready button.** Joining a room *is* being ready. Only the host can start.
Non-hosts see `Waiting for {host} to start` in a box **the exact same height as the Start
button**, so nothing shifts when the host presses it.

**3. Ruleset moved to the Lobby, removed from Home.** It is the host's decision and only
takes effect in a room. Guests see the Ruleset and Board pickers **dimmed, not hidden.**

**4. Initials rule.** One letter. If two people in the room share a first letter, everyone
who clashes grows a letter until they're all different. Cap at three.
`Sarah` + `Smith` → `Sa` + `Sm`. Colour remains the primary identifier; the letter is a
shortcut.

**5. Favourite colour.** Settings holds a preferred colour. It's granted if free at join
time; otherwise the player silently gets the next open one. No prompt, no error.

**6. "Which one is me."** Lobby: a hollow `YOU` tag, alongside `HOST` if both apply.
Scoreboard: your name renders full white while others stay grey, plus a 2.5px bar in your
colour under your panel. Neither costs horizontal space, which matters at eight players.

**7. A burned square keeps its point.** The score is banked the moment the square closes.
Burning takes the tile, not the score. The ash tile keeps its owner's letter in grey so
players can still count what they won.

**8. Twist has a floor and it has consequences.** The board stops burning when its short
side would drop below 6 squares. With the sizes in the prototype every board converges on
6 × 8 — but **Small cannot burn at all**, so Twist must be disabled or greyed for Small in
the lobby, or Small must get bigger.

**9. Settings contents.** Name, favourite colour, sound, vibration, reduce motion,
left-handed layout, how to play, forget this device, version. Vibration is worth building:
a short buzz when a line lands does more for the "mechanical" feel than any animation.

---

## 5. The board

Open `tiki-board.html`, tune, and use `Copy values`. The principles behind it:

**Everything is a fraction of the dot gap, never a pixel.** Dot radius is 7.5 % of the gap,
line width 9 %, tile inset 5.5 %. This is what makes a 12 × 12 Grand board work: at a ~28px
gap, any fixed pixel value turns the board into a solid mesh. As fractions, a Grand board
looks like a Small board seen from further away.

**Lines run dot centre to dot centre and are painted UNDER the dots.** The dot sits on top
like a rivet. Squares close cleanly and the dots still read as separate objects.

**Touch affordance — this was missing from the brief and matters more than anything else on
the board.** On pointer-down, the nearest empty edge within `gap * 0.62` claims the finger:
a ghost line appears in the player's colour at alpha 0.28, and **both end dots go white**
at 1.28× size. It tracks on move. On release it commits with the 140 ms draw-on. Beyond the
threshold there is no ghost and nothing snaps. The white dots are the important part —
they resolve which two dots you're about to connect when a thumb covers a quarter of the
board.

**Dead things don't glow.** Everything alive on the board emits light, so absence of light
is how death reads. A burned tile is a shallow recess darker than the table. A dead dot
shrinks to 72 % and goes flat `#2A3040`. No crosses, no hatching.

**Two performance requirements, both non-negotiable at Grand size:**

- Cache each dot appearance as an offscreen sprite and `drawImage` it. Building a radial
  gradient per dot per frame will not hold 60 fps across 195 dots.
- Batch every finished line of one colour into a single path and stroke it twice (halo,
  then core). Only lines currently animating need their own stroke.

---

## 6. The Twist burn

**The board never moves.** No zoom, no re-centre, no resize. Burned tiles stay exactly
where they are. This is deliberate — it's what lets players keep counting their squares.

**Warning phase, 1400 ms before anything ignites.** Four signals rising together:

- The **top-left corner dot** heats toward white and swells to 1.35×. This tells players
  not only that it's coming but *where it starts*.
- Every doomed dot pulses faster as time runs out; period sweeps ~100 ms down to ~30 ms.
- The vignette deepens by a further 0.25 alpha.
- The next rounds-left tick flashes at the same rising rate.

**Ignition at the top-left square, spreading both ways around the ring** at 42 ms per tile,
the two arms meeting at the opposite corner. A large ring takes roughly 900 ms end to end.

**Per tile:** flash 130 ms from `rgb(255,244,214)` to `rgb(255,150,50)` with a heat glow
behind it, then cool 420 ms through `rgb(190,58,28)` to `rgb(15,19,28)`.
**Per dot:** dies with the first adjacent tile to catch — flashes white, then cools to
`#2A3040` as its glow drops to zero.

**Flame.** Additive particles stamped from six pre-rendered soft sprites. Full spec is in
the copied values sheet. The thing to understand for budgeting: **the fire is a front, not
a bonfire.** Only ~18 tiles are alight at any moment regardless of ring size, giving ~380
live particles at peak against a hard cap of 460. A Grand board burning at full density is
the worst frame in the entire game — if it holds there, it holds everywhere.

**Ambient Twist signals**, running the whole time, all non-intrusive:

- Doomed ring cools yellow → ember and breathes, period 1.3 s.
- A dark vignette hugging the live area from outside, pulsing inward.
- **Four rounds-left dashes**, 22 × 3px, 7px apart, painted **on the canvas, `gap - 30px`
  above the top live row.** Painting them on the canvas rather than in a DOM row is
  deliberate: it puts the information on screen without adding a layout row, which is what
  caused the board-resize jump previously.

---

## 7. Motion

Timings not covered above live in the prototypes' `Copy values` sheets. The two rules that
apply everywhere:

**Clamp animation progress to 0–1 at the point it is calculated.** Any animation scheduled
with a delay will otherwise run its maths backwards before it starts, and produce negative
scales and radii. This caused a real crash during design.

**`prefers-reduced-motion` keeps every state change and drops every sequence.** Squares
still claim, lines still appear, the board still burns — they just arrive rather than
travel. No flame particles at all.

---

## 8. Still to design

The endgame shatter. Per the original brief it needs live game state, so it gets designed
against the real game rather than prototyped in isolation.
