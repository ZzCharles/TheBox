# Tiki — Project Brief & Architecture

> **Name:** **Tiki** (was BOX; renamed 2026-08-02).
> **What:** Mobile-first PWA. Real-time multiplayer Dots and Boxes for 2–8 players, with a "Twist mode."
> **Status:** M0–M7 complete bar a playtest. M8 (PWA + ship) is next.
> Everything M6 and M7 promised is built: visuals, audio, the Twist burn, the start
> sequence, and the endgame shatter.
> **Last updated:** 2026-08-10

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

## 0.1 START HERE — handoff, 2026-08-10

**The game is feature-complete through M7 and has never been seen working by a human being
end to end.** Everything below was verified by instrumentation, not by eyes. That is the
single most important thing to know before you change anything. The debt has grown, not
shrunk: there are now two set-piece animations nobody has watched.

### The next step, in one line

**Playtest on real phones.** It is now two milestones overdue, and it is the only item on
this list that has ever changed a design decision.

### Roadmap

| | State | What it means |
|---|---|---|
| M0–M5 | ✅ | Toolchain, rules engine, renderer, networking, resilience, Twist mode. |
| M6 | ✅ **bar a playtest** | Visuals, audio, the Twist burn, the start sequence. All built. None watched. |
| M7 | ✅ **bar a playtest** | Endgame shatter: crack, every box flies to its owner's panel, count-up, crown. Traced frame by frame on four real games; seen by nobody. §12.3. |
| **M8** | ⬅ **next code** | PWA: manifest, service worker, icons, offline shell, custom domain. Then ship. |

Smaller things worth doing whenever they suit:

- **Sound needs tuning.** Verdict from the playtest was "isn't satisfying", and nobody has
  judged it since. Turn `SFX_SECONDS` / `SFX_PEAK` in `waveforms.ts`; nothing else.
- **The burn is 2.9s.** Nobody has yet watched it while waiting for their turn. `BURN` in
  `burn.ts` is the one table.
- **The shatter is ~4.7s from last box to rematch screen**, of which 900ms is the crown
  sitting on the scoreboard before the result covers it. Nobody has yet waited through it.
  `SHATTER` in `shatter.ts` is the one table.
- ~~The live site is stale~~ — **redeployed 2026-08-10 with M7**. Verified on production:
  the served bundle is `index-Cd9gbj-9.js` and contains the shatter and the `crack` sound,
  and a room was created and looked back up, so the Worker and the Durable Object are both
  live. **Check this before every playtest** — the site was a week stale going into this
  one, which would have made the endgame untestable without anyone noticing why.

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
155 tests pass. What remains is a playtest, then shipping.

| Area | State |
|---|---|
| Rules engine | ✅ Done, pure, 107 tests |
| Multiplayer / server | ✅ Done, authoritative, survives restarts |
| Board rendering + input | ✅ Done, design values applied, 0.7 ms/frame |
| Twist mode | ✅ Done, with the shrink floor |
| Screens: landing, settings, lobby, game | ✅ Done — full colour, type and behaviour pass |
| **Sound** | ✅ Done — eight synthesised sounds, 42 tests. All eight are in use. |
| **Twist burn** | ✅ Done — fuse, ignition, spreading front, flame, ash. 2.6 ms worst frame. |
| **Start sequence** | ✅ Mark draws, flares, hits, shakes; board rolls in |
| **Endgame shatter** | ✅ Done — crack, flight, count-up, crown. 5.4 ms worst frame on 12×12 |
| **PWA / installable** | ❌ Not started |
| **Deployed** | ✅ https://box.charlesbobby253.workers.dev |

**Live since 2026-07-31, redeployed 2026-08-10 with M7.** Verified against the deployed
site, not just dev: room creation, code lookup, two WebSocket clients joining, a move
propagating to both, and a **28 ms median round-trip**. Redeploy with `npm.cmd run deploy`
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
      │  └─ components/        ← scoreboard, shotclock, shop, toast, playButton
      ├─ audio/
      │  ├─ waveforms.ts       ← PURE. the seven sounds, synthesised. tested.
      │  └─ engine.ts          ← unlock on first gesture, voices, ducking, mute
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
| `move` | `playerIndex, lineId, claimed[], scores[], again, wildcardFired, gameOver, winners[], shrink, serverNow, turn` |
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
  a misplaced line is far more painful than a slow turn. Player-overridable in settings.
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

