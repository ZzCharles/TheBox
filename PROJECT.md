# BOX — Project Brief & Architecture

> **Working title:** BOX (rename pending — see Open Questions)
> **What:** Mobile-first PWA. Real-time multiplayer Dots and Boxes for 2–8 players, with a "Twist mode."
> **Status:** M0–M5 complete — the game is feature-complete. **Next: M6 — polish.**
> **Last updated:** 2026-07-31

---

## 0. How to use this file

This is the single source of truth for a new chat. Read sections 1–4 to get oriented,
then jump to whatever milestone is marked `IN PROGRESS` in §15.

When something is decided, move it out of §16 (Open Questions) and into the body.
When a milestone completes, tick it in §15 and update `Last updated` above.

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

**Total dependencies: `partyserver`, `vite`, `@cloudflare/vite-plugin`, `vite-plugin-pwa`, `typescript`, `wrangler`.** That's it.

### 2.1 Rejected, and why (so we don't re-litigate)

- **Socket.IO on a VPS** — works, but you pay for an always-on box and hand-roll room lifecycle, sticky sessions, and timers that DOs give free.
- **Firebase** — no authoritative server means turn order, the shot clock, and shop economics all leak into clients. Cheatable, and animations desync.
- **React** — the board is imperative canvas anyway; React would only own ~5 screens.
- **SVG/DOM board** — see rendering note above.

---

## 3. Prerequisites & commands

