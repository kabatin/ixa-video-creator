# iXA Video Creator

**Start from the song. Time the lyrics, cut it, let AI draft the storyboard, the frames and the
takes — and render a music video that matches exactly what you previewed.**

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
- if the song has lyrics, you tap the start of each line while it plays, and the lines become
  timed captions — checked on a black screen before a single frame is generated

The work is therefore *edit against the music, then fill each slot* — never *generate clips
and hope they fit*. The first film made with it is a 1m56s music video in 27 shots.

No finished song yet? *Make a song* writes one on your own Mac with ACE-Step 1.5 — a style, optional
lyrics, a length — and it lands in the project as a track, analysed like any other.

![Cutting while listening: section boundaries placed as cuts in one click, with the cuts they make](./docs/images/cutter.jpg)

## From an empty project to the exported file

A bar under the menu walks you through the whole job and always highlights the next step. Each
step shows ✓ when it is done, or how far along it is.

![The production flow bar: song, direction, lyric timing, captions, cut into shots and storyboard are done; frames are at 40 of 44 and highlighted as the next step; takes at 7 of 44; export done](./docs/images/flow-bar.png)

1. **Song** — drop an audio file; it is analysed for beats, downbeats and sections.
2. **Direction** — concept and synopsis, lyrics, and the look (style, light, texture), plus
   things to avoid and style reference images. They are added to every generation, so you write
   them once. Tick *instrumental* and the lyric steps are skipped.
3. **Lyric timing** — play the song and press Enter on the first syllable of each line.
4. **Captions** — the timed lines become text clips. The preview plays the song with the
   captions over black, so you can check timing without generating — or paying for — any
   pictures.
5. **Narration** (optional) — write lines and have an AI voice read them, or record your own
   and let it be transcribed into lines and captions. The music ducks under the voice.
6. **Cut into shots** — place cuts while listening (Enter works anywhere, cuts snap to the
   beat), or in one click at section boundaries or lyric starts. Cuts are a draft until you
   press *N cuts → shots*.
7. **Storyboard** — an AI drafts a description, a mood **and a camera** (shot size, angle,
   movement) for every shot, each with *why this picture*. It reads the lyrics sung during that
   shot, the characters, the locations and the look. Nothing changes until you adopt a draft,
   shot by shot; you can always write your own.
8. **Frames** — an AI draws each shot's start frame from its storyboard, with the cast's
   reference images. Three are drawn at a time (measured: 2.1× faster than one by one), and you
   can stop the whole queue — or only the shots you selected — at any point.
9. **Takes** — the video for each shot, made from its start frame. While they render you see
   which are queued, which are waiting inside the generator and which are being made, with the
   time elapsed and an estimate; generation can be stopped at any point.
10. **Export** — H.264, the whole film or only the shots you selected. The file is saved into
   `~/Movies/ixa-video-creator/<project>/`, and one button opens that folder in Finder.

Skipping a step is allowed, but you are asked first — for example, before drawing frames for
shots that have no storyboard yet.

## Or hand the whole job to an agent

`apps/mcp` is an MCP server (ADR-0049) that lets Claude Code or Codex drive the same steps through
21 tools — create the project, make and pick a song, cut it into shots, write the storyboard, draw
start frames, make takes, adopt them, export. Two of the tools are the agent's eyes: `view`
returns start frames and frames sampled from a take **as images**, so the agent can look at what it
made and redraw a broken hand or a morphing car before it moves on.

> "Make a 60-second 16:9 short: a night street race, then the two drivers at dawn."

The agent works through the API with a revocable automation token (ADR-0046), so everything it makes
appears in the workbench as ordinary shots and takes you can review and change. The first test — a
62-second, 16-shot short made entirely through these tools, music included — took about four hours
on one local GPU. Setup: [apps/mcp/README.md](./apps/mcp/README.md).

## A 30-second spot, start to finish

The sample project is **LUNA BREW**, a fictional night coffee stand: a 30-second spot cut to a
120 BPM track, nine shots, two recurring characters.

![Nine stills of the LUNA BREW spot: a rainy back street, a crescent-moon neon in a puddle, the barista pulling an espresso, latte art, the rider in the rain, the handoff at the counter, steam, and the two of them on a rooftop at dawn](./docs/images/luna-brew-stills.jpg)

These stills were made with an image model outside the app and brought in as each shot's
**start frame** — which still works. Since v0.2 the app can also draw start frames itself. The
built-in `local/still-motion` model turns a start frame into a take — a slow push, pull or pan
that follows the shot's camera setting — for free and without an API key. Switch to another
video model later and the same start frames carry over.