**The collapse warning is a flame badge ON the board.** A 2.75rem ring in the board's
top-right corner, absolutely positioned inside `.board-wrap` so it costs the layout nothing
(§10.0). The ring is a dial that drains as the collapse approaches — full two rounds out,
half at one round — and at one round it turns red and pulses. It hides itself when no
collapse is pending, which includes after the final burn at the floor.

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

## 13. Audio

**Synthesised, not sampled** (revised 2026-08-03 — this section previously specified
`.webm` + `.mp3` files in `public/sfx/`). Seven sounds, none longer than 1.2s, written as
maths in `src/client/audio/waveforms.ts`. That costs no bundle bytes, no request, no decode,
and — the part that actually decided it — no iOS codec fallback. Tuning one is editing a
number rather than opening a DAW.

| Name | Used for | Character | Length |
|---|---|---|---|
| `tick` | Line placed | Band of noise, crisp and dry | 45ms |
| `click` | Box claimed | Struck wood, bending down in pitch | 90ms |
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

`waveforms.ts` is **pure** — a name and a sample rate in, a `Float32Array` out — for the
same reason `rules.ts` is: it makes the part with the interesting logic testable under
`node --test`. 42 tests assert every sound is the length the table says, never clips, is
never silence, renders identically twice, and **starts and ends on an exactly zero sample**.
That last one is not fussiness: a buffer with a non-zero endpoint is a step change in the
speaker, which is an audible click layered on top of the sound you designed, loudest on
precisely the short sharp sounds where it is hardest to diagnose.

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
- [ ] **M6 remainder — one thing left, and it is not code:**
      1. **Playtest what exists.** It has not been played since the visual pass, has never
         been heard at all, and nobody has watched the board burn on a phone. Tap accuracy
         on the bigger boards, whether Small at ~14 min is right, whether the grown initials
         read, whether the Twist floor makes the endgame better or duller, whether the
         sounds are the right sounds at the right volumes, and whether ~2.9s of fire is
         the right length when you are waiting to take your turn. The tables to turn are
         `SFX_SECONDS`/`SFX_PEAK` in `waveforms.ts`, `BURN` in `burn.ts`, and the timing
         table in `startSequence.ts`.
- [x] **M7 — Endgame sequence.** ✅ 2026-08-10. Crack, flight, clacks, count-up, victory.
      A second full-screen canvas (`render/shatter.ts`), an eighth sound (`crack`), and
      `planShatter()` split out pure with 6 tests — including the one that matters, that a
      count-up from `harvested[p]` lands on exactly `scores[p]` in a twist game that really
      collapsed. `fanfare` moved off the overlay and onto the crown, as this line asked.
      Verified against four complete games driven over real sockets: hold, crack at 600ms,
      counters climbing to the true final score, crown, then the result — plus the
      reduced-motion path, which reaches the result with no frames drawn at all.
      **1.8 ms median / 5.4 ms worst frame** on a full 12×12. No console errors.
      *Never watched by a human. Nobody has seen 144 squares fly.*
- [ ] **M8 — PWA + ship.** Manifest, service worker, icons, offline shell, custom domain.
      **Playtest with 6 real people.**

**Do M1 before M2.** A pure, tested rules engine makes M3 nearly mechanical; skipping it
means debugging game logic and network logic simultaneously, which is miserable.

---

## 16. Open questions

2. **Room code length** — 4 chars is friendlier to type; collision risk is fine at this
   scale with retry-on-collision. Confirm at M3.
3. **Wildcard price** (§9.3) — 10 is deliberately steep and probably right, but it's a
   `constants.ts` value. Revisit after the first 6-player playtest.
4. **Watch-to-play ratio.** With 8 players on a 10×10 board you act for ~3 minutes and watch
   for ~19. The shot clock and the shrinking board are the mitigations; whether they're
   enough is a playtest question, not a design one. If they aren't, the earliest lever is
   dropping the shrink-arm threshold further (§9.2) before touching turn structure.

### Resolved

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
