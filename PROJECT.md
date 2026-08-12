# Tiki — Project Brief & Architecture

> **Name:** **Tiki** (was BOX; renamed 2026-08-02).
> **What:** Mobile-first PWA. Real-time multiplayer Dots and Boxes for 2–8 players, with a "Twist mode."
> **Status:** **M0–M8 built.** The game is finished and installable. All that remains is a
> custom domain (owner's DNS) and a playtest with six people — neither is code.
> ⚠️ **M8 is committed but NOT DEPLOYED; live is a version behind (§0.1).**
> **Last updated:** 2026-08-12

---

## 0. How to use this file

This is the single source of truth for a new chat. Read sections 1–4 to get oriented,
then jump to whatever milestone is unticked in §15.

When something is decided, move it out of §16 (Open Questions) and into the body.
When a milestone completes, tick it in §15 and update `Last updated` above.

**Companion docs.** `DESIGN-BRIEF.md` was the brief sent to the design chat. What came back
is in `design/`:

- `design/TIKI-HANDOVER.md` — the colour sheet, type scale and behaviour changes. **Sections
  1–6 are built**, bar the rounds-left dashes (see §10.4).
- `design/tiki-board.html`, `tiki-ui.html`, `box-start-sequence.html` — reference prototypes
  with live tuning panels. Press **T** to open one. **Do not copy code out of them**; they
  have their own fake state and layout. Tune, press `Copy values`, and paste the sheet.
  Settings are saved per browser, so a tuning session survives a reload.

This file stays the engineering reference.

---

## 0.1 START HERE — handoff, 2026-08-12

**M7.5 is done bar one design decision. ⚠️ The newest work is NOT deployed.** `main` carries
the 2026-08-12 playtest fixes; the live site is still on `6b38234a` from 2026-08-10. 176
tests pass — four fewer than the 180 this file used to claim, because the `tick`/`click`
character tests were reverted with the sounds they guarded (§13.1).

### The next step, in one line

**Deploy, then install it on a phone and play.** Two batches landed on 2026-08-12 — the
playtest fixes and then the whole of M8 — and **the game is now feature-complete**. Nothing
remains in code: only a custom domain (owner's DNS) and a six-person playtest.

⚠️ **Almost none of it has been seen by a human.** The preview pane does not composite, so
no screenshot of the streak callout, the flames or the endgame exists (see the gotchas). The
icons ARE confirmed visually — they are files, so they can just be looked at.

### M8 landed too, 2026-08-12

The PWA: generated icons, manifest, service worker, an offline screen that offers hot seat
(which genuinely works with no network), and an install prompt after a completed game.
**§14 is the writeup**, and §14.4 is the part to read before touching the build — two Vite
environments, a service worker that must never answer for `/api/*` or `/parties/*`, and no
`window.__box` in production.

### What landed 2026-08-12, from the playtest below

| Area | What changed | Where |
|---|---|---|
| 🔴 **Hot-seat freeze** | A shot clock placing the FINAL line left the game with no result screen and no input. Fixed. | §12.5 |
| **Sound** | `tick` and `click` **reverted** to their pre-recut versions, owner's call. | §13.1 |
| **Streak callout** | Moved off the board and onto the **scoreboard**; real animated flames, a flame sheet and embers; a fifth tier, **Insanity**; voice lines. | §12.4.1 |
| **Twist in hot seat** | The flame badge and shop row existed only online. Extracted to `twistHud.ts`, mounted by both screens. | §10.5 |

⚠️ **One of these is a taste reversal, not a fix.** The `tick`/`click` revert puts back the
pair the 2026-08-10 playtest called *"okay. Not incredible, not bad. Which is not good
enough."* The owner asked for it after hearing the recut in a real game, which beats the
earlier verdict — but nobody should be surprised when the old complaint returns, and §13.1's
method note is what to reach for when it does.

Three things are waiting on the owner PLAYING rather than on code. None blocks M8; each is a
one-line change when the answer arrives:

| Question | Where | The one line |
|---|---|---|
| Does the doubled endgame clock feel right? Decides whether the parked host off-switch is ever needed. | §16 #6 | `ENDGAME_CLOCK_*` |
| Do the streak tiers fire at the right rate — including whether **Insanity at 16** is reachable at all? | §12.4.1 | `STREAK_TIERS` |
| Is the Wildcard reachable enough to matter? Ten boxes cannot be banked until ~turn 93 of 132. | §10.6 | `WILDCARD_COST` |

### Deploy history

| Version | Carried |
|---|---|
| `f1d86651` | Timeout auto-move (§6.3.1), doubled endgame clock (§6.3.2), confirm-tap |
| `a8660bb2` | The `[hidden]` fix (§10.6), `tick` and `click` recut (§13.1) |
| `2d2bb6e1` | Board size in hot seat |
| `6b38234a` | Streak callouts (§12.4.1) — **live, and now one version behind `main`** |

### Five things that will bite you if you do not know them

1. **A shot clock running out PLACES A LINE.** It arrives as a `move` with `auto: true`, so
   `skip` now effectively means a disconnect. §6.3.1.
2. **An auto-move ADVANCES the miss counter** instead of clearing it. Get this wrong and
   `missed` never reaches two, nobody is ever parked again, and §6.4 silently stops working.
3. **`turnSecondsFor` doubles past 60% of the board.** Nothing may assume 12 and 6 — ask it.
   A hardcoded 12 in `clockFraction` is exactly how the countdown ring broke once already.
4. **Setting `display` on a component used to break `hidden` for it.** `base.css` now carries
   a global `[hidden] { display: none !important }`. Do not remove it; §10.6 is the story.
5. **`PROTOCOL_VERSION` is 4.** Bump it whenever a wire type changes shape; mismatched
   clients are told to refresh.

### How to verify a deploy, learned the hard way

`npm.cmd run deploy`, then **confirm the served bundle actually changed** — the success
message prints before the new Worker has propagated. Three traps, all hit today:

- the first request after a deploy can return the **SPA fallback HTML** instead of the asset
  (a 992-byte "JS file" is this). Retry; it settles in ~30s;
- `grep -c` on minified JS is useless — it counts *lines*, and there is one. Use
  `grep -o … | wc -l`;
- **an already-open tab will not pick up a deploy from a hash change.** Hard-reload it, or
  you will verify the previous version and believe it.

Do not use the browser pane to measure anything mid-animation: **CSS animations and
`requestAnimationFrame` do not advance while the pane is hidden**, so you read the frozen
first frame. Two "the element does not fit" results today were a transform stuck at 2.1x.

### Roadmap

| | State | What it means |
|---|---|---|
| M0–M5 | ✅ | Toolchain, rules engine, renderer, networking, resilience, Twist mode. |
| M6 | ✅ | Visuals, audio, the Twist burn, the start sequence. |
| M7 | ✅ | Endgame shatter: crack, every box flies to its owner's panel, count-up, crown. Played 2026-08-10; pacing came back fine. §12.3. |
| **M7.5** | ✅ **bar the Wildcard** | Six of nine done and deployed. Everything left — items 3, 6 and 7 — is the Wildcard, and it is one design decision rather than three jobs. §15. |
| **M8** | ⬅ **next** | PWA: manifest, service worker, icons, offline shell, custom domain. Then ship. **Icons are the critical path.** |

Smaller things worth doing whenever they suit:

- **The burn is 2.9s** and **the shatter ~4.7s.** Both were played on 2026-08-10 and came
  back fine, so they can stop being tuned for length. `BURN` in `burn.ts` and `SHATTER` in
  `shatter.ts` are the tables if that ever changes.
- **Check the live site is current before every playtest.** It was a week stale going into
  one already, which would have made the endgame untestable without anyone noticing why.

### What is verified, and what is only "compiles"

Verified by instrumentation, in a browser, against real game state: the audio engine and
every waveform, the burn's full timeline, the pending-move recovery, the flame badge, the
Wildcard nudge, the start sequence, the endgame shatter, and every guard around them
(reduced motion, rejoining mid-game, spectators).

**Never seen by a human:** all of it, visually. No screenshot exists of the burn, the flame
badge, the nudge, the start sequence or the shatter. Timing, geometry, colour and state are
confirmed; *how it looks and feels* is entirely unconfirmed.

⚠️ **Screenshots are not the missing step — a phone is.** The preview pane does not
composite (see the gotchas below), so no automated screenshot of any of this is possible,
and chasing one is a dead end that has now been walked twice.

### ⚠️ Testing gotchas that cost real time this session

Read these before writing a single browser probe. Each one produced a convincing false
alarm and a wasted detour.

1. **The preview pane does not composite.** `document.visibilityState` is `"hidden"` and
   **`requestAnimationFrame` never fires**, so the render loop is dead and CSS animations
   freeze at their first keyframe. Screenshots fail outright.
   - Drive frames by hand with `window.__box.drawNow()` (dev builds only — this is exactly
     why it exists, §3).
   - **Never trust `getComputedStyle` during an entrance animation.** A frozen `from` frame
     reports `opacity: 0` and `scale: 0.6`, which looks precisely like a broken element.
2. **`getImageData` returns UN-premultiplied RGBA.** The board canvas is transparent-backed,
   so a 20%-alpha line keeps its full RGB and carries the transparency in the **alpha
   channel**. Read `data[3]`. Judging opacity from RGB says a faint line is fully opaque.
3. **The 12s shot clock expires between tool round-trips**, benching players and pausing the
   match, which then makes every later reading nonsense. Do a whole multi-step scenario
   **inside one script** with `await sleep()`, and read the result out afterwards.
4. **A second player is easiest as a raw WebSocket.** `new WebSocket('ws://' + location.host
   + '/parties/game-room/CODE')`, then send `hello`, then `move`. This is how M3 was
   verified and it sidesteps the whole UI.
5. **Confirm-tap is ON from 10×10 up** (`CONFIRM_TAP_FROM_GRID`). Synthetic taps on Large or
   Grand need *two* taps per line, or nothing happens and it looks like input is broken.
6. **`window.__box` survives a room change.** It is re-exposed when the game view mounts, so
   after `location.hash = '#/r/NEW'` it still points at the OLD room's mirror for a moment.
   A probe that waits with `while (!window.__box)` therefore never waits at all, and drives
   a finished game instead of the new one — which looks exactly like a game that refuses to
   start. Set `window.__box = undefined` *before* navigating, and assert on `state().n`.
7. **A tab that joins before `start` is a PLAYER, not a spectator**, and the whole match then
   stalls waiting for moves it will never make. Join *after* `start` to spectate — which is
   also the easiest way to watch a set-piece, since a spectator needs no synthetic input.
8. **Drive the turn order off the replayed mirror, not off the wire.** Turn order is shuffled
   at start and there is no message announcing it (§7). `state().turnOrder[state().turnPtr]`
   is the answer; guessing gets a stream of `not-your-turn`.

### ⚠️ Where the code actually is

**`main` is the truth again** (2026-08-10). It used to sit 8 commits behind on `03626dc`,
before the rename to Tiki, so a chat starting from `main` found no Tiki, no audio, no burn
and none of the playtest fixes. `design-pass` was fast-forwarded into `main`; the two are
now identical and `design-pass` is kept only as a label on the same commit. **Work on
`main`.**

**There is now a remote:** https://github.com/ZzCharles/TheBox — public, `main` tracking
`origin/main`. Pushed 2026-08-10, which is the first time this project has existed anywhere
but one disk. Push as you go; the Cloudflare deploy is a built artifact and backs up nothing.

⚠️ **The repo is public, so keep it clean.** `.dev.vars` holds `OWNER_KEY` and is gitignored
— check it stays that way. The account email and id deliberately do NOT appear in this file;
`npx.cmd wrangler whoami` is where they live.

**Git identity — read this before your first commit.** `user.email` is now set GLOBALLY to
the owner's usual address, so commits just work. It was not always: for most of this
project's life no identity was configured at all, and an earlier session worked around that
by passing `git -c user.email=…` inline on every commit, using the address it found in its
own session context. The result is **30 commits authored by an address the owner does not
use for this project**, and `.claude/settings.local.json` carried it as file content into a
public repo until it was untracked on 2026-08-11.

Two lessons, both cheap:

- **`git log` is not evidence of intent.** Reading the identity off previous commits repeats
  whatever mistake made them. Check `wrangler whoami`, the remote, or ask.
- **`.claude/settings.local.json` is gitignored now.** It is per-machine permission state,
  it rewrites itself constantly, and it records command lines. Leave it untracked.

The old commits were left alone deliberately: rewriting them means a force-push over public
history, which is the owner's call and not worth doing casually. Nothing is broken by the
mixture — git does not care, and neither does anything else.

### Deploying

Wrangler **4.115.0** is installed and already logged in on the owner's machine, so
`npm run deploy` works there. It builds and ships client + Worker in ~30s. Remember the
first ~30 seconds after a deploy can hit the old Worker — see the note in
§"Where the project stands".

```bash
npx.cmd wrangler whoami   # which account is logged in, and its id
```

*(This repo is public, so the account email and id live in `wrangler whoami` rather than
in the file. Neither is a credential, but neither needs indexing either.)*

---

### Where the project stands

**The game is finished, playable, looks the way it was designed to, and now makes a noise.**
All rules, real-time multiplayer, lobby, reconnect, spectators, rematch and twist mode work.
180 tests pass. What remains is M8 — making it installable — and then shipping.

| Area | State |
|---|---|
| Rules engine | ✅ Done, pure, 105 tests in `src/shared` |
| Multiplayer / server | ✅ Done, authoritative, survives restarts |
| Board rendering + input | ✅ Done, design values applied, 0.7 ms/frame |
| Twist mode | ✅ Done, with the shrink floor |
| Screens: landing, settings, lobby, game | ✅ Done — full colour, type and behaviour pass |
| **Sound** | 🟡 Eight synthesised sounds, 42 tests. `tick` and `click` were recut at M7.5 and **reverted 2026-08-12** — back to a pair a playtest also called not good enough (§13.1). **Still the weakest part of the game.** |
| **Announcer** | 🟡 Nine recorded lines wired and verified (§13.2). Waiting on the files themselves, plus a draw line and extra `Insanity` takes. |
| **Streak callouts** | ✅ Five tiers over the scoreboard, animated fire, embers, and a placeholder voice (§12.4.1) |
| **Twist burn** | ✅ Done — fuse, ignition, spreading front, flame, ash. 2.6 ms worst frame. |
| **Start sequence** | ✅ Mark draws, flares, hits, shakes; board rolls in |
| **Endgame shatter** | ✅ Done — crack, flight, count-up, crown. 5.4 ms worst frame on 12×12 |
| **PWA / installable** | ✅ Manifest, service worker, generated icons, offline screen, install prompt (§14) |
| **Deployed** | ✅ https://box.charlesbobby253.workers.dev |

**Live since 2026-07-31. Redeployed 2026-08-10 with M7, then four more times the same day**
— the deploy table is in §0.1; the current version is **`6b38234a`**. Verified against the
deployed site, not just dev: room creation, code lookup, two WebSocket clients joining, a
move propagating to both, and a **28 ms median round-trip**; for the auto-move, a live room
left to time out — line placed, both clients in step, second miss parking the player; for
the `[hidden]` fix, a probe of the live stylesheet; for the sounds, the synthesis constants
read back out of the served bundle. Redeploy with `npm.cmd run deploy`
(~30 seconds), then confirm the served bundle actually changed — the success message is
printed before the new Worker has finished propagating.

Two things only the real deploy revealed:
- Requests in the first ~30 seconds after a deploy can hit the old Worker while the new one
  propagates — `/api/*` briefly returned the SPA fallback and a 500. It settles on its own;
  don't debug it, just retry.
- The live site is HTTPS, so it is a **secure context** — `crypto.randomUUID` and
  `navigator.clipboard` work there but not over LAN HTTP. LAN testing is the stricter
  environment; see the secure-context invariant in §17.

### Playtest log

- **2026-08-12, hot seat on the deployed build.** Four reports, all actioned the same day.
  The most valuable one is the freeze, because it is the first hard *fault* found in single
  player and it had a cause nobody would have found by reading the online code.

  🔴 **1. "I let the auto click draw last 2 lines to end the game. The game froze. I had to
  close and restart."**

  Real, reproduced, and fixed. `hotseat.ts`'s clock places a line on timeout (§6.3.1) but
  **never checked `gameOver` on that path** — only the tap path called `finish()`. So the
  clock could place the final line of a match, the state went to `over`, the interval's
  `if (state.phase === "over") return` guard then early-returned forever, and the result
  overlay was never raised. Input was dead too, because `canAct` requires `playing`. A
  finished board and nothing to press: exactly "frozen".

  ⚠️ **The online screen was never exposed to this**, which is why it survived review. Online
  derives the endgame from the replayed mirror (`state.phase === "over"`), so every path
  reaches the result by construction. Hot seat hand-writes its exit, and a hand-written exit
  can be missed in one branch. See §12.5 — that asymmetry is worth knowing before adding any
  new way for a hot-seat game to end.

  🔴 **2. "No fire warning. No glowing wands"** — in single player.

  Not a repeat of the §10.6 bug. **Hot seat simply never had either.** The flame badge and
  the whole shop row were written inline in `room.ts`; `hotseat.ts` rendered a scoreboard, a
  board, a pill and a toast, and nothing else. So Twist on one device really did have no
  collapse warning and no way to buy a Wildcard — the mechanics ran in the rules engine with
  no representation on screen at all.

  Fixed by **extracting rather than copying**: `twistHud.ts` now owns the markup and the
  behaviour, and both screens mount it (§10.5). Copying would have left two versions of a
  feature whose entire history is being invisible in slightly different ways.

  🔊 **3. "Sound isn't good. Revert."** Done — see §13.1, and the warning about it in §0.1.

  💡 **4. The celebration.** Four asks, all built (§12.4.1): put it **at the top over the
  scoreboard** rather than over the board; **there is no flaming animation** (correct — the
  tiers were static CSS gradients); a tier above WILDFIRE called **Insanity**, where **every
  further box re-celebrates**; and **a voice over it**.

  On the voice: it is **speech synthesis for now, with the sampled path built behind the same
  call** (`voice.ts`). The owner's ElevenLabs recordings drop in through
  `registerVoiceSample` without either file changing shape. ⚠️ The synthesiser is a
  placeholder and sounds like one — judge the timing on it, not the delivery.

- **2026-08-10, second session, several games on the deployed build.** Four reports. One is
  a **rules exploit**, not a UX complaint, and it is the most serious thing in this file.

  🔴 **1. A player can pass by doing nothing, and passing wins games.**
  > "I found a player can skip a risky draw when he just doesn't make a move."

  Confirmed in the code: `onAlarm()` calls **`skipTurn`**, which advances the turn without
  placing a line (`GameRoom.ts:696`). **In Dots and Boxes there is no passing.** The whole
  endgame is about being forced to open a chain, so a free pass is not a small exploit — it
  is a way to refuse to lose, and a player who has noticed it can stall every losing turn.

  ⚠️ **The fix is almost certainly NOT the timer.** The owner suggested removing or making
  the timer optional; that trades one problem for the worse one it was built to solve
  (§6.3 exists because a single player can otherwise hold the board indefinitely). The
  smaller, truer fix: **on timeout the server plays a legal move FOR you** rather than
  skipping. That matches the actual rules — you must place a line — removes the exploit
  completely, keeps the clock honest, and needs no new UI. Choosing *which* move is the
  only real design question (a safe edge if one exists, else random) and `legalMoves(state)`
  already returns the candidates. Benching after two misses can stay exactly as it is.
  An optional no-timer mode is still worth having for friends playing slowly, but it should
  not be the answer to this.

  🔴 **2. "Multiplayer tap isn't responsive. Have to double tap."**
  Two candidate causes, and the first is not a bug at all:
  - **Confirm-tap is ON for every grid ≥ 10×10** (`CONFIRM_TAP_FROM_GRID`, §10.2). First tap
    ghosts, second commits. That is *designed*, and it is being experienced as broken input.
    ⚠️ **§10.2 claims it is "player-overridable in settings". It is not** — there is no such
    control in `settings.ts`. That is a documentation lie, now corrected.
  - Or the **pending-line round trip** simply feels dead: you tap, the line goes faint, and
    nothing else happens until the server answers. §10.2 already fixed ghost-vs-pending
    once; it may still not be enough over real latency.

  ✅ **Answered: it was Medium (10×10), so confirm-tap was ON.** This is the feature, not a
  dropped tap, and the pending-line path is exonerated. **The fix is disclosure, not input
  handling** — do not go looking for a bug in `pointer.ts`.

  What that leaves is a judgement call §10.2 already half-made: the second tap exists
  because a misplaced line is more painful than a slow turn, and that reasoning still
  holds. But a safety feature nobody was told about reads as a broken one, and this player
  played several games without ever working out it was deliberate. So either **build the
  settings toggle §10.2 has been claiming exists**, or **say it on screen** — the ghost
  already draws with lit end dots, and something as small as the banner reading
  "Tap again to place" while a ghost is live would probably have prevented the whole
  report. Cheapest first: the on-screen tell helps every player, the toggle only helps the
  ones who find Settings.

  💡 **3. Hide the running score; reveal it at the end.**
  > "Maybe not show the scores early, so they won't know if they are ahead. When capturing
  > the box it will just puff up the name icon momentarily. Also helps to wait till the end
  > for the surprise score reveal."

  **This pairs unusually well with what M7 already built.** The shatter's whole third act is
  a count-up from `harvested[p]` to the real score (§12.3); today it announces a number
  everybody has been watching climb all game. Hiding the running total turns the endgame
  from a formality into the reveal it was designed to be, for free.

  ⚠️ One honest limit: **this hides the number, not the information.** Every claimed square
  carries its owner's letter, so a determined player can count the board — §17's
  `score === boxes you visibly own` guarantees it. That is probably fine (counting 40 squares
  under a 12s clock is real work) but it should be a decision, not a surprise. It also needs
  an answer for "how do I know I can afford a Wildcard" — see 4, where the glow does exactly
  that job.

  💡 **4. The Wildcard is clunky — two presses, and it "feels lanky".**
  Requested redesign: **one magic wand on the left**, grey while unaffordable, glowing once
  you hold 10 boxes. Tap it and the ten squares' glow is visibly **absorbed into the wand**;
  everyone else sees the glow absorbed into that player's name icon.

  This collapses buy-then-arm into a single action. ⚠️ That is a **deliberate reversal** of
  §9.3's "explicit arming, so nothing is ambiguous under the clock" — which was a M1
  decision made without a playtest, and has now been called clunky by the only person who
  has played it. Two playtests beat one untested principle; the reversal looks right. What
  must be preserved is that **firing is still unambiguous**: the wand has to keep saying
  "armed, your next line is free" after the animation ends, or players will spend one and
  not know they are holding it.

  ⚠️ **Not "10 boxes at random."** The ten are chosen furthest-from-centre first, and
  `wildcardCostPreview()` is both what the board outlines and what `buyWildcard` spends —
  there is a test asserting they cannot disagree (§9.3). Keep that. The absorb effect should
  animate *those* ten, which is better anyway: they are the outer ring, so the glow travels
  inward from the board's edge toward the player.

- **2026-08-10, on the deployed HTTPS build, with M7 live.** Verdict: the pacing and the
  interface are fine; the two Twist mechanics are still invisible; the sound is not good
  enough. **Read this before starting anything else.**

  ✅ **Settled, stop asking:**
  - **The wait is alright.** That covers the 4.7s shatter and the 2.9s burn — neither needs
    shortening. `SHATTER` and `BURN` can stop being open questions.
  - **The interface is alright.** No layout or legibility complaints.

  🔴 **The one that matters — TWICE reported now, and no longer dismissable.**
  - **"I still do not see any warning for the burning. It just comes out of nowhere."**
  - **"There still is no wildcard buying option. It probably is there, but if I can't see it
    then it's the same as not being there."**

  Last session these were written off as "they probably played Simple mode, where neither
  feature exists". That explanation is now spent: this session was told to pick Twist on
  purpose. So one of two things is true, and **both are real bugs**:

  1. The host never actually got the room into Twist — in which case the Simple/Twist chips
     in the lobby (`room.ts`, they exist and do send `configure`) are not discoverable
     enough, and the server defaulting to `mode: "simple"` is a trap.
  2. The room *was* in Twist and the flame badge and shop row genuinely did not appear.

  ⚠️ **Do not start by writing code. Start by finding out which.** The cheapest test is to
  put a room in Twist and read `state.mode` back on the client — the whole game screen is
  built once at mount behind `const twist = state.mode === "twist"`, so a room that reaches
  the board as `simple` renders no shop row and no burn warning for the rest of the match,
  whatever the lobby said afterwards. That is the first hypothesis worth eliminating.

  The deeper lesson, which is worth more than either fix: **a feature two consecutive
  playtests could not find has failed, and it does not matter which of the two causes it
  was.** §10.5 already rebuilt both of these once to be "far more visible". It was not
  enough. The next attempt should be judged by a player finding it unprompted, not by the
  element being present in the DOM.

  🔊 **Sound: "okay. Not incredible, not bad. Which is not good enough."** ✅ **Both recut
  and shipped 2026-08-10 — §13.1.**
  - **`tick` (line placed) should sound like drawing a line on paper** — a short graphite
    drag, not the dry noise band it is now. This is the most-heard sound in the game.
  - **`click` (box claimed) should be a genuinely satisfying click.** It is currently struck
    wood bending down in pitch; it wants to be crisper and more mechanical.
  - Sharpened on the second pass to *"more clicky. like when you press a padlock"* and
    *"tick still doesnt sound like paper"*, which is what actually made them buildable — a
    padlock names a material, and a material names the synthesis. The first pair was one
    considered guess at each and was rejected outright; the second offered three takes on
    each and was settled in a single reply.

- **2026-08-03, 2 players, LAN, real phones (one iPhone).** Verdict: "it feels very buggy."
  It was. Three real faults, all fixed:
  - **Moves vanished.** A faint line appeared on the tapper's phone and nowhere else, and
    from then on that player could not move at all. Root cause in §7 — the server answered
    a stale move with silence, and the client blocks on an unanswered move forever.
  - **A ghost and a pending line looked identical**, so a tap that was waiting on the server
    read as a tap waiting to be confirmed. Players tapped again, which does nothing.
  - **Dragging on iPhone navigated the app away**, because Safari's edge swipe is a system
    gesture that `touch-action: none` does not suppress. See §10.2.
  - Sound: "isn't satisfying." Deferred by agreement — the tables to turn are `SFX_SECONDS`
    and `SFX_PEAK` in `waveforms.ts`. Nobody got far enough into a game to judge the burn.
- **2026-08-03, second look.** Touch "is better". Two reports: "the collapse has no warning"
  and "it's missing the shop feature". Both are **Twist-only features, and a room defaults
  to `mode: "simple"`** (`GameRoom.ts`) — so the likeliest reading is that the game was
  played in Simple, where there is no shrinking board and no Wildcard at all. ⚠️ **Worth
  confirming before drawing conclusions about either feature**, and worth asking whether
  the lobby makes the choice obvious enough, since the host has to pick Twist on purpose.
  Both were rebuilt to be far more visible regardless — see §10.5.
- **2026-07-31, 2 players, LAN, real phones.** Verdict: "it feels alright." Fixes that came
  out of it are in M6 part 1 and part 2 (screen jitter, board presets, collapse countdown,
  public wildcard badge). Still unanswered: does anyone actually buy a Wildcard, does 12s
  feel right, real game length, tap accuracy.

---

## 1. Product summary

A polished, premium-feeling board game you play with friends on your phones. One person
creates a lobby, shares a 4-letter code, everyone joins. The board size scales with the
lobby. Turns are fast (5-second shot clock). Latecomers spectate. Nobody gets kicked for
going AFK — they get benched and can tap back in. When the last box is claimed, the board
shatters and every box physically flies into its owner's scoreboard.

Two rulesets, chosen at lobby creation:

| Mode | Rules |
|---|---|
| **Simple** | Classic Dots and Boxes. Nothing else. |
| **Twist** | Classic + **Shrinking Board** (sudden death) + **Wildcard** (spend 10 pts for one extra line this turn). |

---

## 2. Stack decisions (LOCKED)

| Layer | Choice | Why |
|---|---|---|
| Runtime/host | **Cloudflare Workers + Durable Objects** | One DO per lobby = authoritative state + WebSockets + a built-in `alarm()` timer, all in one primitive. Free tier covers this scale. Single `wrangler deploy` ships client *and* server. |
| DO ergonomics | **`partyserver`** npm package | Cloudflare-maintained. Gives PartyKit-style `onConnect`/`onMessage`/`broadcast` on top of raw DOs, without leaving the standard Workers toolchain. Thin — you can drop to raw DO APIs anytime. |
| Build | **Vite + `@cloudflare/vite-plugin`** | One `npm run dev` runs the client *and* the real Worker/DO locally (workerd, not a mock). Lowest-setup option that still teaches the real platform. |
| Language | **TypeScript**, strict | Rules engine is shared between client and server — types are the whole point. |
| UI framework | **None** | Lobby/HUD/menus are plain DOM + CSS. A framework buys little here and costs bundle size + a state-sync seam against the canvas loop. |
| Board rendering | **Canvas 2D**, 2 stacked layers | 12×12 board is ~300 lines + ~150 boxes. The shatter endgame moves every piece at once — DOM/SVG would drop frames on mid-range phones. WebGL/Pixi is overkill and a heavy dep. |
| PWA | **`vite-plugin-pwa`** | Manifest + service worker + icons with ~10 lines of config. |
| Audio | **Web Audio API**, hand-rolled | ~6 short sounds. Pool + pitch jitter. No library. |
| Persistence | **DO storage only** (SQLite-backed) | Rooms are ephemeral. No database, no accounts, no login. |

**Total dependencies: `partyserver`, `vite`, `@cloudflare/vite-plugin`, `vite-plugin-pwa`, `typescript`, `wrangler`.** That's it. `vite-plugin-pwa` landed 2026-08-12 with M8 and is the sixth and last; the icons it needs are generated by a script with no dependency at all (§14.1).

### 2.1 Rejected, and why (so we don't re-litigate)

- **Socket.IO on a VPS** — works, but you pay for an always-on box and hand-roll room lifecycle, sticky sessions, and timers that DOs give free.
- **Firebase** — no authoritative server means turn order, the shot clock, and shop economics all leak into clients. Cheatable, and animations desync.
- **React** — the board is imperative canvas anyway; React would only own ~5 screens.
- **SVG/DOM board** — see rendering note above.

---

## 3. Prerequisites & commands

- ✅ **Node v24.18.0** at `C:\Program Files\nodejs\` (installed 2026-07-30).
- ✅ `git init` done, branch `main`.
- ✅ **Cloudflare account, wrangler logged in** (2026-08-03). `npx.cmd wrangler whoami`
  confirms it; `npm run deploy` ships from this machine.

In dev builds only, `window.__box` exposes `{ state(), layout(), drawNow() }`. `drawNow()`
exists because `requestAnimationFrame` never fires in a hidden tab, which otherwise makes
the canvas impossible to inspect from automation. Stripped from production by
`import.meta.env.DEV`.

**LAN playtesting.** `vite.config.ts` sets `server.host = true`, so `npm run dev` prints a
Network URL (e.g. `http://192.168.0.115:5173/`) that phones on the same wifi can open — no
Cloudflare account needed. Windows Firewall prompts on the first connection; allow it on
**Private** networks. Note this is a plain-HTTP origin: see the secure-context invariant in §17.

```bash
npm run dev      # Vite + the real Worker/DO in workerd, together, on :5173
npm test         # rules engine, via node --test (no test dependencies)
npm run check    # typecheck client and worker projects separately
npm run build    # check + build both bundles into dist/
npm run icons    # regenerate the PWA icons from the Tiki mark (§14.1)
npm run types    # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run deploy   # build + wrangler deploy
npx.cmd vite preview --port 4173   # the ONLY way to test the service worker (§14.4)
```

**Two gotchas worth remembering:**

- `compatibility_date` in `wrangler.jsonc` **must not exceed** the date the installed
  `workerd` binary supports, or `vite dev` refuses to start with a runtime failure. Bump it
  when you bump wrangler, not before.
- `.claude/launch.json` uses an absolute path to `node.exe` because the preview runner does
  not inherit an updated PATH. Harmless, but it is machine-specific.

---

## 4. Repo layout

```
Box/
├─ PROJECT.md                  ← this file
├─ package.json
├─ tsconfig.json
├─ vite.config.ts              ← Cloudflare + PWA. The PWA half is client-only (§14.4)
├─ wrangler.jsonc              ← Worker + DO bindings + static assets
├─ index.html
├─ scripts/
│  └─ make-icons.mjs           ← `npm run icons`. Generates the PNGs. No deps (§14.1)
├─ public/
│  ├─ icons/                   ← GENERATED — edit the script, not these
│  ├─ sfx/voice/               ← the announcer's mp3s. README there names every one
│  └─ fonts/                   ← Archivo, self-hosted
└─ src/
   ├─ shared/                  ← imported by BOTH client and server. No DOM, no Workers APIs.
   │  ├─ protocol.ts           ← every message type, versioned
   │  ├─ rules.ts              ← PURE. move legality, box completion, scoring
   │  ├─ board.ts              ← index math, encode/decode board state
   │  ├─ modes.ts              ← simple/twist modifiers, shrink schedule, shop costs
   │  └─ constants.ts          ← grid sizing table, timings, colors
   ├─ server/
   │  ├─ index.ts              ← Worker entry: static assets + /party/:code upgrade
   │  ├─ GameRoom.ts           ← the Durable Object
   │  ├─ lobby.ts              ← join/leave/ready/config/spectators
   │  ├─ match.ts              ← turn loop, applies rules.ts, emits events
   │  ├─ afk.ts                ← benching + return
   │  └─ codes.ts              ← room code generation/collision
   └─ client/
      ├─ main.ts               ← boot, router, service worker reg
      ├─ pwa.ts                ← SW registration, offline detection, install prompt
      ├─ net/
      │  ├─ socket.ts          ← connect, backoff reconnect, clock sync
      │  └─ store.ts           ← applies server events → local mirror + subscriptions
      ├─ render/
      │  ├─ stage.ts           ← canvas setup, DPR, resize, on-demand RAF loop
      │  ├─ layout.ts          ← PURE. board <-> screen, hit testing. tested.
      │  ├─ boardRenderer.ts   ← dots, lines, claimed boxes, vignette
      │  ├─ burn.ts            ← the Twist fire: schedule, particles, ash
      │  └─ tween.ts           ← ~60 lines: keyed easing
      ├─ input/
      │  └─ pointer.ts         ← tap-nearest-line + drag-from-dot, hit tolerance
      ├─ ui/
      │  ├─ router.ts
      │  ├─ screens/           ← landing, lobby, game, results
      │  ├─ components/        ← scoreboard, shotclock, shop, toast, playButton
      │  ├─ twistHud.ts        ← flame badge + shop row. SHARED by room and hot seat.
      │  ├─ streak.ts          ← the chain callout, over the scoreboard
      │  ├─ offline.ts         ← the no-network screen. Offers hot seat (§14.2)
      │  └─ installOffer.ts    ← add-to-home-screen, on the result overlay (§14.3)
      ├─ audio/
      │  ├─ waveforms.ts       ← PURE. the eight sounds, synthesised. tested.
      │  ├─ voice.ts           ← the announcer: nine recorded lines (§13.2)
      │  └─ engine.ts          ← unlock on first gesture, sfx/voice buses, ducking, mute
      └─ styles/
```

**The one rule that keeps this modular:** `src/shared/rules.ts` never imports anything.
It takes state + a move and returns state + events. Server runs it to be authoritative;
client runs the *same file* to predict and to grey out illegal taps. If a bug appears in
one and not the other, the bug is in the plumbing, not the rules.

---

## 5. Architecture — the four seams

```
        ┌──────────────────────────────────────────┐
        │  src/shared/rules.ts  (pure, no I/O)     │
        │  applyMove(state, move) → {state, events}│
        └───────────────┬──────────────┬───────────┘
                        │              │
         ┌──────────────┴───┐      ┌───┴───────────────┐
         │ SERVER (DO)      │      │ CLIENT            │
         │ authoritative    │◄─WS─►│ mirror + predict  │
         │ + shot clock     │      │                   │
         └──────────────────┘      └───┬───────────────┘
                                       │ events
                        ┌──────────────┴──────────────┐
                        │  store.ts (observable)      │
                        └───┬──────────────────┬──────┘
                            │                  │
                    ┌───────┴──────┐   ┌───────┴───────┐
                    │ render/ (RAF)│   │ ui/ (DOM)     │
                    └──────────────┘   └───────────────┘
```

**Authority:** server-authoritative, always. Clients send *intents*, never state.
A client may optimistically draw a **pending** line (dimmed, no glow) the instant you tap,
but it is not real until `moveApplied` returns. If the server rejects it, the pending line
retracts with a short shake.

**No animation blocks game state.** Animations read from the store; they never gate it.
If a reconnect arrives mid-sequence, the client fast-forwards every in-flight tween to its
end state and redraws from the snapshot.

---

## 6. Server: the GameRoom Durable Object

One DO instance per room code. Holds all state in memory, persists a snapshot to DO
storage after every mutation (cheap, and survives eviction).

### 6.1 Room phase machine

```
  LOBBY ──start──► COUNTDOWN ──►  PLAYING ──last box──► SETTLING ──►  RESULTS
    ▲                                 │                                  │
    └─────────────── rematch ─────────┴──────── all-ready ───────────────┘
```

- `LOBBY` — players join and leave. Host configures mode, player cap, grid size, clock.
  **There is no ready step** (revised 2026-08-02): being in the room *is* being ready, and
  only the host can start. Everyone has already opened the link and is looking at the same
  screen; a button to confirm that is pure ceremony. Non-hosts see
  `Waiting for {host} to start` in a box the **exact same height** as the Start button, so
  nothing on screen moves at the moment the host presses it. The `ready` flag survives on
  the player because **rematch voting still uses it**, where a per-player yes means
  something; the `ready` *message* is gone and `PROTOCOL_VERSION` is 3.
- `COUNTDOWN` — 3s, non-cancellable. Locks the roster. Late joins become spectators.
  *Not built at M3 — start goes straight to `PLAYING`, and the roster locks there instead.
  The countdown arrives with the Play-button sequence in M6.*
- `PLAYING` — the turn loop.
- `SETTLING` — final box claimed. Server freezes state, sends `gameOver`, waits ~5s for
  clients to run the shatter sequence.
- `RESULTS` — rematch voting. **The lobby is never destroyed.** Spectators are promoted to
  players on rematch. Benched players are un-benched.

The DO is evicted when empty; storage keeps the room for 30 minutes so a rejoin from a
shared link still lands in the same lobby.

### 6.2 Timers — one alarm, several deadlines

**A Durable Object has exactly ONE alarm**, and the room needs more than one deadline at a
time: the shot clock, plus a disconnect-grace countdown per dropped player. `rearm()`
collects every pending deadline via `dueTimes()`, sets the alarm to the earliest, and
`onAlarm()` processes everything that has come due, then re-arms.

**Add new timers to `dueTimes()`, never by calling `setAlarm` directly** — a second caller
silently overwrites the first, and the symptom is a shot clock that just stops. M5's shrink
schedule goes here too.

### 6.3 Shot clock

**12 seconds per turn — but 6 seconds for continuation turns** (the extra turn you get after
claiming a box). You already know where the next box is; you don't need full think time.
This is what stops one player holding the board for a minute on a long chain.

At **4 seconds remaining** the active player gets a warning: haptic buzz, ring turns amber,
subtle tone. See §12.2 for the client side.

`ctx.storage.setAlarm(deadlineMs)`. This is the single most important reason to use Durable
Objects — you get an authoritative timer without an always-on process.

**On `alarm()` the server places a line rather than passing. See §6.3.1.**

### 6.3.1 A timeout places a line, it does not pass — BUILT 2026-08-10

**In Dots and Boxes there is no passing.** `onAlarm()` used to call `skipTurn`, which
advances the turn without placing anything, so a player facing a losing turn could simply
let the clock run out. The entire endgame is about being forced to open a chain, so this
was not a small exploit — it was a way to decline to lose, and it was found in play
(2026-08-10).

**Decided and built 2026-08-10: keep the timer, and auto-play the SECOND most penalising
move.** `autoMoveLine` and `penaltyFor` in `rules.ts`; called from `onAlarm()` and from hot
seat's local clock. `skipTurn` survives only as the fallback for a board with no legal move
left, which is unreachable while a game is running (a live unclaimed box always has an open
side) — and is asserted as such in `rules.test.ts`.

#### Which move

Rank every legal move by how many boxes it hands the next player, highest first, and take
**the second-highest distinct penalty**. The owner's own example is the spec: if the
available moves would give away 10, 7 or 4 boxes, auto-play the **7**.

- Not the worst move, because a missed turn should not be a loss.
- Not a safe move, because then timing out is still free and the exploit survives.
- It is a warning with a real cost, which is exactly the intent.

Edge cases, all of which will occur:
- **Only one distinct penalty** (very common mid-game — most moves give away nothing):
  there is no second, so play a 0-penalty move. No penalty is possible, so none is applied.
- **Only one legal move:** play it.
- **Ties at the top** (two moves both giving 10): rank by *distinct value*, so the second
  distinct penalty is still 7 and not the other 10. This is the reading that matches the
  example.

#### Defining "penalty"

`penalty(line)` = **the number of boxes the next player could immediately claim**, computed
by applying the line to a copy and then greedily claiming every box that reaches 3 edges,
repeatedly, until none remain. That greedy loop is what makes it count a whole *chain*
rather than just its entrance — a 5-box chain shows only one or two 3-edge boxes, so a
naive count would rate it as harmless and the auto-move would happily hand it over.

Kept **pure and in `rules.ts`**, for the reason the whole file exists: the client replays
what the server did, so both must compute the same move from the same state. Ties within the
chosen penalty resolve to the lowest line id, which is what makes that agreement free.

#### ⚠️ Two things that would have silently broken — both now covered by tests

1. **Broadcast as a `move`, not a `skip`.** The client already replays `move` through the
   same `applyMove` the server ran (§7), so the auto-move needed no new replay path — just
   `auto: true` on the existing message, which the client passes straight back into
   `applyMove` and uses to say *"Ada ran out of time — a line was placed for them"*.
2. **The auto-move does NOT reset the missed-turn counter — it advances it.** `applyMove`
   clears `missed` on a successful move, which is right for a player who acted and wrong for
   one who did not. Had this been missed, `missed` would never reach 2, **nobody would ever
   be benched again**, and §6.4 would have quietly stopped working with no error and no
   visible symptom until an AFK player held a game up forever. Two consequences that fall
   out of it: an auto-move that claims a box does **not** hand a continuation turn to a
   player it just parked, and an armed Wildcard is refunded rather than fired for someone
   who has gone.

### 6.3.2 The endgame clock, and turning the clock off

**The 60% rule — BUILT 2026-08-10.** The owner asked for no timer once ~60% of cells are
captured, on the grounds that endgame moves deserve thought. That re-opened the exploit
§6.3.1 had just closed, at precisely the worst moment: with no clock, "wait forever"
replaces "wait 12 seconds", and the endgame is exactly when refusing to move is most
valuable.

**Owner accepted the recommendation 2026-08-10: the 60% rule LENGTHENS the clock rather
than removing it.** `turnSecondsFor` multiplies by `ENDGAME_CLOCK_MULTIPLIER` (2) once
`settledFraction` reaches `ENDGAME_CLOCK_FRACTION` (0.6). That grants the extra thinking
time the request was actually about while keeping a backstop, and leaves the auto-move as
the thing that guarantees every game terminates.

- The threshold counts cells that have LEFT PLAY, not cells captured: claimed, spent on a
  Wildcard, or burned by a collapsing ring. Monotonic, so the clock can only ever lengthen.
- Continuation turns double too (6s becomes 12s), which is the same "double `turnSeconds`"
  rule applied to the value actually in force.
- Anything drawing a countdown must ask `turnSecondsFor` for the total rather than restating
  12 and 6. `clockFraction` in `room.ts` had them hardcoded and would have left the ring
  pinned at full for the first half of every endgame turn.

**The host's off switch — 🅿️ PARKED, not deferred.** Owner's call, 2026-08-10: sit a few
games on the doubled clock first. The off-switch was asked for to give the endgame more
thinking time, and the doubled clock now does that, so it may be solving a problem that no
longer exists. **Do not build it on spec** — §16 #6 has what to watch for while playing and
what it would cost if it does come back.

`turnDeadline` is broadcast as an **absolute epoch ms**. Clients estimate clock offset at
join (3 ping round-trips, take the median) and render the countdown against corrected
local time. Never send "you have 12 seconds" — send "the deadline is T". The 8s warning is
derived client-side from the deadline; the server does not send a second message for it.

Deadline = `moveResolvedAt + turnSeconds + ANIMATION_GRACE(350ms)`.

`TURN_SECONDS = 12`, `CONTINUATION_TURN_SECONDS = 6`, both room config values, so presets
are free if we want them later. Both are doubled in the endgame — ask `turnSecondsFor` for
the value in force rather than reading the constants directly (§6.3.2).

### 6.4 AFK / benching

| Trigger | Result |
|---|---|
| **Miss 2 consecutive shot clocks** | `benched` ("parked") |
| WebSocket drops, no reconnect within 12s | `benched` |
| Any input from a benched player | un-benched, active from the *next* rotation |

The miss counter resets to 0 on any successful move, so an occasional slow turn never
parks anyone — it takes two in a row. **A timeout still counts as a miss even though a line
gets placed**: `applyMove` clears `missed` only when the player chose the move (§6.3.1).

Benched players: skipped in turn order, greyed in the scoreboard with a "TAP TO RETURN"
affordance, **keep their score and their shop inventory**, and are never removed from the
room. If everyone is benched, the match pauses (clock stops) rather than ending.

### 6.5 Identity, initials and the owner

**Initials come from names**, via `assignInitials()` in `src/shared/initials.ts` — pure and
tested. One letter each. If two people share a first letter, **everyone who clashes grows a
letter** until they are all different, capped at three: `Sarah` + `Smith` → **Sa** + **Sm**,
`Ada` + `Alan` → **Ad** + **Al**.

This reverses the earlier rule (revised 2026-08-02, was: fall through to your *second*
letter, so Alan became **L**, and earlier players never moved). Growing together is legible
and jumping is not — nobody could connect **L** back to Alan. The cost is that a newcomer
now does change an incumbent's label, from **S** to **Sa**; it is the same first letter with
more of the same name after it, and the roster locks at game start, so it can only ever
happen in the lobby. Colour stays the primary identifier; the letter is a shortcut.

Labels can therefore be 1–3 characters, and the board renderer sizes the font by length
(`PAINT.box.initialByLength`) — a three-letter label at the one-letter size runs out of its
box.

Initials are **derived, never stored authoritatively**: `refreshRoster()` recomputes them
(and colours, and the host) after any change to the roster or a name, so a rename updates
every screen at once.

**Colours are a preference, not an assignment** (added 2026-08-02). Settings holds a
favourite colour, sent with every `hello` as an index into `PLAYER_COLORS`. `refreshRoster`
grants it if it is still free and otherwise hands out the next open one — **silently**, with
no prompt and no error, because a colour is not worth interrupting anyone over. Earlier
players win a contested colour, so nobody in the lobby loses theirs to a newcomer. Changing
it in Settings takes effect on your next connection.

**The name is remembered on the device.** Asked for once, then shown as "Playing as X ·
change". Retyping it every session is pure friction for a game played with the same people.

**The owner always hosts.** A device holding the owner key takes the host role the moment it
connects, whatever the join order; otherwise the first player in hosts, as before.

- The key lives in `localStorage` on the owner's device, entered once.
- It is sent with every `hello` and checked against the `OWNER_KEY` Worker secret, so the
  key itself never appears in the shipped code.
- **If `OWNER_KEY` is unset the feature is simply off** — a deliberately safe default.

```bash
npx.cmd wrangler secret put OWNER_KEY   # production
echo "OWNER_KEY=..." > .dev.vars        # local dev (gitignored)
```

### 6.6 Spectators

Anyone joining after `COUNTDOWN` starts. They receive full state and all events, render
the board read-only, and are queued for the next rematch. Cap spectators at 20.

---

## 7. Wire protocol (`src/shared/protocol.ts`)

JSON over WebSocket. Every message is `{ t: string, ...payload }`. Include
`PROTOCOL_VERSION`; on mismatch the client shows "refresh to update."

### Client → Server

| `t` | Payload | Notes |
|---|---|---|
⚠️ **This table drifted from the code and cost an hour at M7.** `src/shared/protocol.ts` is
the truth; what follows is now checked against it. The traps, specifically: the buy and arm
messages are **`buy`** and **`arm`**, not `buyWildcard`/`armWildcard`; `hello` **requires**
`protocolVersion` and is rejected without it; and **there is no `gameStart` message at all**
— a game starting is a `room` broadcast whose `phase` is `playing`.

| `t` | Payload | Notes |
|---|---|---|
| `hello` | `protocolVersion, clientId, name, ownerKey?, colorIndex?` | `clientId` persisted in localStorage. Wrong/missing version → `bad-protocol` |
| `configure` | `mode?, gridSize?` | host only |
| `start` | — | host only |
| `move` | `lineId, turnSeq` | `turnSeq` makes it idempotent |
| `buy` | — | twist mode, own turn, pre-move |
| `arm` | — | spends a charge; next `move` won't end the turn |
| `rematch` | — | a vote; the server tracks each player's `ready` |
| `wake` | — | un-park yourself |
| `ping` | `t0` | clock sync |

### Server → Client

**There are seven, not the thirteen this table used to list.** Most of the missing ones were
never built as separate messages: the roster, the phase, the rematch votes and the bench
state all ride on `room`, and a shrink rides on the `move` that caused it. Corrected against
`protocol.ts` at M7.

| `t` | Payload |
|---|---|
| `welcome` | `you, serverNow, room` |
| `room` | `room: RoomSnapshot, serverNow` — roster, phase, config, rematch votes |
| `move` | `playerIndex, lineId, claimed[], scores[], again, wildcardFired, auto, benched, gameOver, winners[], shrink, serverNow, turn` |
| `skip` | `playerIndex, reason: timeout\|disconnect, benched, paused, gameOver, winners[], shrink, serverNow, turn` |
| `wildcard` | `playerIndex, action: bought\|armed, burned[], charges, scores[]` |
| `pong` | `t0, serverNow` |
| `error` | `code, message` |

Three consequences worth holding onto:

- **The end of the game is a flag on a move, not a message.** `gameOver: true` plus
  `winners[]` arrives on the `move` (or `skip`) that finished it. Nothing called `gameOver`
  is ever sent, and nothing waits five seconds for a client animation — see §12.3.
- **A collapse rides on the move that triggered it**, in `shrink: ShrinkOutcome | null`.
  There is no separate warning message either; the two rounds of notice in §9.2 are derived
  client-side from the replayed state.
- **The turn lives in one `turn: TurnInfo` object** on both `move` and `skip`, rather than
  in loose `nextPlayerId` / `turnDeadline` fields.
- **A shot clock running out arrives as a `move` with `auto: true`**, not as a `skip` — see
  §6.3.1. `skip` now means a disconnect, near enough. The client must pass `auto` back into
  `applyMove`; it is what turns the replay into a miss rather than a move.

**Snapshot encoding.** Plain number arrays, not base64'd typed arrays (revised at M3).
A 10×10 board is ~320 small integers, sent only on join and reconnect, and it compresses
well over the socket. Being able to read a snapshot in devtools is worth more than the
~600 bytes. `src/shared/snapshot.ts` converts to and from the live typed arrays and is
tested for lossless round-tripping, including through `JSON.parse(JSON.stringify(...))`.

**The client replays, it does not trust.** Every `move` and `skip` broadcast is re-applied
locally through the *same* `applyMove` / `skipTurn` the server ran, rather than the client
patching in scores from the wire. Server and client therefore recompute identical state
from identical inputs, and a mismatch is a loud bug (dev builds warn on score divergence)
instead of a silent drift. If a replay fails, the client re-sends `hello`, which returns a
full snapshot — cheaper and safer than trying to reconcile.

**Bench state has two sources — use the game state.** A timeout only broadcasts `skip`, so
`RoomSnapshot.players[].benched` stays stale until the next full room broadcast. The UI
must read `state.benched[myIndex]`, which the local replay keeps current.

**Player vs spectator is derived, never tracked.** Both come from the roster in the latest
snapshot (`players.some(p => p.id === me)`). A separate `role` field was tried and removed
at M4: two sources for one fact can disagree, and this one is already in every message.

**Anything the client BLOCKS on must be answered — silence is a bug, not a no-op.**
(Added 2026-08-03, after it ruined a playtest.) The client draws an optimistic *pending*
line the instant you tap and then refuses further input until it hears back, because a
second tap would be a second move. So a `return` on the server does not drop one move; it
strands that player for the rest of the game, staring at a faint line nobody else can see.
`onMove` therefore answers **every** path, including the stale-`turnSeq` guard, with an
`error` — the `stale` code exists for exactly this and is safe on a duplicate retry, since
the client will already have cleared its pending line when the original broadcast arrived.

Three layers, because one was clearly not enough:

1. the server never fails silently;
2. `socket.ts` refuses to QUEUE perishable intents (`move`, `buy`, `arm`) across a
   reconnect — a move is bound to a `turnSeq`, so replaying it seconds later is guaranteed
   to be rejected and is never what the player meant;
3. the client gives up on an unconfirmed line after `PENDING_TIMEOUT_MS` (2.5s), retracts
   it and resyncs. This is the one that holds when the cause is a dropped packet or a bug
   nobody has found yet. **Do not remove it because the first two look sufficient.**

**Connection status outranks every other banner.** If the socket is down, the turn, bench
and spectator states on screen are all potentially stale, so "Reconnecting…" wins. Getting
this order wrong (found at M4) left disconnected spectators looking perfectly normal.

---

## 8. Board model (`src/shared/board.ts`)

For an `n × n` box grid there are `(n+1) × (n+1)` dots.

- Horizontal lines: `H[r][c]`, `r ∈ [0, n]`, `c ∈ [0, n-1]` → `n(n+1)` of them
- Vertical lines: `V[r][c]`, `r ∈ [0, n-1]`, `c ∈ [0, n]` → `n(n+1)` of them
- **Total lines = `2n(n+1)`**
- Box `B[r][c]` is bounded by `H[r][c]`, `H[r+1][c]`, `V[r][c]`, `V[r][c+1]`

`lineId` is a flat index: horizontals occupy `[0, n(n+1))`, verticals occupy
`[n(n+1), 2n(n+1))`. Keep `lineIdToBoxes(id)` and `boxToLineIds(r,c)` as the only two
functions that know this encoding — everything else uses ids.

### 8.1 Board size — host picks a named preset

**The host chooses Small / Medium / Large / Grand** (revised at M6). Raw grid dimensions
mean nothing to a player — "10×10" does not communicate "this is a twenty-minute game" —
so the lobby shows names plus an estimated length.

| Preset | Grid | Boxes | Lines | Est. length | Burns down to |
|---|---|---|---|---|---|
| Small | 8×8 | 64 | 144 | ~14 min | 6×6, one ring |
| Medium | 10×10 | 100 | 220 | ~22 min | 6×6, two rings |
| Large | 12×12 | 144 | 312 | ~31 min | 6×6, three rings |
| Grand | 14×14 | 196 | 420 | ~42 min | 6×6, four rings |

**Every size starts at 8** (revised 2026-08-02). The shrinking board stops once the short
side would drop below `SHRINK_FLOOR_SQUARES` (6), so a 6×6 board could never burn a single
ring — Twist on it was indistinguishable from Simple. Starting at 8 makes every board
converge on the same 6×6 core, and the default game is unchanged: what used to be Medium
and Large are now Small and Medium.

**Grand needs `GRAND_MIN_PLAYERS` (4) to be selectable.** 420 moves is two people
alternating for the better part of an hour otherwise. The lobby greys the chip and says
why; the server enforces it on `configure` *and* re-checks at start, because a lobby can
pick Grand with four people and then two of them leave.

`gridSizeFor(players)` supplies the default when the host hasn't chosen: **Small** up to 6
players, **Medium** at 7–8. It never returns Grand — that has to be chosen on purpose. It
must always return a value that *is* a preset, or the lobby shows no chip selected and
looks broken — there's a test for that.

Length is `2n(n+1)` moves at ~6s each; it grows quadratically, which is why Grand is nearly
four times Small.

**More players should not force a much bigger board.** Eight people on a 10×10 board is
*more* contested and more interesting, not cramped. Growing the grid to hold
"boxes per player" constant mostly just adds waiting. That's why the presets top out at
Grand and the default only steps up once.

**Grand is deliberately available and deliberately not a default.** ~31 minutes is a real
commitment, which is exactly why the lobby prints the estimate next to the choice.

---

## 9. Rules engine

### 9.1 Simple mode (both modes share this core)

1. On your turn, place one line on any unoccupied edge.
2. Any box whose 4th edge you just placed is claimed by you (a single line can claim two).
3. **Claim ≥1 box → you go again**, with a fresh shot clock. Chains are the whole game.
4. Claim 0 boxes → turn passes to the next non-benched player.
5. Game ends when every box in the playable area is claimed. Most boxes wins.
6. Ties: shared victory, both panels highlighted. No tiebreaker rounds.

Turn order is a fixed rotation assigned at `COUNTDOWN` (shuffled), so it's fair and
predictable. Benched players are skipped but keep their slot.

### 9.2 Twist mode — Shrinking Board (sudden death)

- **Arms** once 55% of all lines are placed — **45% in lobbies of 6+**, since those are the
  games most at risk of dragging. This is the main lever for game length; tune it here
  before touching grid size.
- Then, every **2 full rotations**, the outermost ring of the current playable area collapses.
- **Two rounds of notice, not one** (revised at M6 after playtest — "it catches you off guard").
  A collapse should be something players hurry *towards*, not an ambush:
  - **2 rounds out:** a visible countdown chip, "Board shrinks in 2". No pulse yet.
  - **1 round out:** "Board shrinks NEXT round", and the doomed ring pulses red.
  - Then it collapses.

  `roundsUntilCollapse(state)` drives the chip; `isShrinkWarning()` is just
  `rounds <= 1`. One round of notice arrives too late to change anyone's plan, which is
  precisely the complaint. Never collapse without both stages.
- **Say what was KEPT, not just what vanished.** Claimed tiles in a collapsing ring bank
  their points, so the toast reads "N boxes banked · M lost". Phrasing it as pure loss made
  a neutral mechanic read as a punishment.
- On collapse:
  - Boxes in the ring **already claimed** → owner keeps the point, and once the tile has
    cooled it keeps their letter in grey, so the board stays countable.
  - Boxes in the ring **unclaimed** → destroyed. Worth nothing to anyone.
  - Lines belonging only to the ring are removed.
  - **The board does not move.** No contraction, no re-centre, no resize (revised
    2026-08-03 — the design pass was explicit about this, and it is the whole reason
    players can keep counting their squares afterwards). The ring burns *in place* over
    ~2.9s with a `whoosh`; see §10.4.
- **The board stops burning at a 6-square short side** (`SHRINK_FLOOR_SQUARES`, revised
  2026-08-02). A ring collapsing into a 4×4 sliver is neither readable nor worth playing
  out, and the burn needs a decent ring to look like anything. Consequence: a Twist game no
  longer ends by the board eating itself — it ends the ordinary way, when the surviving core
  is fully claimed. That still terminates, because every move places a line and lines run
  out. `canCollapse(state)` is the single source of this rule: it gates arming, the
  countdown, and the collapse itself, so the UI never counts down to a collapse that cannot
  happen.

This is the pressure valve for large lobbies: it punishes hoarding safe edge boxes and
forces the fight into the centre.

### 9.3 Twist mode — the Wildcard

One item, one effect. *(An Eraser was considered and cut — deleting an opponent's line was
too swingy, and it made every claimed box feel provisional.)*

- **Cost: 10 points. Effect: place one extra line this turn.**
- Buy only on your own turn, before placing. Requires score ≥ 10.
- **The price is shown before it is paid** (added 2026-08-02). Whenever you could buy one
  right now — your turn, twist, affordable, not already holding the maximum — the ten
  squares it would cost are outlined on the board in the metal they would become. Ten
  squares silently turning grey looks arbitrary unless you already know the rule; showing
  which ten makes the rule explain itself. `wildcardCostPreview()` is what the board draws
  **and** what `buyWildcard` spends, so the two cannot disagree — there is a test for that.
- **Spending burns 10 of your claimed boxes** — chosen furthest-from-centre first. They go
  dark grey on the board, count for nobody, and crumble to dust (rather than fly) in the
  endgame. This keeps `score === boxes you visibly own` true at all times, which the entire
  endgame animation depends on.
- Charges cap at **2**. No hoarding.
- Flow: `buyWildcard` → charge held → tap it in the HUD (`armWildcard`) → it fires
  automatically. Explicit arming, so nothing is ambiguous under the clock.
- **When it fires (decided at M1):** an armed Wildcard fires on the first placement that
  *would otherwise end your turn*. If the line you place claims a box, you were continuing
  anyway — the Wildcard is **not** consumed and stays armed for later in the same turn.
  This means arming is never wasted, which matters a lot when you're arming under a clock.
  It disarms automatically when your turn genuinely ends.
- **A Wildcard rescue grants a full 12s turn, not the 6s continuation clock.** You didn't
  claim anything, so you may genuinely need think time — a rescue is not a chain.
- **An armed Wildcard that never fires is refunded** (decided at M5). Arming spends the
  charge, but a turn that ends without a placement — a timeout, or being parked — hands it
  back. Paying 10 boxes and then losing it to the shot clock punishes exactly the moment
  you were thinking hardest. `advanceTurn` does the refund, and it cannot double-refund
  because `applyMove` always clears `armed` before advancing.
- Broadcast to the whole room with its own sound and a toast — everyone should understand
  why someone got two lines.
- **Holding a Wildcard is public** (added at M6). A ✦ badge sits on the owner's scoreboard
  avatar for the whole table to see, and glows while armed. A power nobody can see
  generates no tension; the point is that everyone knows someone is holding one.
- ⚠️ The badge must show when `charges > 0` **OR** that player is armed. Arming *spends*
  the charge, so keying the badge off `charges` alone hides it at the exact moment it
  matters most — the move it is about to fire on. (Caught in review at M6.)

**On the price.** 10 points is deliberately steep: average score in a 6-player, 81-box game
is ~13, so buying is over half your holdings. That makes it a bad early-game move and a
potentially decisive late-game one — in the endgame, dodging a forced chain sacrifice is
worth far more than 10 boxes. That asymmetry is good design, not a bug. Keep the price as
`WILDCARD_COST` in `constants.ts` so playtesting can tune it in one line.

---

## 10. Client rendering

### 10.0 Game screen layout — fixed rows, one flexible board

```
 header      back · "Now playing · Ada" · room code      2.25rem, fixed
 scoreboard  avatars, scores, shot-clock rings           auto, stable
 board       <canvas>                                    flex: 1  ← only this moves
 shop        twist mode only, always present             2.4rem, fixed
 banner      turn / parked / reconnecting                1.9rem, fixed
```

**INVARIANT: every row outside `.board-wrap` keeps a constant height for the whole game.**

Anything that appears or disappears resizes the board, which fires the `ResizeObserver`,
which resizes the canvas — and the whole screen visibly jumps. Found at M6: the shop used
`hidden` and toggled per turn, moving the board **39 px on every single move**. Measured
before and after; it is now one distinct height across a whole game.

Consequences to preserve:
- The powerup row renders only in twist mode, but once rendered it stays and **greys out**
  rather than vanishing. Players also need to see a power exists before they can afford it.
- The banner has a fixed height and `white-space: nowrap`, so a long name can't reflow it.
- The room code lives in the header all game, because a **parked player rejoins by code**
  and otherwise has no way to read it.

### 10.1 Layers

**ONE canvas, fully redrawn per frame, plus DOM for the HUD.** (Revised at M2 — this
section previously specified a dirty-flag board layer and a separate per-frame fx layer.)

| Layer | Type | Redraw |
|---|---|---|
| `board` | `<canvas>` | Whole scene each frame: dots, lines, claimed boxes, initials, ghost, animations. |
| `hud` | DOM + CSS | Scoreboard, shot clock ring, shop, pill, toasts, buttons. |

**Measured at M2:** a full redraw of a completely filled 10×10 board (220 lines, 100 boxes
with initials, 121 dots) takes **0.725 ms** — 23× under the 16.67 ms 60fps budget. A
dirty-flag split would optimise something that is already 4% of a frame.

The render loop is **on demand**: `stage.requestFrame()` schedules a frame, and the draw
function returns whether any animation is still running. A turn-based game is idle most of
the time, and a permanently-spinning RAF is pure battery burn for nothing. (`requestAnimationFrame`
does not fire at all while the tab is hidden, so the stage also repaints on `visibilitychange`.)

Two things keep the full redraw cheap, and both matter more than layer splitting:
- dots are prerendered once into an offscreen sprite and blitted, rather than building a
  radial gradient per dot per frame;
- lines and box fills are batched into **one path per player**, so `shadowBlur` is set ~8
  times a frame instead of ~450.

The canvas is sized `cssPx * devicePixelRatio`, capped at DPR 2 (DPR 3 costs fill rate for
a difference nobody can see on a 6" screen).

**M7 did add the second canvas**, and not for the reason this note expected. It was never a
performance decision — a full 12×12 shatter costs 1.8 ms median, well inside one layer's
budget. It is a *clipping* one: the pieces have to fly out of `.board-wrap` and land on DOM
scoreboard panels, and anything drawn on the board canvas stops existing at its edge. The
new layer is absolutely positioned over the whole `.game` element and holds no row, so
§10.0 is untouched. See `render/shatter.ts`.

Both layers are driven from **one** `requestAnimationFrame` loop — the board stage's — which
is also why `__box.drawNow()` renders both. Two loops on one screen drift against each other
and each keeps the other's battery cost alive.

### 10.2 Input

- **Primary: tap-nearest-legal-line.** Project the tap into dot space, generate the nearest
  horizontal and nearest vertical candidate, take the closer *legal* one. Accept within
  `0.45 × cellSize`. Reject ambiguous taps where the two candidates are within 15% of each
  other — show a brief "aim" hint rather than guessing wrong.
- ⚠️ **Distance is measured to the nearest point ON the segment, not to its midpoint.**
  A midpoint metric looks equivalent and is not: a tap right beside a dot sits ~0.05 cells
  from two lines but ~0.45 from both of their *midpoints*, so it silently swallows taps
  near every intersection on the board. Caught by a unit test at M2; do not "simplify" it back.
- **Secondary: drag from a dot** to an adjacent dot. Ghost line follows the finger; release
  commits. Movement past 8 px switches from tap to drag. Non-adjacent and diagonal releases
  are ignored rather than snapped.
- **Confirm-tap: on by default for grids ≥ 10×10**, off below. First tap ghosts the line,
  second commits; tapping elsewhere re-targets. The 12s clock affords this comfortably, and
  a misplaced line is far more painful than a slow turn.
  ⚠️ **It is NOT overridable in settings**, whatever this line used to claim — there is no
  such control in `settings.ts`, and nothing in the UI says a second tap is expected. A
  playtester reported it as "multiplayer tap isn't responsive, have to double tap"
  (2026-08-10), which is precisely what an undisclosed confirm step feels like. Either
  build the toggle this line promised, or tell the player on screen that the ghost is
  waiting for them — but stop shipping a deliberate extra tap that looks like a dropped one.
- `touch-action: none` on the canvas. Handle `pointerdown/move/up`, not touch events.
- ⚠️ **`touch-action: none` does NOT stop iOS from treating a drag as "go back".** Safari's
  edge swipe is a SYSTEM gesture; neither it nor `overscroll-behavior: none` touches it, and
  a drag starting near the left of the board navigated the whole app away mid-turn on a
  real iPhone (2026-08-03). The only thing that suppresses it is `preventDefault()` on a
  **non-passive** `touchstart`, which `pointer.ts` registers on the board element — passive
  is the default on document-level targets, and there `preventDefault` is ignored in
  silence. Scoped to the board so nothing else on the page loses its gestures.
- **A ghost and a pending line must never look alike.** A ghost means "tap again to place
  this"; a pending line means "placed, waiting on the server". Both were drawn as one faint
  line, so players tapped a second time and lost the turn. Now: the ghost keeps the white
  finger-lit end dots, and the pending line is fainter still (11% vs 96% for a real line),
  breathes, and lights no dots — the finger has gone, and the only open question is whether
  the table accepted it.

### 10.3 Animation budget

Target 60fps. Hard rule: **no allocation inside the RAF loop.** Particles come from a
preallocated pool. Tweens are structs in a flat array, not closures.

| Event | Duration | Notes |
|---|---|---|
| Line placement | 140ms | Draw-on from origin dot, ease-out. `tick` sfx at 0ms. |
| Box claim pulse | 260ms | Scale 0.85→1.06→1.0, fill fades in, then initial. `click` at 0ms. |
| Turn handoff | 180ms | Active player panel glow crossfade. |
| Shrink warning | 2 rotations | Doomed ring breathes, period 1.3s. Countdown chip in the shop row. |
| Shrink collapse | ~2.9s total | 1400ms fuse, then the ring burns in place. See §10.4. `whoosh` at 0ms. |
| Endgame shatter | ≤3.5s total | See §12.3. Stagger scales down as box count rises. |

### 10.4 The Twist burn (`src/client/render/burn.ts`)

**The fire is painted over a collapse that has already happened.** This is the single fact
that explains the whole file. `applyMove` collapses a ring *instantly* — the boxes are
`DEAD`, the orphaned lines are cleared and `bounds` has contracted before a frame is drawn —
because animations never gate state (§5). So the burn runs backwards from how it looks: it
is handed the `ShrinkOutcome`, and for ~2.9s it draws those squares as though they were
still alive, then burns them down to the ash the state has claimed they are all along.

Consequences worth knowing:

- Play continues over the top of it, which is correct — the ring is dead and nobody can
  move there anyway.
- A reconnect mid-burn just shows the finished board. `reset()` drops the fire, because
  finishing it would be animating history.
- **The 1400 ms warning fuse sits AFTER the state collapse, not before it.** The prototype
  put it before, having no rounds to work with; the real game already gave two rounds of
  notice (§9.2), so the fuse is the "it's going NOW" beat rather than the warning itself.

The sequence, values from `design/tiki-board.html`:

| Phase | Time | What |
|---|---|---|
| Fuse | 0–1400ms | Doomed dots pulse faster (period 100→30ms); the **top-left corner dot** heats toward white and swells 1.35×, so players see *where* before *when*; the vignette deepens by 0.25. |
| Ignition | 1400ms | The top-left square catches. |
| Spread | 42ms/tile | **Both ways around the ring at once**, the two arms meeting at the opposite corner. A 36-tile ring is alight end to end in ~760ms. |
| Per tile | 130ms flash, 420ms cool | White-hot → hot → ember → ash, landing exactly on `ashFill` so the cool arrives at the resting state instead of stepping to it. |
| Per dot | with its first neighbour | Flashes white, cools to `COLOR_DEAD`, glow to zero. Only the OUTER dots die; the inner ones are the new edge. |

**`harvested` is load-bearing, not decoration.** By ignition time the state has overwritten
`boxes[id]` with `DEAD`, and `formerOwner` cannot distinguish "Ada owned this" from "Ada
spent this on a Wildcard" — both write it. Without the harvested list a traded square would
spend the fuse pretending to be a live one, and since Wildcards burn the squares furthest
from centre, the traded ones are *exactly* the ring this fire eats.

**Measured** on a 10×10 board with a 36-tile ring: **1.3 ms median, 2.6 ms worst frame**
against the 16.67 ms budget — 6× headroom. Desktop, not a phone. The fire is a *front*, not
a bonfire: only ~18 tiles are alight at once whatever the ring size, so Grand costs
proportionally more particles but not proportionally more frames. Particles come from a
preallocated pool of 460 and are recycled by swapping references, never by allocating.

⚠️ **The vignette only breathes while something is pending.** A pulse that ran all game
would hold the on-demand render loop open from the first move to the last (§10.1) — pure
battery burn for an animation nobody is looking at. It sits at base alpha otherwise.

**Deliberately not built: the four rounds-left dashes** from handover §6. They assume a
four-round cycle; `SHRINK_INTERVAL_ROTATIONS` is 2, and the collapse countdown chip already
says "Board shrinks in 2" / "NEXT round" in words, which playtested well. Two sources for
one fact, one of them wrong about the rules, is worse than one.

---

### 10.5 Telling players what Twist is doing

Both Twist mechanics were invisible in play. The information existed; nobody saw it.

⚠️ **In hot seat the information did not even exist** — found 2026-08-12. The flame badge and
the shop row were written inline in `room.ts`, and `hotseat.ts` rendered a scoreboard, a
board, a pill and a toast and nothing else. Single-player Twist therefore ran with no
collapse warning and no way to buy a Wildcard at all, while the rules engine cheerfully
collapsed rings and priced Wildcards nobody could reach.

**Both now live in `src/client/ui/twistHud.ts`, mounted by both screens.** It exports
`BURN_WARNING_HTML` and `SHOP_HTML` for the caller to place, plus `createTwistHud(root, {
onBuy, onArm })` — the two callbacks being the only real difference between the screens
(online sends `buy`/`arm`; hot seat calls `buyWildcard`/`armWildcard` directly).

⚠️ **Extracted rather than copied, deliberately.** This is a feature whose entire recorded
history is being invisible in slightly different ways (§10.6), so a second copy is exactly
the wrong shape — the next fix would land on one screen and not the other, which is how this
bug was born. Verified 2026-08-12 in both: badge hidden at kickoff, appearing at two rounds
out with the ring draining, hiding again once no collapse is possible, buy taking 10 boxes
for one charge, arm consuming it, **and `.board-wrap` holding one single height (557px)
across an entire hot-seat game** — the §10.0 invariant survives the new rows.

**The collapse warning is a flame badge ON the board.** A 2.75rem ring in the board's
top-right corner, absolutely positioned inside `.board-wrap` so it costs the layout nothing
(§10.0). The ring is a dial that drains as the collapse approaches — full two rounds out,
half at one round — and at one round it turns red and pulses. It hides itself when no
collapse is pending, which includes after the final burn at the floor. ⚠️ **That last
sentence was aspirational until 2026-08-10 — it did not hide, and that is the whole of
§10.6.**

The text chip in the shop row stays, because the two are read at different moments: the
badge is glanceable mid-turn where the eyes already are, the chip spells it out in words.
The chip alone was missed entirely — 0.7rem of dim text in a row nobody was looking at.

⚠️ **Do not put a `transition` on the ring's `stroke`.** Transitions cannot run on a
`display: none` element, and this badge hides and shows around every collapse, so an easing
stroke froze part-way and left the ring amber while the board was one round from burning.
Only `stroke-dashoffset` eases. "It is urgent now" should not fade in anyway.

**The Wildcard announces itself once, when you can first afford it.** A chip reading
`Wildcard · 10` that sits disabled and dim for the first ten minutes teaches nobody that it
exists. So the first time it is genuinely payable — your turn, twist, ten squares banked,
not already holding the maximum — a small pill appears above the button saying
"Tap for Wildcard · one extra line", the button glows, and both fade after 5s. Once per
game: a prompt that keeps coming back stops being information and becomes nagging.

- It is **anchored to the buy button, not to the row.** The row holds three items, so a
  row-centred pointer tail aims at the gap beside the button it is describing.
- It is deliberately **not itself a buy button.** It appears unprompted right where a thumb
  already is, and spending ten hard-won squares on a mis-tap is exactly the kind of thing
  that makes someone put the game down. It points; the real button still does the spending.

### 10.6 Why nobody could see the collapse warning — DIAGNOSED AND FIXED 2026-08-10

Two playtests reported *"I still do not see any warning for the burning. It just comes out
of nowhere."* §16 #5 offered two hypotheses. **Both were wrong**, and the real cause is
worth reading before touching any component that hides itself.

**The room was in Twist.** Ruled out from the report alone: a collapse cannot happen in
Simple mode at all (`maybeArmShrink` returns early), so a player who watched the board burn
was in a Twist room by definition. Confirmed in a live room anyway — `state.mode` reaches
the board as `"twist"`, the chip selects, and both elements are in the DOM.

**The warning was not too brief.** Measured across board sizes and lobby sizes by playing
games with a greedy model player: the badge is live for **35–87 turns** before the first
collapse, 18–26 of them the warned player's own. Timing was never the problem.

**`hidden` was not hiding it.** `.burn-warning` declared `display: grid`, which beats the
browser's own `[hidden] { display: none }` — an author rule always outranks a UA rule. So
`burnWarning.hidden = true` set the attribute, changed nothing on screen, and passed every
review because the code reads correctly.

What a player actually saw, therefore:

- a flame badge on the board **from the first frame of every Twist game**, with an empty
  number, before any collapse was scheduled;
- the badge **frozen on its last value forever after the final burn** — measured in a real
  room: board already collapsed to 6×6, `collapseAtRotation` null, no further collapse
  possible, and the badge still on screen, still red, still pulsing, still titled *"The
  outer ring burns next round."*

A warning that is always on is not a warning. It is furniture, and players correctly learn
to ignore furniture — which is exactly why the real collapse "came out of nowhere". The
badge did not fail to appear. It failed to ever *dis*appear, and that is what destroyed its
meaning.

**The fix is one rule in `base.css`: `[hidden] { display: none !important }`.** Three other
components had already been bitten and each carried its own `X[hidden] { display: none }`
patch — `.waiting`, `.wildcard-badge`, `.overlay`. The fourth had no way to know it needed
one. Those three patches are now deleted; the global rule covers them, which was verified
component by component in the browser.

⚠️ **The lesson generalises: in this codebase, setting `display` on a component silently
breaks `hidden` for it.** The global rule now makes that impossible. Do not remove it, and
do not "fix" the `!important` — being unbeatable by a component's own `display` is the
entire point.

**Still open: the Wildcard half.** The shop row and the nudge are correct — the nudge hides
properly and fires once, when you can first afford one. But the same measurement shows the
first Wildcard becomes affordable **very late**: turn 93 of 132 on a 2-player Small board,
turn 165 of 180 on a 6-player Medium. Boxes in Dots and Boxes all arrive at the end, so the
buy button is honestly unusable for most of the game and the one nudge lands in the middle
of the endgame scramble. That is a design question, not a bug, and it wants a playtest
verdict before anyone rebuilds it — see M7.5 item 6, which already proposes a redesign.

---

## 11. Visual design tokens

```
--bg-deep      #0B0D12    radial gradient centre → #131722 edges
--surface      #171B26    panels, scoreboard
--dot          #FFC24B    warm yellow
--dot-glow     #FFB020    24% alpha, 8px blur
--grid-hint    #2A3040    faint unplaced-line hint (2% alpha, only on hover/drag)
--text         #E8EAF0
--text-dim     #7A8296
```

Player palette (assigned in join order, max 8 — all distinguishable on dark, and checked
for deuteranopia separation):

```
1 #22D3EE cyan     5 #A78BFA violet
2 #F472B6 magenta  6 #F87171 red
3 #A3E635 lime     7 #2DD4BF teal
4 #FB923C orange   8 #FBBF24 amber
```

- **Line:** player colour, `4px` at 8×8 scaling down to `3px` at 12×12, round caps,
  outer glow at 35% alpha.
- **Claimed box:** player colour at 16% fill, 1px inset border at 40%, initial centred at
  70% opacity in a heavy geometric face.
- **Two dead tiles, drawn differently on purpose** (revised 2026-08-02). They mean opposite
  things, and drawing both as grey made a trade look like damage:
  - **Burned by the fire (`DEAD`)** — ash: `rgba(15,19,28,.94)` with a `rgba(35,42,59,.85)`
    edge, no glow, and **the owner's letter stays** in `--dim` at 0.56. The point was banked
    the moment the square closed, so burning takes the tile and not the score — players must
    still be able to count what they won. Collapsed tiles stay exactly where they were; the
    board never moves.
  - **Spent on a Wildcard (`SPENT`)** — metal (`SPENT_TILE`): a cool gradient lit from above
    with a bright top bevel ash never has, and **no letter at all**, because it was paid
    away and counts for nobody. A letter there would claim a point that is gone.

  `GameState.formerOwner` records the prior owner for both, because `boxes[id]` is
  overwritten in each case and the owner would otherwise be gone by the time the renderer
  runs.
- **Elevation:** soft shadows only, never hard. `0 8px 32px rgba(0,0,0,0.5)`.
- **Type:** one variable font. Tabular numerals on the scoreboard (non-negotiable — the
  count-up animation jitters otherwise).
- **Motion:** honour `prefers-reduced-motion` — keep state changes, drop shatter/particles
  in favour of a fast crossfade.

---

## 12. The three set-piece sequences

### 12.1 Start

**The box-with-a-lid is gone** (revised 2026-08-03). The design pass superseded it with the
Tiki mark — handover §0 — and the old prototype survives only as the reference for the shake
and roll-in timings. What ships is `src/client/ui/startSequence.ts`, and the point of it is
that **the logo performs the game's own gesture**: the stem of the first `i` draws downward
with exactly the duration and easing of placing a line, then the mark lands hard enough to
shake the dots loose, and they fall into place as the board.

| Time | Beat |
|---|---|
| 120ms | The stem draws down, 140ms, on the line-placing curve. |
| 250ms | The mark flares, a 90ms box-shadow ramp. |
| **270ms** | **Impact.** Screen shake begins: 6px x / 4.2px y over 180ms, quadratic decay, `sin 7.3` / `cos 5.1` so the axes never line up into a diagonal wobble. `thunk` fires **here, on contact, never on the tap**. |
| 380ms | The mark swells to 1.09 and fades out over 200ms, uncovering the board. |
| 440ms | The dots begin rolling in: rows from the top, 35ms apart, each falling one cell with an easeOutBack overshoot of 1.35 over 380ms, fading in over the first 55% of that. |
| +240ms | After the last row lands, the HUD arrives and play begins. |

Grid lines *do not* draw — only dots. The empty board should feel like an invitation.

Three things that are load-bearing rather than incidental:

- ⚠️ **The renderer is ARMED with a future start time, not told when to go.**
  `startEntrance(now + BOARD_START_OFFSET_MS)` — from that call until the moment arrives the
  board draws *nothing*, which is what gives the mark an empty table to land on. `entranceAge`
  returns `null` for "not scheduled" and a **negative number** for "armed but waiting"; those
  are different states, and conflating them into one `-1` sentinel drew the whole board
  through the entire performance.
- **`linesPlaced === 0` gates the whole thing.** It keeps the ceremony away from a spectator
  arriving mid-game and from anyone reconnecting, both of whom mount the same view onto a
  board that is already half played.
- **The overlay swallows input** (`pointer-events: auto`) for its 1.3s. The board is empty
  and the HUD is hidden, so a tap falling through would place a line on a board the player
  cannot see, on a turn they do not know is theirs.

The HUD is hidden with **opacity, never `display`** — those rows hold the board's height, and
removing them would resize the canvas mid-sequence (§10.0) at the worst possible moment.

**This sequence is also where Web Audio gets unlocked** (first user gesture). Convenient
and non-negotiable on iOS. *Until it is built, the first gesture anywhere in the app does
the unlocking (§13), and the Play button will simply become one more of them — no change
needed here when it lands.*

### 12.2 During play

- Active player's scoreboard panel: brighter surface, coloured left rail, and a **shot
  clock ring** draining around their avatar.
- **The 4-seconds-remaining warning**, on the active player's device only:
  - `navigator.vibrate(40)` — a single light buzz.
  - Ring flips to amber and starts a 1Hz pulse; red for the final 2s.
  - A quiet high `blip`, respecting the mute toggle.
  - Fires **once per turn**, guarded by a flag that resets on turn start, so a chain of
    quick claims doesn't buzz repeatedly.
- ⚠️ **`navigator.vibrate()` does not exist on iOS Safari** — no PWA workaround. Feature-detect
  it. **iOS fallback:** a small non-intrusive pill ("4s") fades in just above the board for
  ~700ms alongside the amber ring — no modal, no takeover, nothing that blocks a tap.
  Android gets the same pill plus the buzz, so behaviour is consistent.
- Every line: `tick`. Every box: `click`. Pitch jittered ±5% so chains don't sound robotic.
- Scoreboard number increments the instant the claim resolves — no waiting for the pulse.
- A chain (going again) shows a small "+1 GO AGAIN" flourish, not a full-screen takeover.

### 12.3 End

✅ **Built at M7** (`src/client/render/shatter.ts`). Measured on a Large board — 144 boxes,
every one claimed — at **1.8 ms median, 3.3 ms p95, 5.4 ms worst frame** against the
16.67 ms budget. Traced end to end on a real finished game: hold silent and still, crack at
600ms, counters climbing 0 → 16/17 → 47/48 → **72/72**, crown, then the result.

Three things about it that are not obvious from the steps below:

- **It runs on a SECOND canvas**, absolutely positioned over the whole `.game` element. A
  piece has to leave `.board-wrap` and land on a DOM scoreboard panel; anything drawn inside
  the board canvas clips at the first edge. This is the M7 revisit §10.1 anticipated. It
  holds no row, so it cannot resize the board (§10.0).
- **Only live owned squares fly.** Ash dissolves quietly and a Wildcard square crumbles
  straight down, because an ash tile banked its point into `harvested` rounds ago (§17) and
  flying it again would overshoot the final score by exactly the number of tiles that ever
  burned. For the same reason **each counter starts at `harvested[p]`, not at zero.**
  `planShatter()` is pure and this is what its tests assert.
- **The server does none of it.** There is no `SETTLING` phase; the room goes straight to
  `results` and the client, which has already replayed to the final state, simply holds its
  own result overlay back until the sequence finishes. Rematch is a unanimous vote, so
  nobody can restart the game out from under someone still watching.

1. **Hold 600ms.** Everything stops. Background dims 20%. Silence.
2. **Crack (250ms):** fracture lines trace along every box boundary, bright then fading.
   Low `crack` sfx.
3. **Flight (≤2.4s):** each claimed box becomes an independent piece. Staggered by distance
   from board centre. Each flies along a quadratic bezier to its owner's score panel,
   scaling to 0.3, rotating ±20°, with a short motion trail.
   - Stagger = `clamp(2400 / boxCount, 8, 30)` ms so total time is bounded regardless of
     board size.
4. **Landing:** each arrival = a `clack`, a 4px panel bump, and **+1 on the counter**.
   Audio ducking caps simultaneous clacks at 4 voices.
5. **Spent boxes** crumble straight down into particles and fade. **Unclaimed boxes**
   dissolve without sound.
6. **Victory (900ms):** winner panel scales to 1.08, a gold ring sweeps around it, confetti
   bursts from the panel edges. `fanfare`.
7. **Rematch** button rises from the bottom. Shows `3/6 ready`. The lobby stays intact —
   the same room code, same players, spectators promoted.

⚠️ **Step 6 happens BEFORE the result overlay, not with it.** The overlay is a full-screen
blurred scrim over the scoreboard, so raising it the instant the last piece lands buries the
crown and the confetti it is supposed to follow. The celebration gets `SHATTER.victoryMs`
(900ms) on the visible scoreboard and the rematch screen arrives after it.

⚠️ **Every path that skips the sequence must still reach the result.** Reduced motion, a
spectator arriving after the last box, and a reconnect mid-flight all resolve straight to
"done" and show the overlay on the tick they always did — verified with `reduceMotion` on,
where the endgame needs no frames drawn at all. An animation must never be the only route to
the screen that says who won.

---

### 12.4 Streak callouts — requested 2026-08-10, BUILT 2026-08-10 (§12.4.1)

A chain is already the most exciting thing that happens in this game and currently it gets
a small "+1 GO AGAIN" flourish (§12.2). The ask is to make a *big* chain an event, the way
Candy Crush's Sugar Crush is: a phrase slamming onto the screen with a voice line behind it.

Tiers, **counting boxes claimed in a single turn**. Wording settled 2026-08-10, `Insanity`
added 2026-08-12 — the ladder climbs on its own, so a muted player still reads the rank from
the word:

| Boxes | Word | Heat |
|---|---|---|
| 4–6 | **Nice** | a warm ember glow behind the word |
| 7–9 | **Blazing** | flames licking the letters from below |
| 10–12 | **Ruthless** | fully alight, embers drifting up |
| 13–15 | **WILDFIRE** | the word burns and the vignette flares with it |
| 16+ | **Insanity** | white-hot and shaking — **and it re-fires on every further box** |

**`Insanity` is the only rung that repeats.** Every other tier fires once, on the way up.
Past sixteen there is no higher word to climb to, so repetition is the only escalation left,
and a turn that just keeps going should keep being celebrated rather than going quiet at
exactly its most absurd. `isTopStreakTier` in `constants.ts` is what makes that one rung
different — not a magic number in the UI.

**Fire is the through-line, and it is already built.** `burn.ts` owns a flame ramp, a
particle pool and a tile-heat gradient (§10.4), all tuned and all measured at 2.6 ms worst
frame. The callouts should draw from that same vocabulary rather than inventing a second
fire — one flame language for the collapsing ring and the streak, so `WILDFIRE` reads as the
board catching the player's mood. Reuse `FIRE.flameRamp` and the existing pool; do not
allocate a new one.

**Voice lines are the owner's to produce** (ElevenLabs), at rising excitement per tier.
That makes them the first *sampled* audio in the project, which §13 deliberately avoided —
so they need a real decision about bundle size, an iOS codec fallback, and whether they are
gated behind the existing mute toggle. They cannot go through `waveforms.ts`.

Two things to settle before building it:

- **The thresholds are guesses and should be checked against real games.** A 4-box chain
  may turn out to be routine on Small, in which case the bottom tier fires constantly and
  stops meaning anything — the same failure the Wildcard nudge was designed around (§10.5).
  `rules.ts` already returns `claimed[]` per move, so the honest way to set these is to log
  chain lengths over a few full games first.

⚠️ Whatever this becomes, it must not block a tap or move a row. The board is mid-turn and
the player is still holding the clock — this is an overlay in the `.board-wrap`, like the
flame badge, never a layout row (§10.0).

### 12.4.1 What was built — 2026-08-10, rebuilt 2026-08-12

`src/client/ui/streak.ts`, `src/client/audio/voice.ts`, and one block in `game.css`. **DOM,
not canvas** — it carries `pointer-events: none` throughout and stays out of the frame
budget (§10.3) completely.

**It lives over the SCOREBOARD** (moved 2026-08-12, owner's call: *"the popup celebration
should show up at the top, over the scoreboard area"*). It used to be centred in
`.board-wrap`, which put a 4rem word squarely over the squares the player was still trying
to tap.

⚠️ **It is anchored to the scoreboard ELEMENT, not to an offset from the top**, and that is
load-bearing rather than tidiness: **hot seat has no header row and the online game does**,
so the scoreboard sits at a different y on each screen and any constant would have been
right on exactly one of them. `createStreak(host)` takes the scoreboard host and centres
itself on it.

⚠️ **Mount it AFTER `createScoreboard`.** That function does `host.innerHTML = ""` on
construction, so a callout created first is deleted on the spot — silently, since nothing
else holds a reference. Hot seat used to build the streak first and had to be reordered.

**One element that climbs, not one slam per tier.** A ten-box turn shows `Nice`, swaps to
`Blazing`, then `Ruthless` as the boxes land. Firing a separate callout per rung would stack
three animations mid-chain, which is noise rather than drama. The exception is `Insanity`,
which re-fires per box by design (§12.4).

**It clears itself after 850ms even while the chain is still running.** The player is
mid-chain against the clock, and a word parked over the scoreboard hides the one number they
are playing against.

#### Four elements, because each owns exactly one animation

The 2026-08-12 report was *"there's no flaming animation"*, and it was correct: the tiers
were **static CSS gradients** clipped to the text. Nothing moved but the 260ms slam. What
moves now:

| Layer | Animates | What it is |
|---|---|---|
| `.streak-flames` | `scale` | Three offset radial tongues rising and guttering behind the word |
| `.streak-word` | `transform` | The slam — overshoot 2.1x and settle |
| `.streak-ink` | `background-position`, `translate` | Fire running THROUGH the letters, plus the Insanity shake |
| `.ember` × n | `translate`, `scale` | 4 → 20 sparks by tier, each with its own drift, delay and duration |

⚠️ **This split is not decoration, it is the reason the fire does not stop.** CSS gives an
element ONE `animation` property. Put the slam and the burn on the same element and the
later rule silently wins — which means the flames die for the 260ms everyone is actually
looking at. The `translate`/`transform` split between ink and word is the same trick one
level down: separate properties compose, one property does not.

⚠️ **The slam scales the WORD, not `.streak`**, which is `inset: 0`. Animating that would
scale a box the size of the host and flash a horizontal scrollbar on every big chain. The
old version clipped itself with `overflow: hidden`; that stopped being possible on a
scoreboard-sized host, so **`.game` carries `overflow: hidden`** instead — a stronger
statement of the same rule, and one no child can defeat by growing.

**The ember scatter comes from per-ember custom properties** set in `streak.ts`, not from
twenty CSS rules. Without them the sparks rise in one rank, in step, which reads as a machine
rather than a fire. Rebuilt on every fire, which is what makes a re-firing `Insanity` throw a
fresh handful each time.

#### The voice

`voice.ts`, added 2026-08-12. **Two backends, one call.** `say(word)` plays a registered
recording if there is one and otherwise falls back to `SpeechSynthesis`, so the owner's
ElevenLabs files drop in through `registerVoiceSample` without `streak.ts` changing at all.

- ⚠️ **The synthesiser is a placeholder and sounds like one** — whatever voice the device
  ships, materially different across iOS, Android and desktop. Judge the timing on it, not
  the delivery.
- It obeys the mute preference through `soundEnabled()` in `engine.ts` rather than reading
  `prefs()` itself, so there is one answer to "is this game making noise". **Verified**: with
  `box.prefs.sound` false and the page reloaded, nothing is spoken and the visual callout
  still plays.
- It **cancels before every line**. `Insanity` re-fires per box, so without that a twenty-box
  turn queues five utterances and is still talking into the next player's turn.
- `silence()` runs on teardown, because `speechSynthesis` belongs to the window and an
  utterance outlives the screen that started it.
- Recordings would be the **first sampled audio in the project**, which §13 avoided
  deliberately. Ship `.mp3` — every target decodes it, and that sidesteps the codec fallback
  that decided §13 in the first place.

**A haul is a TURN, not a line.** It accumulates across the run of continuation moves and
resets when the turn changes hands — tracked in `room.ts` beside the broadcast handler
(so it survives a view rebuild) and in `hotseat.ts`'s `onCommit`.

⚠️ **The thresholds remain unproven, and `Insanity` at 16 is the least proven of all.**
§12.4 asked for real games; two simulated players disagreed too sharply to pick from. A
16-box turn may be something almost nobody ever sees, which is either the point or dead
code — one game will tell you. `STREAK_TIERS` is the one line.

**Testing notes worth keeping.** The debug surface exposes `streak` in DEV
(`window.__box.streak`), because a chain big enough to reach the top takes a whole game to
arrive by playing. Verified 2026-08-12 through it: every rung shows the right word and ember
count, `wordMidY` equals `scoreboardMidY` at all five tiers, 17 and 18 boxes each re-fire
while 7→8 correctly does not, and no tier makes the page scroll sideways.

⚠️ Also: **CSS animations do not advance in a hidden browser pane**, so any measurement taken
mid-animation there reads the frozen first frame — two separate "the word does not fit"
results turned out to be a transform stuck at 2.1x, not a bug. Assert on structure and
computed `animation-name`, never on an animated value.

### 12.5 Hot seat ends its own games, and that is a trap

**Online cannot miss the endgame; hot seat can.** The online screen derives it from the
replayed mirror — `state.phase === "over"` — so every path that reaches the final state
reaches the result screen by construction. Hot seat hand-writes the exit, and on 2026-08-12
a playtest found the branch that had been missed since M7.5: **the shot clock could place
the final line of a match and never call `finish()`**.

What the player saw: a complete board, no result, no rematch button, and no response to any
tap. The interval was still running but its own `if (state.phase === "over") return` guard
short-circuited it forever, and `canAct` refuses input outside `playing`. Both guards were
individually correct. Together they made a frozen game.

⚠️ **Every way a hot-seat game can end needs its own route to `finish()`.** There are two
today — a tap (`onCommit`) and the clock (`autoMoveLine`, plus the `skipTurn` fallback) — and
both `MoveOutcome` and `SkipOutcome` carry `gameOver`, so neither has an excuse. If a third
is ever added, this is the thing it will forget.

## 13. Audio

**Synthesised, not sampled** (revised 2026-08-03 — this section previously specified
`.webm` + `.mp3` files in `public/sfx/`). Seven sounds, none longer than 1.2s, written as
maths in `src/client/audio/waveforms.ts`. That costs no bundle bytes, no request, no decode,
and — the part that actually decided it — no iOS codec fallback. Tuning one is editing a
number rather than opening a DAW.

| Name | Used for | Character | Length |
|---|---|---|---|
| `tick` | Line placed | Filtered noise band — **reverted 2026-08-12**, §13.1 | 45ms |
| `click` | Box claimed | Struck wood, bending down in pitch — **reverted 2026-08-12** | 90ms |
| `thunk` | Play-button lid · Wildcard bought | Mechanical latch: strike, body, catch | 150ms |
| `whoosh` | Board shrink | Noise behind a sweeping cutoff | 400ms |
| `clack` | Endgame piece lands | Tile on tile, harder than `click` | 60ms |
| `blip` | 4s shot-clock warning | Quiet, high, 2ms attack | 50ms |
| `crack` | Endgame board fractures | Low body, a rip, four aftershocks | 250ms |
| `fanfare` | Victory | Triad arriving a note at a time | 1.2s |

**`crack` was added at M7**, because §12.3 step 2 had always named a sound this
table did not contain. Its four aftershocks at 58/104/157/206ms are the fracture
travelling out along the box boundaries — the sound doing what the picture does —
and they have their own test, because they are quiet enough to lose while tuning
the rip on top of them and their absence is invisible in a waveform view.

**`tick` and `click` were recut at M7.5 (2026-08-10) and REVERTED on 2026-08-12.** The
current pair is the original one. See §13.1 — which is now mostly a note about how to run a
taste change, and a caution about what reverting one costs.

`waveforms.ts` is **pure** — a name and a sample rate in, a `Float32Array` out — for the
same reason `rules.ts` is: it makes the part with the interesting logic testable under
`node --test`. 46 tests assert every sound is the length the table says, never clips, is
never silence, renders identically twice, and **starts and ends on an exactly zero sample**.
That last one is not fussiness: a buffer with a non-zero endpoint is a step change in the
speaker, which is an audible click layered on top of the sound you designed, loudest on
precisely the short sharp sounds where it is hardest to diagnose.

⚠️ **Length, clipping and endpoints say nothing about CHARACTER.** An impact and a stroke of
the same length pass every one of those identically, and character is the only thing anyone
has ever complained about. Four tests measured it directly and **went with the revert** on
2026-08-12, because each one asserted a property of the recut specifically — see §13.1.

Relative loudness lives in one table (`SFX_PEAK`) and is asserted by a test:
`blip < tick < click < fanfare`. A sound you hear every three seconds has to sit under one
you hear once a game.

`engine.ts` is the platform half, and obeys three rules:

- **Nothing exists until the first gesture.** A browser makes no sound until the user has
  touched it, and on iOS the context must be *created* inside a real gesture handler, not
  merely resumed from one. `initAudio()` only installs listeners; the context and all seven
  buffers are built in the first `pointerdown`/`keydown`/`touchend` anywhere in the app.
  Buffers are rendered at the context's own sample rate, so playback never resamples.
- **Nothing here may ever throw.** Audio is decoration. A browser missing the API, blocked
  by policy, or out of voices must produce a silent game, never a broken one.
- **Four voices, oldest evicted.** A chain of claims fires faster than the sounds decay, and
  eight overlapping copies of one 90ms click is mush rather than feedback.

Every voice gets ±5% pitch jitter, so a chain of six ticks sounds like a hand placing pieces
instead of a machine. `fanfare` passes `jitter: 0` — it is musical, and a detuned fanfare is
a sour one. The mute preference gates playback at `play()` rather than muting the master
gain, and persists in `box.prefs` (people play this in public).

**One mechanic, one sound.** Buying a Wildcard makes a noise; arming it does not, because
the badge going bright already says so and a second sound would blur what either means.

`clack` and `fanfare` both belong to the endgame and both now fire there: `clack` on every
piece that lands, `fanfare` on the crown. The engine's four-voice cap with oldest-evicted is
exactly the ducking §12.3 asks for, so 144 clacks in two and a half seconds needed no
special handling at the call site.

---

### 13.1 Recutting `tick` and `click`, reverting them, and how to run a taste change

#### ⚠️ REVERTED 2026-08-12 — read this before re-cutting anything

The owner played the recut in a real game and said **"sound isn't good. Revert."** Done:
`git revert` of `c6a1aa3`, which took `waveforms.ts` and its four character tests back to the
pre-2026-08-10 state. **The pair in the game today is the original pair.**

Two things about this that matter more than the sounds:

1. **This restores a pair the previous playtest also rejected**, as *"okay. Not incredible,
   not bad. Which is not good enough."* So the honest reading is not "the old ones were
   right" — it is that the recut was **worse than mediocre**, and mediocre is where we now
   sit. Expect the original complaint to come back. When it does, the method below is the
   thing to reach for, not another single guess.
2. **The four character tests went with it, and had to.** Each asserted a property of the
   recut specifically — that `tick` peaks 4.9ms in, that `click`'s spectral centroid sits
   above 3000Hz. Against the restored sounds they fail by design. Test count went 180 → 176.
   ⚠️ **Do not "fix" those tests to pass the old sounds.** A character test is only worth
   anything if it encodes a decision someone actually made; retro-fitting the thresholds to
   whatever is currently in the file produces a test that can never fail and never informs.

The recut designs are kept below, because they are the most specific description of a taste
target this project has, and because the next attempt should start by knowing what has
already been tried and rejected.

#### What the recut was (2026-08-10 → 2026-08-12)

- **`tick` — graphite on paper.** Sparse impulses, one per fibre giving way, bandpassed into
  short scratches, over a quiet friction hiss that dulls as the stroke travels. 4ms of
  attack, because a drawn line has one and an impact does not. No pitched partial anywhere.
- **`click` — a padlock latch.** A bright wide snap, three inharmonic partials at
  3600/5400/7300 (metal has no common fundamental), a trace of mass at 620Hz, and the
  shackle seating 5ms later. Damped at 5ms: the metal is heard, then caught.

⚠️ **The method matters more than either sound, because the first attempt failed.**

Sound is the one part of this game that cannot be reviewed by reading it, and an agent
writing it cannot hear it either. The first attempt was a single considered guess at each,
shipped to the owner as an A/B page — and both were rejected: *"click and tap both dont
sound good... tick still doesnt sound like paper."* The second attempt offered **three
genuinely different takes on each** and asked for two letters back. That converged
immediately.

The lesson is cheap to state and was expensive to learn: **on a taste question, do not
iterate one guess at a time.** Build the generators parameterised, render a spread, and let
the person who can hear it choose. Cutting three more variants costs almost nothing once the
parameters are arguments.

Two things that made the guessing better between rounds, both of which are measurements
rather than opinions:

1. **`tick`'s first version modulated noise at 110Hz.** That is a slow wobble; paper has
   none. Graphite is hundreds of tiny impacts a second, so grains had to be actual impulses.
2. **`click`'s first version had a sine for a body.** A sine is a tone and a padlock is
   metal. Inharmonic partials, not a fundamental.

**Character WAS tested** — the four below are gone with the revert, and are recorded here so
the next attempt can reinstate the idea rather than the numbers. None of the existing tests
could tell any of these versions apart: an impact and a stroke of the same length pass
length, clipping and endpoint checks identically.

| Test | Guards against | Measured |
|---|---|---|
| `tick` peaks after its attack | reverting to an impact envelope | 4.9ms, must be > 3ms |
| `tick` keeps its grain | losing the impulses | 0.435, must be > 0.32 |
| `click` energy at the front | the body ringing on again | 8.8x, must be > 3x |
| `click` stays metallic | a low sine creeping back as the body | 5156Hz, must be > 3000Hz |

The grain threshold is the one worth understanding. It is the average level change between
neighbouring 1ms windows, which cancels the overall decay and leaves only the tooth. Three
renders: **0.435** shipped, **0.224** the rejected 110Hz version, **0.117** plain filtered
noise. The threshold sits above the rejected one deliberately — a test set at 0.16 would
have passed the sound that failed, which is the entire point of writing it.

---

### 13.2 The announcer — recorded, 2026-08-13

Nine spoken lines, produced by the owner in ElevenLabs. `src/client/audio/voice.ts`.
Files live in `public/sfx/voice/` and **the filenames are the contract** — there is a
`README.md` in that folder listing every one, and dropping a file in is the whole
integration step.

| Key | File | Fires |
|---|---|---|
| `Nice` … `Insanity` | `nice/blazing/ruthless/wildfire/insanity.mp3` | The five streak tiers (§12.4) |
| `start` | `here-we-go.mp3` | The board finishes rolling in |
| `winner` | `heres-your-winner.mp3` | The crown, inside `playFanfare` |
| `draw` | *(not recorded)* | A shared victory |
| `hurry` | `tick-tick.mp3` | 4 seconds left |
| `parked` | `you-there.mp3` | Your second missed turn |

**Synthesis is gone, not kept as a fallback.** The placeholder used the platform's
`SpeechSynthesis` and was rejected on hearing it — correctly, it was a screen reader
shouting. So **a missing recording is silence.** A bad voice is worse than no voice, which
was the entire verdict; nothing substitutes.

These are the **first sampled audio in the project**, which §13 avoided deliberately. `.mp3`
is the format because every target decodes it — which removes the iOS codec fallback that
actually drove the original synthesis decision. The service worker precaches them
(`globPatterns` includes `mp3`), because "Here we go" fires the instant a game starts and a
first-use network fetch would land it in the middle of the opening move.

#### Four things that are load-bearing

1. ⚠️ **Voice does NOT go through `play()`.** §13's four-voice cap with oldest-evicted is
   right for a chain of ticks and wrong for speech — a line cut off halfway by the next
   `clack` is worse than no line. Voice has its own bus.
2. ⚠️ **It ducks the effects.** `duckSfx()` pulls the sfx bus to 32% for exactly the length
   of the line, ramped rather than stepped (a hard gain change on a live bus is an audible
   click — the same artefact the zero-endpoint test guards inside a single sound). Without
   this, "Here's your winner" arrives underneath 144 endgame clacks and is simply not heard.
3. ⚠️ **`hurry` is rationed by a 45s cooldown, and this is not optional.** The 4-second
   warning fires on EVERY slow turn — roughly a hundred times in a twenty-minute game. The
   same two syllables a hundred times is wallpaper, which is the failure §10.5 designed the
   Wildcard nudge around and §10.6 diagnosed in the flame badge. The buzz, amber ring and
   pill still fire every time; only the voice is rationed. `HURRY_COOLDOWN_MS`, one line.
4. ⚠️ **`Insanity` repeats, so it needs more than one take.** It re-fires on every box past
   sixteen (§12.4). `VOICE_FILES` holds an ARRAY per key and rotates, so extra takes are a
   filename each. With one take, a twenty-box turn is the same recording six times in four
   seconds.

**A draw is not a win.** §9.1 makes a tie a shared victory, and "here's your winner" is
wrong for one — so `draw` is its own key. It has no recording yet, and until it does a tie
gets the fanfare and no voice, which is correct rather than merely tolerable.

**Verified 2026-08-13** in the browser against stubbed files: three `Insanity` calls play
three times; two `hurry` calls inside the window play once, and a third after
`resetVoiceState` plays; `draw` is silent rather than falling back to the winner line; muted
plays nothing and unmuted plays once. The trigger sites were checked separately — starting a
hot-seat game requests `here-we-go.mp3`, and climbing the ladder requests each tier in order.

⚠️ **Testing note.** `location.href = origin + '#/...'` does **not** reload the page, so
module state survives and a probe measures the previous run. Two rounds of confusing zeros
came from exactly that. Use `location.reload()` and assert on a sentinel that proves the
reload happened.

---

## 14. PWA — BUILT 2026-08-12

`vite-plugin-pwa` 1.3.0, `registerType: 'autoUpdate'`, `display: standalone`,
`orientation: portrait`, `theme_color: #0B0D12`. Client code is in `src/client/pwa.ts`,
`src/client/ui/offline.ts` and `src/client/ui/installOffer.ts`.

### 14.1 Icons are generated, not drawn

`scripts/make-icons.mjs` (`npm run icons`) renders all four PNGs procedurally from the
**Tiki mark itself** — the warm dot above a rounded stem, whose proportions are the ones in
`.tiki .mk` in `base.css`. Same reasoning as §13's synthesised sounds: the icon is derived
from numbers that already exist, so it cannot drift from the logo on the landing screen, and
retuning it is editing a constant rather than opening an editor. **No new dependency** —
Node's own `zlib` is all a PNG needs, and the encoder is forty lines at the foot of the file.

That shape is also the only idea the icon needs: **a dot and a line is what the game is.**

| File | Size | Notes |
|---|---|---|
| `icon-192.png` | 192 | |
| `icon-512.png` | 512 | |
| `icon-maskable-512.png` | 512 | Mark at 50% not 62% — see below |
| `apple-touch-icon.png` | 180 | iOS reads **none** of the manifest icons; only this link |

⚠️ **Two things that went wrong and would go wrong again.**

1. **A literal transcription of the CSS glow blows the icon out.** `.tiki .mk` stacks
   `0 0 .34em .08em` shadows at 75% and 30%, which is a subtle halo at text size and a
   floodlight at 512px. The first render saturated to a sheet of amber and — the part that
   actually broke it — **the light filled the 0.09em gap between dot and stem**, welding them
   into one blob. The gap is the whole mark; lose it and this is a thermometer, not a dotted
   i. The spreads are now about a third of the CSS ones, and the layers combine as coverage
   (`1-(1-a)(1-b)`) rather than by addition.
2. **The maskable one is smaller on purpose.** Only the central 80% circle of a maskable icon
   is guaranteed to survive a launcher's crop. At the normal 62% the dot's *halo* reaches the
   edge of that zone and a circular mask clips the light off the top.

### 14.2 Offline is not a dead end

The game needs the network — it is a multiplayer Durable Object, and precaching does not
change that. But **hot seat needs no network at all**, so the offline screen offers it. That
turns "come back later" into "play right now, on this phone", using a mode that already
exists and already works. The rules go on the screen too (§14's original ask): someone
staring at an offline screen is the one person with nothing else to read.

⚠️ **The offline screen is COLD-START only, and this boundary is load-bearing.** A socket
dropping mid-match is handled far better by the game screen, which keeps the board up behind
"Reconnecting…" — §7's rule that connection status outranks every other banner. Replacing a
live match with a full-page takeover would discard state the client can still recover and
would fire on every tunnel. `routeNeedsNetwork()` in `pwa.ts` draws the line: `#/hotseat` and
`#/settings` never need it, everything else does, and **only at mount**.

Coming back online re-routes automatically; going offline deliberately does not.

### 14.3 The install prompt

Captured from `beforeinstallprompt`, whose default is suppressed — otherwise Chromium shows
its own infobar, which is precisely the first-load interruption this was meant to avoid.
Offered **after a completed game**, appended below the rematch button, **once per session**.

⚠️ **iOS never fires `beforeinstallprompt` and has no install API at all.** Since this is a
phone game and iPhone is half the players, silence there would mean the feature does not
exist for half of them — so iOS gets a one-line instruction (Share → Add to Home Screen)
instead. **Text, not a button**: a button that cannot do the thing it names is worse than a
sentence explaining how.

### 14.4 Build notes that cost time

⚠️ **This build has TWO Vite environments, and a plugin runs in both by default.** Unscoped,
`VitePWA` wrote a second `manifest.webmanifest` into `dist/box/` — the Worker bundle
directory, where nothing serves it. `clientOnly()` in `vite.config.ts` confines it via
`applyToEnvironment`.

⚠️ **The service worker must never answer for `/api/*` or `/parties/*`.** The first mints and
looks up room codes; the second is the WebSocket upgrade to the Durable Object. A cached room
code is a room that does not exist, and a navigation fallback served over an upgrade request
is a game that cannot start. Both are in `navigateFallbackDenylist`.

⚠️ **`devOptions.enabled` is false.** A precaching SW in front of `vite dev` fights HMR and
caches the dev module graph, which is how you end up debugging a file you already fixed.
**Verify M8 against `npm run build` + `vite preview`** — there is a `box-preview` entry in
`.claude/launch.json` for exactly this. Note that `window.__box` does NOT exist there; the
debug surface is stripped from production (§3), so a probe must compute board geometry from
`computeLayout`'s formula instead.

ℹ️ **`dist/box/.dev.vars` is normal and is not a leak.** The Cloudflare plugin copies it into
the Worker build directory for local preview secrets. It is gitignored, it is **not** in
`dist/client` (the served asset directory), and `GET /.dev.vars` on the live site returns the
SPA fallback HTML with zero occurrences of `OWNER_KEY` — checked 2026-08-12.

### 14.5 What is left in M8

Only the two things that are not code: **a custom domain** (owner's DNS) and **a playtest
with 6 real people**.

---

## 15. Milestones

- [x] **M0 — Toolchain.** ✅ 2026-07-30. Node installed, repo initialised, Vite + TS +
      `@cloudflare/vite-plugin` scaffolded, `GameRoom` Durable Object stub live. Verified:
      `npm run dev` serves the page *and* runs the DO in workerd, and a browser WebSocket
      to `/parties/game-room/scaffold` gets its `welcome` back. Not yet deployed to
      `*.workers.dev` (needs a Cloudflare login).
- [x] **M1 — Rules engine, headless.** ✅ 2026-07-30. `src/shared/{constants,board,rules}.ts`
      complete and pure. 40 tests passing via `node --test`. Covers: line/box index math,
      claiming (including one line claiming two boxes), the chain rule and short
      continuation clock, skip/park/resume, all-parked pause, Wildcard buy/burn/arm/fire,
      win + tie detection, and the score-equals-owned-boxes invariant over full games.
      Shrinking board is deliberately *not* here yet — it lands in M5.
- [x] **M2 — Board renderer.** ✅ 2026-07-30. Canvas stage with DPR cap and on-demand RAF,
      dots/lines/claimed boxes/initials, draw-on and claim-pulse animations, tap + drag +
      confirm-tap input, scoreboard with shot-clock ring, and hot-seat play end to end.
      Verified in-browser: full 2-player game to a correct tie, full 8-player 10×10 board
      filled via confirm-tap, pixel assertions on dot/line/box-fill/initial colours, and
      0.725 ms/frame on a full 10×10 board.
      *The shot clock here is local and throwaway — M3 replaces it with a server deadline.*
- [x] **M3 — Networking.** ✅ 2026-07-30. `GameRoom` Durable Object with hibernation, room
      codes with claim-on-create, landing/lobby/game screens, hash routing so an invite link
      is just a URL, authoritative turn loop, and the shot clock on a DO alarm.
      Verified with two independent browser tabs and with raw dual-socket protocol tests:
      out-of-turn moves rejected, non-host start rejected, moves broadcast to both, the
      6s continuation clock arriving over the wire, timeout → skip → park → pause, `wake`
      un-parking and resuming, and reconnect restoring the same seat with the full board.
      *Spectators, rematch voting, and disconnect-grace benching are M4.*
- [x] **M4 — Resilience.** ✅ 2026-07-30. Spectators for late joiners, disconnect-grace
      parking on a multiplexed alarm, rematch as a unanimous vote with spectator promotion,
      and animation reset on resync.
      Verified: a late joiner spectates with the full board and cannot move; reconnecting
      inside the grace window keeps the seat unparked; staying away past it parks you via
      the grace path (proved by `missed < 2` while benched, which only `bench()` can
      produce); one rematch vote holds, both release; a spectator is promoted with a fresh
      colour and the grid resizes for the new roster. **Killed the server mid-game**: both
      clients showed "Reconnecting…", kept their boards, and recovered with state intact —
      the room survived in DO storage and the alarm re-armed itself.
- [x] **M5 — Twist mode.** ✅ 2026-07-31. Shrinking board with its warning ring, mode
      selector in the lobby and hot seat, and the Wildcard shop end to end.
      18 new tests. Verified in-browser: a full 4-player twist game where the warning
      pulsed with **zero boxes dead**, the collapse removed exactly the 28-tile perimeter
      and cleared 33 orphaned lines, and the score invariant held to the final frame
      (`[6,12,14,14]` = onBoard `[6,12,6,12]` + harvested `[0,0,8,2]`). Over the network:
      buy burned 10 boxes and dropped the score 10→0, arm spent the charge, and a
      non-claiming line fired it — turn kept, **12.3s** on the clock rather than the 6s
      continuation.
      *The collapse is instant, not animated — tiles flying to the scoreboard shares code
      with the endgame shatter and lands in M7.*
- [ ] **M6 — Polish pass 1.** Play button + carpet-in, audio, full visual token pass.
      *Visual direction is being explored separately — see `DESIGN-BRIEF.md`. Audio does
      not depend on that and is the highest-value item left; do it first.*
      - [x] Game-screen header: back, "Now playing · name", room code (2026-07-31)
      - [x] Board-size presets in the lobby, with length estimates (2026-07-31)
      - [x] Fixed-height rows — killed the 39 px board jump on every move (2026-07-31)
      - [x] Powerup row always visible in twist, greyed when unusable (2026-07-31)
      - [x] Leave button + Android hardware back (2026-07-31)
      - [x] Collapse countdown — two rounds of notice instead of one (2026-07-31)
      - [x] Public ✦ Wildcard badge on every player's avatar (2026-07-31)
      - [x] Initials derived from names, with collision fallback (2026-07-31)
      - [x] Name remembered on the device, with a change option (2026-07-31)
      - [x] Owner device always hosts, via a Worker secret (2026-07-31)
      - [x] Archivo self-hosted, full colour token pass, warm lamp + grain (2026-08-02)
      - [x] Renamed to **Tiki**, with the dotted-i logo mark that assembles on load (2026-08-02)
      - [x] Board painting values from the design pass — dot/line/square fractions,
            finger-lit ghost, ash tiles, dead dots that stay put (2026-08-02)
      - [x] Board presets 8/10/12/14, Grand gated on 4 players, shrink floor at 6 (2026-08-02)
      - [x] Landing without a name field, Settings screen, no ready button,
            YOU tags, grow-together initials (2026-08-02)
      - [x] Audio: tick, click, thunk, whoosh, clack, blip, fanfare — synthesised,
            not sampled, 36 tests (2026-08-03)
      - [x] The Twist burn — fuse, ignition, spreading front, flame, ash, vignette
            (2026-08-03). Fixed a latent crash on the way: a square claimed by the
            same move that collapsed its ring pulsed as `players[DEAD]`.
      - [x] Start sequence: the mark draws, flares, hits, shakes, and the board
            rolls in row by row (2026-08-03). The hinged-lid Play button was
            superseded by the design pass — see §12.1.
      - [x] Visual token pass across every screen — landed with the design pass
            above; this line was a duplicate of it.
- [x] **M6 remainder — playtested 2026-08-10.** Twice, on the deployed build, on real
      phones. Pacing and interface came back fine; the burn at 2.9s and the shatter at 4.7s
      both survived contact and can stop being tuned for length. The sound did NOT survive
      and was recut at M7.5 (§13.1). Everything else it turned up became M7.5 below.
- [x] **M7 — Endgame sequence.** ✅ 2026-08-10. Crack, flight, clacks, count-up, victory.
      A second full-screen canvas (`render/shatter.ts`), an eighth sound (`crack`), and
      `planShatter()` split out pure with 6 tests — including the one that matters, that a
      count-up from `harvested[p]` lands on exactly `scores[p]` in a twist game that really
      collapsed. `fanfare` moved off the overlay and onto the crown, as this line asked.
      Verified against four complete games driven over real sockets: hold, crack at 600ms,
      counters climbing to the true final score, crown, then the result — plus the
      reduced-motion path, which reaches the result with no frames drawn at all.
      **1.8 ms median / 5.4 ms worst frame** on a full 12×12. No console errors.
      **Watched by a human 2026-08-10** — the pacing came back fine, which is what retired
      the "nobody has seen 144 squares fly" warning this line used to carry.
- [ ] **M7.5 — what the 2026-08-10 playtests asked for.** Ordered by how much it matters,
      not by effort. The first two are correctness; everything after is feel.
      **Six of the nine are done and deployed** (1, 2, 4, 5, 8, 9 — 9 minus its voice
      lines). **Everything still open is the Wildcard, and it is one decision, not three:**
      item 3's remaining half, item 6, and item 7 which depends on 6. See item 3 for why the
      redesign as written fixes the wrong half of the problem.
      1. ✅ **BUILT 2026-08-10 — the timeout places a line.** `penaltyFor` and `autoMoveLine`
         in `rules.ts`, called from `onAlarm()` and from hot seat's local clock. Both of the
         silent failures are covered by name in `rules.test.ts`: it broadcasts as a `move`
         with `auto: true`, and an auto-move CHARGES a miss rather than clearing it, so
         parking still works. Watched working in the browser, in hot seat and in a real
         two-player room: lines appear on the clock, the miss counter climbs, and the second
         miss parks the player on every client. `PROTOCOL_VERSION` is 4.
      2. ✅ **BUILT 2026-08-10 — the endgame clock doubles past 60%.** Past
         `ENDGAME_CLOCK_FRACTION` the clock DOUBLES rather than stopping — the owner took
         the §6.3.2 recommendation on 2026-08-10. `clockFraction` in `room.ts` had 12 and 6
         hardcoded and was fixed to ask `turnSecondsFor`, or the ring would have sat pinned
         at full for half of every endgame turn.
         🅿️ **The host's clock off-switch is PARKED** — owner's call, 2026-08-10: sit a few
         games on the doubled clock first and find out whether an off switch is even wanted.
         See §16 #6. Do not build it on spec.
      3. 🟡 **Twist's two mechanics — diagnosed, half fixed.** ✅ **The collapse warning is
         fixed:** `hidden` was not hiding the flame badge, so it was on screen from the
         first frame of every game and stayed frozen on a red "burns next round" after the
         last possible collapse. A warning that is always on is not a warning. One rule in
         `base.css` fixes it and the whole class of bug with it — **§10.6 is the writeup,
         and it is worth reading before you touch any component that hides itself.**
         🔴 **Still open: the Wildcard.** Not a bug — the row and the nudge work. The
         problem is that ten boxes cannot be banked until turn ~93 of 132, so the button is
         honestly dead for most of the game. Judge it in a playtest, then see item 6.
      4. ✅ **BUILT 2026-08-10 — confirm-tap is now Large and Grand only.** The complaint came
         from Medium, where the cells are still big enough to hit accurately, so the
         insurance cost more than the mistakes it prevented. `CONFIRM_TAP_FROM_GRID` is 12.
         ✅ **Deployed 2026-08-10** alongside items 1 and 2, which is what it was held back
         for. The live site no longer double-taps on Medium.
      5. ✅ **BUILT 2026-08-10 — `tick` and `click` recut.** Graphite-on-paper and a padlock
         latch, chosen by the owner from three candidates each. §13.1 has both designs and,
         more usefully, the method: a single considered guess at each was rejected outright,
         a spread of three converged first time. Character is now tested — the old tests
         could not tell any of the versions apart.
      6. 🔴 **NOT BUILT — blocked on a decision, not on effort.** Redesign the Wildcard as
         one glowing wand. Collapses buy-and-arm into a single
         tap, with the ten squares' glow absorbed into the wand. Keep `wildcardCostPreview`
         as the single source of which ten. See the log.
      7. 🔴 **NOT BUILT — depends on 6.** Hiding the score removes the only signal that you
         can afford a Wildcard, and the glowing wand is what takes that job over, so these
         ship together and 6 goes first. Hide the running score, reveal it in the shatter.
         Puff the name icon on a claim
         instead. Makes M7's count-up the payoff it was built to be. See the log.
      8. ✅ **BUILT 2026-08-10 — board size in hot seat.** The same
         Small/Medium/Large/Grand chips as the lobby, gated by the same
         `presetAllowed` so there is one rule and not two. 0 means "whatever suits this
         many players", exactly as `room.config.gridSize` does. ⚠️ The case worth keeping:
         **picking Grand with four players and then dropping to two gives the size back** —
         otherwise Play starts a board the table is not allowed to choose. The online lobby
         re-checks the same thing on Start, for the same reason.
      9. ✅ **BUILT 2026-08-10, rebuilt 2026-08-12 — streak callouts, with a voice.** The
         word slams in and climbs its own ladder as the chain grows. The 2026-08-12 pass
         moved it **over the scoreboard**, gave it **actual moving fire** (a flame sheet, a
         gradient running through the letters, and embers — it was static gradients before),
         added **Insanity at 16** which re-fires on every further box, and added a voice via
         `voice.ts`. ⚠️ **The thresholds are still guesses** and `Insanity` is the least
         proven of them — simulation could not settle it (see `STREAK_TIERS`), so they need
         your eyes. The voice is **speech synthesis as a placeholder**; your ElevenLabs
         recordings drop in through `registerVoiceSample` with no other change.
      10. ✅ **BUILT 2026-08-12 — the Twist HUD reaches hot seat.** The flame badge and shop
         row were online-only, so single-player Twist had no collapse warning and no
         Wildcard. Extracted to `twistHud.ts` and mounted by both screens rather than
         copied — see §10.5 for why copying was the wrong shape.
      11. ✅ **BUILT 2026-08-12 — the hot-seat endgame freeze.** A shot clock placing the
         final line left a finished board with no result screen and no input. §12.5, which
         also explains why the online screen could never have hit it.
- [ ] **M8 — PWA + ship.** 🟡 **Built 2026-08-12 except the two non-code items.** §14 is
      both the spec and the writeup.

      1. ✅ **Icons.** Generated, not drawn: `npm run icons` renders all four PNGs from the
         Tiki mark's own proportions, with no new dependency. §14.1 — including the two
         ways the first attempt was wrong.
      2. ✅ **Manifest + service worker.** `vite-plugin-pwa` 1.3.0, `autoUpdate`, scoped to
         the client environment so it stops writing into the Worker bundle. §14.4.
      3. ✅ **Precache + offline screen.** 10 assets precached; the offline screen carries
         the rules and offers hot seat, which genuinely works with no network. Cold-start
         only — a live match keeps its board behind "Reconnecting…". §14.2.
      4. ✅ **Install prompt after a completed game.** Once per session, below the rematch
         button, with an iOS instruction where there is no API. §14.3.
      5. 🔴 **Custom domain** — owner's DNS. Not code.
      6. 🔴 **Playtest with 6 real people.** Not code.

**Do M1 before M2.** A pure, tested rules engine makes M3 nearly mechanical; skipping it
means debugging game logic and network logic simultaneously, which is miserable.

---

## 16. Open questions

2. **Room code length** — 4 chars is friendlier to type; collision risk is fine at this
   scale with retry-on-collision. Confirm at M3.
3. **Wildcard price** (§9.3) — 🔴 **now the blocking question for M7.5 items 3, 6 and 7.**
   10 was chosen as deliberately steep and untested. It is measurably out of reach:
   ten boxes cannot be banked until roughly **turn 93 of 132** on a 2-player Small board, or
   **165 of 180** with six players on Medium, because in Dots and Boxes every box arrives at
   the end. So the wand is a grey stick for ~70% of the game.

   The requested redesign (one glowing wand, §10.5) fixes *clunky*. It does not fix *never
   saw it*, because the thing is simply unreachable for most of a match. **Decide the
   economics first, then build the wand** — or build the wand knowing it will draw the same
   complaint again. `WILDCARD_COST` in `constants.ts` is the one value; nothing else moves.

   Also open, and cheaper to answer: are the streak tiers right? (§12.4.1, `STREAK_TIERS`.)
   Simulation could not settle them and both measurements are recorded there. **`Insanity` at
   16 joined the ladder on 2026-08-12 and is the least proven rung of all** — it may be
   something no game ever reaches, which is either the point or dead code.

7. **Does the reverted `tick`/`click` pair actually satisfy?** 🔴 **New 2026-08-12.** The
   recut was reverted on the owner's instruction, which puts back a pair an earlier playtest
   called *"okay. Not incredible, not bad. Which is not good enough."* Both pairs have now
   been rejected by someone who heard them in a real game. If the complaint returns, do
   **not** guess a third time — §13.1's method (parameterise the generators, render a spread
   of three or four, let the person who can hear it pick) is the only approach that has ever
   converged here.
4. **Watch-to-play ratio.** With 8 players on a 10×10 board you act for ~3 minutes and watch
   for ~19. The shot clock and the shrinking board are the mitigations; whether they're
   enough is a playtest question, not a design one. If they aren't, the earliest lever is
   dropping the shrink-arm threshold further (§9.2) before touching turn structure.

5. ~~**Why can nobody find Twist's two mechanics?**~~ **ANSWERED 2026-08-10 — see §10.6.**
   Neither hypothesis was right. The room *was* in Twist and the elements *did* render; the
   collapse warning was rendering **all the time**, including when there was nothing to
   warn about, because `hidden` was not hiding it. Fixed. The Wildcard half is still open —
   it is a discoverability question, not a bug, and it now needs a playtest to judge.

6. **Does the clock need a host off-switch at all?** 🅿️ **PARKED 2026-08-10, owner's call.**
   The doubled endgame clock (§6.3.2) was built to answer the request the off-switch came
   from — "endgame moves deserve thought" — so the off-switch may now be solving a problem
   that no longer exists. The owner is sitting a few games on the doubled clock before
   deciding.

   What to watch for while playing, since it is what decides this:
   - Does 24s in the endgame feel like enough, or is anyone still rushed?
   - Does it feel like *too* much — long silences waiting for someone to move?
   - Does anyone reach for a clock they cannot turn off?

   If the answer is "the doubled clock is fine", this question closes and no code is
   written. If it does come back, build it as a room config flag alongside `mode` and
   `gridSize` — but know what it costs: a no-timer room is a room where one player can stall
   indefinitely, which is the problem the shot clock exists to solve (§6.3), and the §6.3.1
   auto-move cannot fire without a deadline to fire on.

### Resolved

- ~~Is the shatter too long? Is the burn too long?~~ → **No, both are fine.** "The wait is
  alright and so is the interface" (2026-08-10). Stop tuning `SHATTER` and `BURN` for
  length; the numbers in them are settled.

- ~~Name~~ → **Tiki**, title case, because the mark depends on a dotted lowercase i. (§1 of
  the design handover.)
- ~~Shop items~~ → **Wildcard only, 10 pts, one extra line.** Eraser cut as too swingy. (§9.3)
- ~~5s shot clock~~ → **12s normal, 6s continuation**, warning at 4s remaining. (§6.2, §12.2)
- ~~iOS has no vibration~~ → **acceptable; small non-intrusive pill above the board.** (§12.2)
- ~~Two missed turns~~ → **parked/benched until they tap back in.** (§6.3)
- ~~Score-as-currency~~ → **buying burns 10 of your boxes**, keeping score and visible
  ownership identical. (§9.3, §17)

---

## 17. Invariants (violate these and things break subtly)

- `rules.ts` imports nothing and touches no I/O.
- The client never mutates game state except to draw a **pending** line.
- `scores[p] === (boxes on the board owned by p) + harvested[p]` at all times. The shop
  burns real boxes rather than just decrementing a counter, and a shrink that harvests a
  claimed tile records it in `harvested` — because that tile already flew to the scoreboard
  and must not fly again in the endgame. Asserted after every move of a full twist game.
- A cleared line reads as `lines[id] === 0`, exactly like an untouched one. After a collapse
  that is **not** the same as "playable" — `canPlace` also requires a live neighbouring box.
  Never treat `lines[id] === 0` alone as a legal move.
- Timers are broadcast as absolute deadlines, never durations.
- Every device-capability call is feature-detected. `navigator.vibrate` is absent on iOS.
- **Nothing may depend on a secure context.** LAN playtesting runs over plain `http://` to
  an IP address, where `crypto.randomUUID`, `crypto.subtle` and `navigator.clipboard` are
  all `undefined` — while `localhost` and the deployed HTTPS build have them, so this class
  of bug never shows up in dev. `crypto.getRandomValues` is fine. (Cost an hour at M5.)
- Screen mounting is wrapped in try/catch. A throw used to leave the previous screen on
  display, which is indistinguishable from the app hanging.
- Every message carries a sequence number; the client discards out-of-order/duplicate moves.
- Animations never gate state transitions.
- Players are **never** removed from a room mid-match. Benched, never kicked.
