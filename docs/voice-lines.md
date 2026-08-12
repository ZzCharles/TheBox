# Announcer lines

Drop the ElevenLabs `.mp3` files in **`public/sfx/voice/`**, named **exactly** as
below. The code already looks for these paths — nothing needs wiring when a file
appears, and a file that is missing is simply silent
(`src/client/audio/voice.ts`).

> This note lives in `docs/` rather than beside the audio because **everything
> in `public/` is published**. A README next to the files was being served at
> `/sfx/voice/README.md` on the live site.

⚠️ **Exact case matters, and getting it wrong fails silently in production.**
The Worker serves assets case-sensitively and answers an unknown path with
`200` + the app's HTML rather than a 404, so `Nice.mp3` where the code wants
`nice.mp3` "loads" fine and then goes quiet — while working perfectly on
Windows, whose filesystem ignores case. `npm run check` runs
`scripts/check-assets.mjs`, which catches exactly this and names the near-miss.

| File | Line | Fires when |
|---|---|---|
| `nice.mp3` | "Nice" | 4–6 boxes in one turn |
| `blazing.mp3` | "Blazing" | 7–9 boxes |
| `ruthless.mp3` | "Ruthless" | 10–12 boxes |
| `wildfire.mp3` | "Wildfire" | 13–15 boxes |
| `insanity.mp3` | "Insanity" | 16+ boxes, **and again on every further box** |
| `here-we-go.mp3` | "Here we go" | The board finishes rolling in |
| `heres-your-winner.mp3` | "Here's your winner" | The winner is crowned |
| `tick-tick.mp3` | "Tick-tick" | 4 seconds left on your turn |
| `you-there.mp3` | "You there?" | Your second missed turn — the one that parks you |

## Still wanted

| File | Line | Why |
|---|---|---|
| `its-a-draw.mp3` | something for a tie | A shared victory is a real outcome, and "here's your winner" is wrong for one. Until this exists a draw gets the fanfare and no voice. |
| `insanity-2.mp3`, `insanity-3.mp3` | two more "Insanity" takes | This is the one line that repeats — every box past sixteen re-fires it. One recording six times in four seconds is a stuck record. Add them to `VOICE_FILES.Insanity` and they rotate automatically. |

## Format

- **mp3**, mono, 44.1 kHz, around 96 kbps. Every target decodes mp3, which is
  what avoids the codec fallback problem that made the rest of the audio
  synthesised in the first place (see PROJECT.md §13).
- **Trim the silence** off both ends. These are cued to land on a beat — the
  crown, the board settling — and 200 ms of leading room reads as lag.
- **Keep them short.** Under ~1.2 s each; the whole set well under 400 kB,
  because the service worker precaches all of it on a player's first visit.
- Levels are set in code (`VOICE_GAIN` in `voice.ts`), so record at a normal
  level and don't try to pre-balance them against the game.