| | |
|---|---|
| ![Playing the cut end to end: the preview player above the timeline](./docs/images/preview.jpg) | ![Take comparison: two takes of the same shot side by side on the same beats](./docs/images/take-compare.jpg) |
| **Preview is the render** — the player and the export share one composition. | **Compare takes on the beat** — two takes of a shot, looped over the shot's span. |
| ![The inspector: timing, camera, cast, location and start frame of a shot](./docs/images/inspector.jpg) | ![The library: a character's identity image and looks](./docs/images/library.jpg) |
| **One shot, everything in one place** — camera, cast with looks, location, start frame. | **Characters, looks, locations, brand** — per project, importable from other projects. |


## Why it might interest you

**The song's structure is data, not a picture of a waveform.** Beats and downbeats are
numbers you can snap to, filter by and sort against. The tool shows where each shot sits
relative to the beat *without calling it a mistake* — cutting to a vocal onset rather than a
beat is a choice, and on the reference project 16 of 27 cuts are deliberately off the grid.

**Preview is the render.** The player and the exported file consume the *same*
`TimelineDocument` through the *same* Remotion composition. There is no separate "preview
path" that can drift from the output — a class of bug that eats hours.

**You choose the AI for each job, from what is already on your machine.** Text (storyboard
drafts and writing help) can be Claude Code, Codex or Grok; images can be Codex or local FLUX.2
[klein]; video can be the free local models or fal; music is local ACE-Step 1.5. The CLIs run
under your own sign-in — no API keys for them are stored in the app. **Text, pictures, video
and music can all be made on one Mac, for free.**

**Your footage is just files.** Everything the app makes — frames, takes, renders — is written
to a folder on your disk (`STORAGE_DIR`, no object store in the way), and one button copies a
project's assets into `~/Movies/ixa-video-creator/<project>/素材/` under readable names in shot
order, so you can use a single clip somewhere else without exporting the whole film. Nothing is
duplicated: they are hard links to the same bytes. Signed, expiring URLs are what the browser
gets; they are issued per request and never stored.

**AI drafts never overwrite your work.** Storyboard drafts sit next to the current description
with a reason for each, and a shot changes only when you adopt its draft. Bulk edits are
recorded so they can be undone. Takes are append-only: generating again never replaces a
previous result.

**Built for keeping one character across a whole film.** Characters, looks, locations and
brand assets resolve into each shot's reference images, rather than prompt text you retype 27
times and get subtly wrong. A character sheet (four views) can be made from a single image, and
storyboard drafts are told to describe only the appearance you actually wrote down — the rest
comes from the reference images.

**Providers are swappable, and the swap is free to test.** `VideoProvider` is a
three-method interface (`submit` / `poll` / `cancel`). A local FFmpeg stub implements it
fully, so the entire pipeline — queueing, polling, failure handling, budget limits — runs
end to end at zero cost before you ever connect a paid API.

**Money is treated as a first-class hazard.** Per-project budgets are enforced server-side
before a job is enqueued. The stub can be given a fake price so you can *prove* the budget
guard stops a run without spending anything. Failed generations release the shot instead of
leaving it stuck, and a transient network error never discards work you already paid for.

## How it fits together

```
apps/
  web       Next.js workbench — dockable panels (storyboard, cutter, timeline, compare, drafts)
  api       Hono + zod-openapi
  worker    BullMQ consumers: video, image, voice and music generation, media probing, rendering
  audio     Python service — librosa analysis (beats, downbeats, sections, waveform)
  mcp       MCP server for AI agents (stdio) — a thin client of the API
packages/
  domain    Pure. No IO. The single source of truth for the model.
  providers Adapters (video / image / llm / voice / music). External SDKs and CLIs stop here.
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
Optional: [Claude Code](https://docs.anthropic.com/en/docs/claude-code),
[Codex](https://github.com/openai/codex) or Grok CLI, signed in on the same Mac, for AI text and
images.

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install

cp .env.example .env          # defaults are safe: nothing bills
# signing key for the URLs that show your footage in the browser (required for local files, ADR-0041)
printf 'STORAGE_SIGNING_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
pnpm infra:up                 # postgres, redis
pnpm db:migrate
pnpm db:seed                  # creates a workspace and writes its id into .env

pnpm dev                      # web :3000, api :3001, worker, audio :8100
```

Open <http://localhost:3000>, create a project, and drop an audio file onto the window — the
flow bar takes it from there. **Out of the box everything runs on local stubs — no API keys,
no cost.**

### Choosing which AI to use

![The "which AI to use" dialog: a tab per job on the left showing the current choice, and the AIs found on this Mac for video on the right, tagged "this Mac" and "free"](./docs/images/ai-chooser.jpg)

The first time you open the workbench, the *使う AI* (which AI to use) dialog appears. It looks
for the AI CLIs, API keys and local generation servers on this Mac, and lets you pick one for
each job:

| Purpose | Choices |
|---|---|
| Text — storyboard drafts, ✦ AI writing help, automatic review | Claude Code · Codex · Grok |
| Images — shot start frames, character sheets | Codex · FLUX.2 [klein] (local, free) |
| Video — takes (AUTO picks among this AI's models) | still-motion (free) · MiniMax H3 (local, free) · Wan 2.2 5B (local, free) · Seedance via fal (paid) |
| Voice — narration | Mac voice (free) · Gemini API · ElevenLabs (paid) |
| Transcription — recorded narration into lines | whisper.cpp (local, free) · Gemini API · ElevenLabs (paid) |
| Music — *Make a song* | ACE-Step 1.5 (local, free) |

Every job also has a stub (*お試し*) that runs without any AI.

Change it later from *iXA Video Creator → 使う AI…*. Until you choose, the `.env` settings apply.
fal and the local server must be enabled in `.env` before they can be chosen — the screen alone
never opens a billing path. Codex image generation uses your plan's usage and takes about a
minute per frame; three are drawn at a time (`WORKER_CONCURRENCY_IMAGE`).

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

### Generating on this Mac (optional)

Four local servers turn one Apple Silicon Mac into a free studio. Enable any of them, or all
of them.

| Server | Makes | Model | Default address |
|---|---|---|---|
| [vpipe-api](https://github.com/kabatin/vpipe-api) | video | MiniMax H3 Turbo | `http://127.0.0.1:8765` |
| [wan-api](https://github.com/kabatin/wan-api) | video | Wan 2.2 TI2V-5B | `http://127.0.0.1:8766` |
| [klein-api](https://github.com/kabatin/klein-api) | images | FLUX.2 [klein] | `http://127.0.0.1:8767` |
| [ace-step-api](https://github.com/kabatin/ace-step-api) | music | ACE-Step 1.5 | `http://127.0.0.1:8768` |

```bash
# .env (default for each is `none`)
LOCAL_VIDEO_GENERATOR=vpipe,wan   # comma-separated
LOCAL_IMAGE_GENERATOR=klein
LOCAL_MUSIC_GENERATOR=ace_step
VPIPE_API_URL=http://127.0.0.1:8765
VPIPE_API_TOKEN=                  # required only when the URL points off this machine
# WAN_ / KLEIN_ / ACE_STEP_API_URL and _API_TOKEN work the same way
```

Three steps: **start the server, list it in `.env`, pick it under *Which AI*.** Installing and
running the servers is documented in their own READMEs.

**They share one GPU, so ixa never runs two local generations at the same time.** Video, images,
upscaling and music wait in one line and finish one after another; the waiting one shows as
*waiting in line* rather than in progress.

**Images** (ADR-0047): about 30 s per image, and a fixed seed reproduces the picture.

**Music** (ADR-0048): *Make a song* in the music area takes a style, optional lyrics, a length
(10–240 s), instrumental or not, and how many (1–4). About 40 s per 60-second song (up to ~1.5 min
on the first run while the model loads). Each result becomes a music track and is sent to beat
analysis; the first one becomes the master only when the project has none. Only the master track
plays in the preview and the export — the others are candidates.

**Video** (ADR-0031, ADR-0040): each listed server contributes a draft and a standard model; vpipe also publishes a **final**
one. AUTO chooses among them only when that server is the selected video AI; otherwise it never
picks them.

**Draft now, final overnight.** Shoot every shot with the draft model (832×480), adopt the take
you like, then *remake at final quality* — one take, or every adopted shot at once from the
bulk bar. The spec does not change: same prompt, same seed, same start frame, only the
generation size (1344×768). The final take is appended next to the draft, never over it, and
the screen tells you the count, how long it will take and when it will finish before you press
it. Measured on an M5: a 2.7s shot took 5.1 min as a draft and 14.0 min as a final. Note that a
different generation size produces a different picture — it is a re-shoot with the same
instructions, not an upscale.

**Or keep the picture and upscale it** (ADR-0044). *Upscale* runs vpipe's FlashVSR on a finished
take: the picture stays exactly as adopted and only the detail sharpens, to 1920×1080. Do it per
take, or for every adopted take from the bulk bar. Measured: about 5.5 min per shot, and the
upscaled take is appended next to the original. Takes are stored at the size the model actually
drew (ADR-0045) and scaled once, with Lanczos, at export.

**Wan tops out at 5 seconds** (wan-api's contract). A 5–7.5s shot is generated at 5s and slowed to
fit; beyond 7.5s ixa asks you to split the shot. Use MiniMax H3 (up to 10.125s) for longer cuts.

Measured on an M5 (10-core GPU, 32 GB), on AC power, 832×480 output, one 5-second clip:

| | H3 (draft) | Wan (draft) | Wan (standard) |
|---|---|---|---|
| time | **7.4 min** | 11.3 min | 19.4 min |
| frame 0 vs start image (SSIM) | 0.695 | **0.851** | 0.852 |

**H3 is faster; Wan holds the start frame.** Which one to use is your call — nothing here scores
how the results look. See [ADR-0031](./docs/adr/0031-local-h3-video-via-vpipe-api.md),
[ADR-0040](./docs/adr/0040-local-wan-2-2-video-via-wan-api.md) and wan-api's
[benchmark.md](https://github.com/kabatin/wan-api/blob/main/docs/benchmark.md).

Note: with wan-api's `drawthings` backend a start image is rejected — use the `mlx` backend
(the default) for image-to-video.

## Costs, honestly

Everything except fal, ElevenLabs and Gemini's paid tier is free to run: the stubs,
`local/still-motion`, the four local servers, the Mac voice and whisper.cpp. Claude Code, Codex
and Grok use whatever plan you are already signed in with.

For the reference project — 27 shots, 110.9s of edited footage — Seedance 2.5 via fal.ai
bills **140s**, because the model's minimum clip is 4 seconds and 12 of those shots are
shorter. At $0.3024/s that is **$42 for one take each**, or **$127 for three**.

Short cuts and a 4-second minimum are a bad match. Budget accordingly, and start with one
take.

## Status

Working end to end, from an empty project to an exported file: analysis → direction → lyric
timing → captions → narration → cutting → AI storyboard drafts → AI start frames → takes →
review → timeline → H.264 export — by hand in the workbench, or by an agent through MCP. Local
images (klein) and local music (ACE-Step) are measured on real hardware and used for real work.
The local video paths (still-motion, MiniMax H3 via vpipe, Wan 2.2 5B via
wan-api) are measured on real hardware — though **no clip has been generated from ixa through
wan-api yet**: those numbers come from wan-api's own benchmarks and the adapter is covered by
contract tests (ADR-0040). The fal.ai / Seedance 2.5 adapter is implemented and tested against
mocked responses, but its capability numbers — price per second, output frame rate — are
**from documentation, not measured**, and are marked as such in the source.

This is a personal project built in the open. Interfaces still move.

## Security

**A passphrase guards the API once you set one** (ADR-0046). Out of the box there is none and
the screen lets you straight in; the API listens on `127.0.0.1` only. Set `IXA_PASSPHRASE`
(12+ characters) and every endpoint answers 401 until the passphrase is entered — it is
**required** before the API will listen beyond this machine (`API_HOST`). Automation (Claude,
Codex) gets its own revocable access tokens. There is no HTTPS — on a LAN the passphrase and the
session cookie travel in plain text. Do not expose it to a network you do not control — see
[SECURITY.md](./SECURITY.md).

## Third-party licensing

This project is MIT. Some dependencies carry obligations that pass to **you** as the
operator:

- **[Remotion](https://www.remotion.dev/docs/license)** is free for individuals and
  organisations of up to three people who operate it; **four or more requires a company
  license**, and headcount is aggregated across collaborating parties. MIT on this
  repository does not waive that.
- Provider APIs (fal.ai and others) bill you directly under their own terms.
- Claude Code, Codex and Grok run under your own accounts and their own terms.
- **MiniMax H3** (only if you enable the optional local generator) is released under the
  MiniMax H3 Community License, which restricts where and how the weights may be used.
  ixa does not ship the weights; check the license before enabling it.
- **Wan 2.2** (likewise, only if you enable it) is published under Apache-2.0, which permits
  commercial use. ixa does not ship the weights; the attribution and license-notice
  obligations fall on you as the operator — check the model card.
- **FLUX.2 [klein]** (only if you enable klein-api): the 4B (draft) and 9B (standard) weights
  are published under different licenses, and the 9B's does not cover commercial use — check
  both model cards before using the output commercially.
- **ACE-Step 1.5** (only if you enable ace-step-api) is published under MIT.

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