- ✅ **Node v24.18.0** at `C:\Program Files\nodejs\` (installed 2026-07-30).
- ✅ `git init` done, branch `main`.
- [ ] Free Cloudflare account, for `wrangler login` and deploy. Local dev works without it.

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
npm run types    # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run deploy   # build + wrangler deploy
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
├─ vite.config.ts
├─ wrangler.jsonc              ← Worker + DO bindings + static assets
├─ index.html
├─ public/
│  ├─ icons/                   ← 192/512 + maskable
│  └─ sfx/                     ← tick, click, clack, thunk, whoosh, fanfare
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
      ├─ net/
      │  ├─ socket.ts          ← connect, backoff reconnect, clock sync
      │  └─ store.ts           ← applies server events → local mirror + subscriptions
      ├─ render/
      │  ├─ stage.ts           ← canvas setup, DPR, resize, RAF loop
      │  ├─ boardLayer.ts      ← dots, lines, claimed boxes (dirty-flag redraw)
      │  ├─ fxLayer.ts         ← every-frame: pending line, pulses, particles, shatter
      │  ├─ tween.ts           ← ~60 lines: easing + timeline
      │  └─ particles.ts
      ├─ input/
      │  └─ pointer.ts         ← tap-nearest-line + drag-from-dot, hit tolerance
      ├─ ui/
      │  ├─ router.ts
      │  ├─ screens/           ← landing, lobby, game, results
      │  └─ components/        ← scoreboard, shotclock, shop, toast, playButton
      ├─ audio/
      │  ├─ engine.ts          ← unlock on first gesture, pool, ducking
      │  └─ sfx.ts
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

- `LOBBY` — players join/leave/ready. Host configures mode, player cap, grid size, clock.
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

`ctx.storage.setAlarm(deadlineMs)`. On `alarm()`, the server force-skips the current
player and advances. This is the single most important reason to use Durable Objects —
you get an authoritative timer without an always-on process.

`turnDeadline` is broadcast as an **absolute epoch ms**. Clients estimate clock offset at
join (3 ping round-trips, take the median) and render the countdown against corrected
local time. Never send "you have 12 seconds" — send "the deadline is T". The 8s warning is
derived client-side from the deadline; the server does not send a second message for it.

Deadline = `moveResolvedAt + turnSeconds + ANIMATION_GRACE(350ms)`.

`TURN_SECONDS = 12`, `CONTINUATION_TURN_SECONDS = 6`, both room config values, so presets
are free if we want them later.

### 6.4 AFK / benching

| Trigger | Result |
|---|---|
| **Miss 2 consecutive shot clocks** | `benched` ("parked") |
| WebSocket drops, no reconnect within 12s | `benched` |
| Any input from a benched player | un-benched, active from the *next* rotation |

The miss counter resets to 0 on any successful move, so an occasional slow turn never
parks anyone — it takes two in a row.

Benched players: skipped in turn order, greyed in the scoreboard with a "TAP TO RETURN"
affordance, **keep their score and their shop inventory**, and are never removed from the
room. If everyone is benched, the match pauses (clock stops) rather than ending.

### 6.5 Spectators

Anyone joining after `COUNTDOWN` starts. They receive full state and all events, render
the board read-only, and are queued for the next rematch. Cap spectators at 20.

---

## 7. Wire protocol (`src/shared/protocol.ts`)

JSON over WebSocket. Every message is `{ t: string, ...payload }`. Include
`PROTOCOL_VERSION`; on mismatch the client shows "refresh to update."

### Client → Server

| `t` | Payload | Notes |
|---|---|---|
| `hello` | `clientId, name, resumeToken?` | `clientId` persisted in localStorage |
| `ready` | `ready: boolean` | lobby only |
| `configure` | `mode, maxPlayers, gridSize?, turnSeconds` | host only |
| `start` | — | host only |
| `move` | `lineId, turnSeq` | `turnSeq` makes it idempotent |
| `buyWildcard` | — | twist mode, own turn, pre-move |
| `armWildcard` | — | spends a charge; next `move` won't end the turn |
| `rematch` | `ready: boolean` | |
| `ping` | `t0` | clock sync |

### Server → Client

| `t` | Payload |
|---|---|
| `welcome` | `you, room, snapshot, protocolVersion` |
| `roomUpdate` | `players[], spectators[], config, phase` |
| `gameStart` | `gridSize, mode, turnOrder[], firstPlayerId, turnDeadline` |
| `moveApplied` | `lineId, playerId, claimedBoxIds[], scores, nextPlayerId, turnDeadline, turnSeq` |
| `turnSkipped` | `playerId, reason, nextPlayerId, turnDeadline` |
| `benchChanged` | `playerId, benched: boolean` |
| `wildcardBought` | `playerId, cost, burnedBoxIds[], charges, scores` |
| `wildcardArmed` | `playerId, charges` |
| `shrinkWarning` | `doomedBoxIds[], collapsesAtTurn` |
| `shrinkApplied` | `removedBoxIds[], removedLineIds[], harvested[], newBounds` |
| `gameOver` | `finalScores[], winnerId, boxOwners[], spentBoxIds[]` |
| `rematchState` | `readyIds[], promotedSpectators[]` |
| `error` | `code, message` |

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

### 8.1 Grid sizing by player count

**A game is `2n(n+1)` moves long — lines, not boxes, set the clock.** At a 12s cap the real
average move takes ~6s including deliberation and animation, so the grid is sized to land a
full game in 15–20 minutes.

| Players | Grid | Boxes | Lines | Est. length | Boxes/player |
|---|---|---|---|---|---|
| 2 | 8×8 | 64 | 144 | ~14 min | 32 |
| 3 | 8×8 | 64 | 144 | ~14 min | 21 |
| 4 | 8×8 | 64 | 144 | ~14 min | 16 |
| 5 | 9×9 | 81 | 180 | ~18 min | 16 |
| 6 | 9×9 | 81 | 180 | ~18 min | 13 |
| 7 | 10×10 | 100 | 220 | ~22 min | 14 |
| 8 | 10×10 | 100 | 220 | ~22 min | 12 |

Formula: `gridSize = clamp(round(sqrt(players * 7 + 42)), 8, 10)`. Host may override up to
12×12, with a "this will run ~30 min" warning in the lobby.

**Why the cap dropped from 12×12 to 10×10:** moving 5s → 12s more than doubles wall-clock
time per move. The grid has to shrink to compensate, or an 8-player game runs half an hour.
Smaller cells were never the constraint — 10×10 also gives noticeably better tap targets.

**More players should not mean a much bigger board.** Eight people on a 10×10 board is
*more* contested and more interesting, not cramped. Growing the grid to preserve
"boxes per player" mostly just adds waiting.

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
- **One full rotation of warning.** Doomed boxes pulse red; their border dots flicker.
  This is non-negotiable for fairness — never collapse without warning.
- On collapse:
  - Boxes in the ring **already claimed** → owner keeps the point. The tile detaches and
    flies to their scoreboard immediately (a preview of the endgame animation, reused code).
  - Boxes in the ring **unclaimed** → destroyed. Worth nothing to anyone.
  - Lines belonging only to the ring are removed. The board visually contracts and
    re-centres over ~500ms with a `whoosh`.
- The game ends when the current playable area is fully claimed, **or** when the board
  shrinks below 2×2 — whichever comes first. Sudden death guarantees termination.

This is the pressure valve for large lobbies: it punishes hoarding safe edge boxes and
forces the fight into the centre.

### 9.3 Twist mode — the Wildcard

One item, one effect. *(An Eraser was considered and cut — deleting an opponent's line was
too swingy, and it made every claimed box feel provisional.)*

- **Cost: 10 points. Effect: place one extra line this turn.**
- Buy only on your own turn, before placing. Requires score ≥ 10.
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

**On the price.** 10 points is deliberately steep: average score in a 6-player, 81-box game
is ~13, so buying is over half your holdings. That makes it a bad early-game move and a
potentially decisive late-game one — in the endgame, dodging a forced chain sacrifice is
worth far more than 10 boxes. That asymmetry is good design, not a bug. Keep the price as
`WILDCARD_COST` in `constants.ts` so playtesting can tune it in one line.

---

## 10. Client rendering

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

**M7 revisit:** the shatter needs per-box tiles moving independently. Add a second canvas
*then*, if measurement says to — the stage abstraction already supports it.

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
  a misplaced line is far more painful than a slow turn. Player-overridable in settings.
- `touch-action: none` on the canvas. Handle `pointerdown/move/up`, not touch events.

### 10.3 Animation budget

Target 60fps. Hard rule: **no allocation inside the RAF loop.** Particles come from a
preallocated pool. Tweens are structs in a flat array, not closures.

| Event | Duration | Notes |
|---|---|---|
| Line placement | 140ms | Draw-on from origin dot, ease-out. `tick` sfx at 0ms. |
| Box claim pulse | 260ms | Scale 0.85→1.06→1.0, fill fades in, then initial. `click` at 0ms. |
| Turn handoff | 180ms | Active player panel glow crossfade. |
| Shrink warning | 1 rotation | 900ms red pulse loop on doomed tiles. |
| Shrink collapse | 500ms | Tiles burn away, board re-centres. `whoosh`. |
| Endgame shatter | ≤3.5s total | See §12.3. Stagger scales down as box count rises. |

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
- **Spent (burned) box:** `#2A3040` flat, no glow, initial removed.
- **Elevation:** soft shadows only, never hard. `0 8px 32px rgba(0,0,0,0.5)`.
- **Type:** one variable font. Tabular numerals on the scoreboard (non-negotiable — the
  count-up animation jitters otherwise).
