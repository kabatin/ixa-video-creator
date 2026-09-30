# iXA Video Creator

**Start from the song. Cut it, generate a shot for every cut, and render a music video that
matches exactly what you previewed.**

[![CI](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml/badge.svg)](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/kabatin/ixa-video-creator)](https://github.com/kabatin/ixa-video-creator/releases) [![License: MIT](https://img.shields.io/github/license/kabatin/ixa-video-creator)](./LICENSE) [![GitHub stars](https://img.shields.io/github/stars/kabatin/ixa-video-creator?style=social)](https://github.com/kabatin/ixa-video-creator/stargazers)

[日本語版 README](./README.ja.md) · MIT licensed · TypeScript monorepo

![Demo: drop a song onto an empty project, it is analysed, section boundaries become cuts in one click, the cuts become shots, each shot gets a take from its start frame, and the whole thing plays back in sync with the music](./docs/images/demo.webp)

<sub>Drop a song → cut at its section boundaries → shots → a take for every shot → play it through. Recorded in real time on the LUNA BREW sample; only the waiting for takes is cut.</sub>

---

## Music first

Most AI video tools begin with a text prompt, hand you a clip, and leave you to slide music
underneath afterwards. This one runs the other way round.

**The finished track is the input.** You drop a song onto the window, it is analysed with
librosa — beats, downbeats, drops, three-band RMS — and from that moment the song *is* the
timeline:

- the film's length is the song's length; there is nothing to overrun
- every cut is a position in the waveform, placed while listening to it
- a shot's duration is a consequence of where you cut, not a number typed into a form
- that duration is what gets sent to the video model, so what comes back is the length the
  music asked for

The work is therefore *edit against the music, then fill each slot* — never *generate clips
and hope they fit*. The first film made with it is a 1m56s music video in 27 shots.

![Cutting while listening: section boundaries placed as cuts in one click, with the cuts they make](./docs/images/cutter.jpg)

## A 30-second spot, start to finish

The sample project is **LUNA BREW**, a fictional night coffee stand: a 30-second spot cut to a
120 BPM track, nine shots, two recurring characters. Everything below is the real app running
on that project.

![Nine stills of the LUNA BREW spot: a rainy back street, a crescent-moon neon in a puddle, the barista pulling an espresso, latte art, the rider in the rain, the handoff at the counter, steam, and the two of them on a rooftop at dawn](./docs/images/luna-brew-stills.jpg)

The stills were made with an image model outside the app and brought in as each shot's
**start frame**. The built-in `local/still-motion` model turns a start frame into a take —
a slow push, pull or pan that follows the shot's camera setting — for free and without an API
key. Swap in a real image-to-video provider later and the same start frames carry over.

| | |
|---|---|
| ![Playing the cut end to end: the preview player above the timeline](./docs/images/preview.jpg) | ![Take comparison: two takes of the same shot side by side on the same beats](./docs/images/take-compare.jpg) |
| **Preview is the render** — the player and the export share one composition. | **Compare takes on the beat** — two takes of a shot, looped over the shot's span. |
| ![The inspector: timing, camera, cast, location and start frame of a shot](./docs/images/inspector.jpg) | ![The library: a character's identity image and looks](./docs/images/library.jpg) |
| **One shot, everything in one place** — camera, cast with looks, location, start frame. | **Characters, looks, locations, brand** — reusable across every shot. |


## Why it might interest you

**The song's structure is data, not a picture of a waveform.** Beats and downbeats are
numbers you can snap to, filter by and sort against. The tool shows where each shot sits
relative to the beat *without calling it a mistake* — cutting to a vocal onset rather than a
beat is a choice, and on the reference project 16 of 27 cuts are deliberately off the grid.

**Preview is the render.** The player and the exported file consume the *same*
`TimelineDocument` through the *same* Remotion composition. There is no separate "preview
path" that can drift from the output — a class of bug that eats hours.

**Built for keeping one character across a whole film.** Looks, locations and brand assets
are reusable entities that resolve into each shot's reference images, rather than prompt text
you retype 27 times and get subtly wrong.

**Providers are swappable, and the swap is free to test.** `VideoProvider` is a
three-method interface (`submit` / `poll` / `cancel`). A local FFmpeg stub implements it
fully, so the entire pipeline — queueing, polling, failure handling, budget limits — runs
end to end at zero cost before you ever connect a paid API.

**Money is treated as a first-class hazard.** Per-project budgets are enforced server-side
before a job is enqueued. The stub can be given a fake price so you can *prove* the budget
guard stops a run without spending anything. Failed generations release the shot instead of
leaving it stuck, and a transient network error never discards work you already paid for.

**Takes are append-only.** Generating again never overwrites a previous result. You adopt
one; the others stay for comparison.

**Bring your own frames.** Give a shot a start frame — a still from any image tool, or a
photo — and the free local model turns it into a take that goes through the same adopt,
review and timeline flow as anything generated.

## How it fits together

```
apps/
  web       Next.js workbench — dockable panels (storyboard, cutter, timeline, compare)
  api       Hono + zod-openapi
  worker    BullMQ consumers: generation, media probing, rendering
  audio     Python service — librosa analysis (beats, downbeats, sections, waveform)
packages/
  domain    Pure. No IO. The single source of truth for the model.
  providers Adapters (video / image / llm). External SDKs stop here.
  render    Remotion composition + FFmpeg plan
  db        Drizzle schema and repositories
```

The dependency direction is always `apps → packages → domain`, never back.

**Shot First.** Storyboard, generation, takes, review and the timeline all hang off one
entity. A `Shot` owns its position on the master timeline — the position you gave it by
cutting the song — so there is no second place where time can disagree. Time is stored in
seconds as a float, because that is the unit the audio analysis speaks; frames and
milliseconds never enter the domain or the database.

## Quick start

Requires Node 22, pnpm 9, Docker, FFmpeg, and [uv](https://docs.astral.sh/uv/) with
Python 3.11+ for the audio service (`uv` installs its Python dependencies on first run).

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install

cp .env.example .env          # defaults are safe: nothing bills
pnpm infra:up                 # postgres, redis, minio
pnpm db:migrate
pnpm db:seed                  # creates a workspace and writes its id into .env

pnpm dev                      # web :3000, api :3001, worker, audio :8100
```

Open <http://localhost:3000>, create a project, drop an audio file onto the window, and
start cutting. **Out of the box it runs entirely on the local stub provider — no API keys,
no cost.**

### Connecting a real provider

```bash
# .env
VIDEO_PROVIDER=fal            # default is `stub`
FAL_API_KEY=...
```

Generation now costs real money. The switch is deliberate and separate from the key: simply
having a key present never enables billing. Choosing `fal` without a key stops the worker at
startup rather than silently falling back to the stub.

Settings → *Connections and runtime* shows which keys are set (never their values) and
whether the billing path is open.

### Generating locally with MiniMax H3 (optional)

If you run [vpipe-api](https://github.com/kabatin/vpipe-api) on the same machine, ixa can use
its MiniMax H3 Turbo workflow as a free, local video provider:

```bash
# .env
LOCAL_VIDEO_GENERATOR=vpipe   # default is `none`
VPIPE_API_URL=http://127.0.0.1:8765
VPIPE_API_TOKEN=              # required only when the URL points off this machine
```

Two models appear in the model picker (draft and standard). They are never chosen by AUTO:
a clip takes 7–25 minutes on an M5 Mac and clips render one at a time, so queued generations
wait their turn instead of failing. See [ADR-0031](./docs/adr/0031-local-h3-video-via-vpipe-api.md).

## Costs, honestly

For the reference project — 27 shots, 110.9s of edited footage — Seedance 2.5 via fal.ai
bills **140s**, because the model's minimum clip is 4 seconds and 12 of those shots are
shorter. At $0.3024/s that is **$42 for one take each**, or **$127 for three**.

Short cuts and a 4-second minimum are a bad match. Budget accordingly, and start with one
take.

## Status

Working end to end with the stub provider: analysis → cutting → shot creation → generation
→ review → timeline → H.264 export. A real provider adapter (fal.ai / Seedance 2.5) is
implemented and tested against mocked responses, but its capability numbers — price per
second, output frame rate — are **from documentation, not measured**, and are marked as such
in the source.

This is a personal project built in the open. Interfaces still move.

## Security

**The API has no authentication.** It binds to `127.0.0.1` by default. Do not expose it to
a network you do not control — see [SECURITY.md](./SECURITY.md).

## Third-party licensing

This project is MIT. Some dependencies carry obligations that pass to **you** as the
operator:

- **[Remotion](https://www.remotion.dev/docs/license)** is free for individuals and
  organisations of up to three people who operate it; **four or more requires a company
  license**, and headcount is aggregated across collaborating parties. MIT on this
  repository does not waive that.
- Provider APIs (fal.ai and others) bill you directly under their own terms.
- **MiniMax H3** (only if you enable the optional local generator) is released under the
  MiniMax H3 Community License, which restricts where and how the weights may be used.
  ixa does not ship the weights; check the license before enabling it.

## Contributing

Issues, [discussions](https://github.com/kabatin/ixa-video-creator/discussions) and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Please read [AGENTS.md](./AGENTS.md) first — it
documents the conventions this codebase actually enforces (immutability, zod at every
boundary, no `any`, secrets only via env, append-only takes). `CLAUDE.md` holds the naming
and wording rules, and [docs/LESSONS.md](./docs/LESSONS.md) collects the mistakes this
project actually made and the rules that came out of them — mostly variations on *a green
test suite that was checking nothing*.

Run what CI runs before opening a PR:

```bash
npx turbo run lint typecheck test --concurrency=2
```

If this project is useful or interesting to you, a ⭐ helps other people find it.

## License

[MIT](./LICENSE) © Hiroshi Kabayama