- **Motion:** honour `prefers-reduced-motion` — keep state changes, drop shatter/particles
  in favour of a fast crossfade.

---

## 12. The three set-piece sequences

### 12.1 Start

1. **Play button** is an open rectangular box drawn in CSS 3D — a base plus a lid on a
   hinge at the back edge, rotated open ~105°.
2. Tap → lid rotates closed over **220ms** with a slight overshoot-and-settle
   (`cubic-bezier(.36,1.6,.5,1)`). `thunk` sfx fires on contact, not on tap.
3. **Screen shake:** 6px amplitude, 180ms, decaying, on the root element.
4. Box scales to 1.15 and fades out over 200ms.
5. **Carpet-in:** dot rows roll in from the top. Row `r` starts at `r × 35ms`, translating
   from `-40px` with a small bounce, opacity 0→1, glow ramping in behind it. A 10-row board
   fully lands in ~700ms.
6. Grid lines *do not* draw — only dots. The empty board should feel like an invitation.

**This sequence is also where Web Audio gets unlocked** (first user gesture). Convenient
and non-negotiable on iOS.

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

---

## 13. Audio

Six sounds, all short, all in `public/sfx/` as `.webm` + `.mp3` fallback (iOS).

| Name | Used for | Character |
|---|---|---|
| `tick` | Line placed | Crisp, dry, ~40ms |
| `click` | Box claimed | Fuller, woody, ~90ms |
| `thunk` | Play button lid | Mechanical latch, ~150ms |
| `whoosh` | Board shrink | Low sweep, ~400ms |
| `clack` | Endgame piece lands | Sharp, tile-on-tile, ~60ms |
| `blip` | 8s shot-clock warning | Quiet, high, ~50ms |
| `fanfare` | Victory | ~1.2s |

Engine rules: decode once into `AudioBuffer`s at boot. Pool of `AudioBufferSourceNode`s.
Global gain node for a mute toggle (**persist the mute preference** — people play this in
public). Duck to 4 concurrent voices max.

---

## 14. PWA

- `vite-plugin-pwa`, `registerType: 'autoUpdate'`.
- `display: standalone`, `orientation: portrait`, `theme_color: #0B0D12`.
- Icons: 192, 512, plus a maskable 512. iOS needs `apple-touch-icon` and
  `apple-mobile-web-app-capable`.
- **Precache the app shell** (JS/CSS/fonts/sfx/icons). The game needs a network connection,
  so offline shows a branded "you're offline" screen with the rules — not a browser error.
- Add-to-home-screen prompt: show it *after* a completed game, never on first load.

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
- [ ] **M6 — Polish pass 1.** Play button + carpet-in, line/claim animations, audio,
      scoreboard, shot clock ring, full visual token pass.
- [ ] **M7 — Endgame sequence.** Crack, flight, clacks, count-up, victory.
- [ ] **M8 — PWA + ship.** Manifest, service worker, icons, offline shell, custom domain.
      **Playtest with 6 real people.**

**Do M1 before M2.** A pure, tested rules engine makes M3 nearly mechanical; skipping it
means debugging game logic and network logic simultaneously, which is miserable.

---

## 16. Open questions

1. **Name.** "BOX" is a placeholder.
2. **Room code length** — 4 chars is friendlier to type; collision risk is fine at this
   scale with retry-on-collision. Confirm at M3.
3. **Wildcard price** (§9.3) — 10 is deliberately steep and probably right, but it's a
   `constants.ts` value. Revisit after the first 6-player playtest.
4. **Watch-to-play ratio.** With 8 players on a 10×10 board you act for ~3 minutes and watch
   for ~19. The shot clock and the shrinking board are the mitigations; whether they're
   enough is a playtest question, not a design one. If they aren't, the earliest lever is
   dropping the shrink-arm threshold further (§9.2) before touching turn structure.

### Resolved

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
