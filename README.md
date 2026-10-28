# iXA Video Creator

**Make music videos from the song outward — and hand the work to an AI agent when you want to.**
Cut against the music, let AI draft the storyboard, the frames, the takes, the score and the sound
effects, and export exactly what you previewed. Ask for changes in plain words in the built-in
agent tab, or let Claude Code or Codex drive the whole production over MCP.

> **Let an agent install it.** Paste this into Claude Code or Codex on your Mac:
> *"Install https://github.com/kabatin/ixa-video-creator on this Mac and get it ready to use, following its INSTALL.md."*

[![CI](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml/badge.svg)](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/kabatin/ixa-video-creator)](https://github.com/kabatin/ixa-video-creator/releases) [![License: MIT](https://img.shields.io/github/license/kabatin/ixa-video-creator)](./LICENSE) [![GitHub stars](https://img.shields.io/github/stars/kabatin/ixa-video-creator?style=social)](https://github.com/kabatin/ixa-video-creator/stargazers)

[日本語版 README](./README.ja.md) · MIT licensed · TypeScript monorepo · v0.7

| 🎵 Start from the song | 🤖 Or just ask |
|---|---|
| ![Demo: drop a song onto an empty project, it is analysed, section boundaries become cuts in one click, the cuts become shots, each shot gets a take from its start frame, and the whole thing plays back in sync with the music](./docs/images/demo.webp) | ![The AI agent tab: the creator asks for a one-line summary of every shot, the agent reads the project and answers in a list; then asks for a sound effect on the whale's tail, the agent starts a motion analysis and stops at a confirmation card with Run, Cancel and "don't ask again in this task"; the creator cancels and the agent offers two other ways](./docs/images/agent-chat.webp) |
| Drop a song → cut at its section boundaries → shots → a take for every shot → play it through. | Ask in plain words. Reads run straight away; anything that generates, deletes or exports waits for your OK. |

---

## What it is, in four lines

- **The song is the timeline.** Cuts are positions in the waveform, so every shot is exactly as long as the music asks for — and that length is what the video model is told to make.
- **An AI agent can do the work with you.** A chat tab inside the workbench, and an MCP server with 62 tools for Claude Code and Codex. Everything the agent makes shows up as ordinary shots, takes and clips you can review, change or undo with ⌘Z.
- **One Mac can be the whole studio.** Pictures (FLUX.2 [klein]), video (MiniMax H3, Wan 2.2), songs and BGM (ACE-Step 1.5, Stable Audio 3, MiniMax-Music3) and sound effects (Stable Audio 3) can all run locally, for free. Paid APIs are optional and fenced off.
- **It is honest about what it costs and where it falls short.** Measured numbers only, and a section on [limits](#limits-honestly) you should read before you start.

## Made with it

![Seven frames from "Senko's Time Travel", a vertical short: the girl Senko lit by a gaming monitor in an esports shop, on a footbridge at sunset, in an ukiyo-e castle town under cherry blossoms, raising a glowing sword in a stained-glass hall, riding a flying whale above the clouds, on a neon rooftop in 2099, and back in the shop under the title card](./docs/images/senko-stills.jpg)

<sub>**戦子のタイムトラベル (Senko's Time Travel)** — a 26-second 9:16 short in seven shots. Start frames, video, music and sound effects were all made on one Mac with local models; only the narrator's voice is the Gemini API.</sub>

![Nine frames from the "NIGHT RUN" trailer: a rain-soaked neon street, two sports cars idling in steam, an extreme close-up of a driver's eyes, a car streaking past in motion blur, a rear wheel spinning in tyre smoke, a car racing through a lit tunnel, the driver at the wheel in the rain, the two leads at a lookout at dawn, and the NIGHT RUN title over a wet street](./docs/images/night-run-stills.jpg)

<sub>**NIGHT RUN** — a 66-second 16:9 trailer in 41 shots, with narration, effects and a sound-effect lane. Frames taken from the exported file.</sub>

## Ask an AI agent

There are two ways in, and they share the same tools.

### In the workbench: the AI agent tab

![The workbench with the AI agent tab open in the bottom dock: the storyboard and shot list above; below, the agent's bulleted summary of eight shots, the creator's request for a whale-tail sound effect, a "analysing motion" line and a highlighted confirmation card reading "Analyse motion (the AI looks at the pictures) — takes time or money" with Run, Cancel and "Don't ask again in this task"](./docs/images/agent-tab.jpg)

Open **AI エージェント** in the bottom dock and type what you want — *"make the sound effects on this shot punchier"*, *"summarise the shots"*, *"put a flash on every downbeat in the chorus"*. Each request automatically carries the project, the shot you have selected and the playhead position, so "this shot" means what you think it means.

- **New task / Continue.** Start a fresh conversation, or pick up an earlier one where it left off. Conversations are saved **per project**, so next week's "continue" still knows what was done.
- **You see what it is doing.** Replies stream in as the agent works; every tool call is one line (*reading the project*, *analysing motion* …) with its elapsed time and ✓ or ✗.
- **Confirmation cards.** Reading and ordinary edits run straight away. Anything that **generates, deletes, exports or changes settings** stops at a card: *Run*, *Cancel*, or *Don't ask again in this task*. Saying "no need to confirm" in the chat does the same. You can turn confirmations back on at any time.
- **Pick the model per conversation.** Sonnet by default; Opus or Haiku when you want.
- **Undo works on the agent's edits too.** They go through the same API as your own, so ⌘Z takes them back.

**How it stays safe** ([ADR-0058](./docs/adr/0058-agent-chat-tab.md)). The tab starts the Claude Code CLI with only ixa's MCP tools — no shell or file tools of its own, and none of your own Claude settings or hooks. Every tool call passes through a permission check, and the answer to a confirmation is accepted **only from the screen**, never from the agent itself. Anything that touches a *different* project always asks, even after "don't ask again". The agent's access key is issued for one exchange, written only into its MCP config file (mode 600) — never to logs or the chat — and revoked when the exchange ends. Only one agent conversation runs per project at a time, so it never fights another one over the same edit.

### From Claude Code or Codex: the MCP server

`apps/mcp` is a stdio MCP server ([ADR-0049](./docs/adr/0049-mcp-server.md)) — a thin client of the same API — with **62 tools** that cover the whole job, from the song to telops, narration, lyrics, the sound mix and the exported file:

| Stage | Tools |
|---|---|
| Project | `ixa_status` · `set_ai` · `create_project` · `get_project` · `update_project` · `duplicate_project` · `import_from_project` |
| Music | `generate_music` · `upload_music` · `set_master_track` · `music_overview` |
| Shots and cast | `plan_shots` · `edit_shots` · `restructure_shots` · `draft_storyboard` · `create_character` · `edit_character` · `create_location` · `edit_location` · `manage_brand_assets` |
| Start frames | `draw_start_frames` · `set_start_frame` · `set_end_frame` · `list_start_frame_history` · `use_start_frame` · `retry_image` · `view` |
| Takes | `generate_takes` · `import_take` · `list_takes` · `adopt_take` · `review_take` · `hide_takes` · `upscale_takes` · `wait` · `cancel_jobs` · `align_to_music` |
| Telops and voice | `add_telops` · `list_telops` · `edit_clips` · `remove_telops` · `set_narration` · `speak_narration` · `set_lyrics` · `dub_takes` · `design_voice` |
| Effects and sound | `add_effects` · `list_effects` · `remove_effects` · `analyze_motion` · `suggest_sfx` · `generate_sfx` · `upload_sfx` · `list_sfx` · `remove_sfx` · `edit_audio` |
| Delivering | `export` · `export_thumbnail` |
| History | `list_edits` · `undo` |

**`view` is the agent's eyes.** It returns start frames and frames sampled from a take *as images*, so the agent can look at what it made and redraw a broken hand or a melting car before moving on. `export_thumbnail` hands back the finished JPEG the same way.

> "Make a 60-second 16:9 short: a night street race, then the two drivers at dawn."

The first test — a 62-second, 16-shot short made entirely through these tools, music included — took about four hours on one local GPU. Long jobs never block a call: the agent queues them and polls with `wait`, which always returns within its time limit.

Register it with Claude Code (the access key comes from your shell environment; never write it into the file):

```json
{
  "mcpServers": {
    "ixa": {
      "command": "/path/to/ixa-video-creator/apps/mcp/node_modules/.bin/tsx",
      "args": ["/path/to/ixa-video-creator/apps/mcp/src/main.ts"],
      "env": {
        "IXA_API_URL": "http://127.0.0.1:3001",
        "IXA_WORKSPACE_ID": "${IXA_WORKSPACE_ID}",
        "IXA_API_TOKEN": "${IXA_API_TOKEN}"
      }
    }
  }
}
```

`IXA_API_TOKEN` is an automation key issued on the *Access keys* page (アクセス用の鍵) ([ADR-0046](./docs/adr/0046-passphrase-and-access-tokens.md)) and revocable at any time. Codex setup and the rest: [apps/mcp/README.md](./apps/mcp/README.md).

`pnpm ixa mcp --claude` (or `--codex`) prints the exact registration line for this clone, with your workspace id filled in and no key in it; add `--write` to register it.

## Music first

Most AI video tools begin with a text prompt, hand you a clip, and leave you to slide music underneath afterwards. This one runs the other way round.

**The finished track is the input.** You drop a song onto the window, it is analysed with librosa — beats, downbeats, drops, three-band RMS — and from that moment the song *is* the timeline:

- the film's length is the song's length; there is nothing to overrun
- every cut is a position in the waveform, placed while listening to it
- a shot's duration is a consequence of where you cut, and that duration is what gets sent to the video model
- if the song has lyrics, you tap the start of each line while it plays, and the lines become timed captions — checked on a black screen before a single frame is generated

The work is *edit against the music, then fill each slot* — never *generate clips and hope they fit*. The first film made with it is a 1m56s music video in 27 shots.

No song yet? **Make a song** writes one on your Mac: Stable Audio 3 for instrumental BGM (the default), ACE-Step 1.5 when you want vocals and lyrics, or MiniMax-Music3. The result lands in the project as a track and is analysed like any other.

![Cutting while listening: section boundaries placed as cuts in one click, with the cuts they make](./docs/images/cutter.jpg)

## From an empty project to the exported file

A bar under the menu walks you through the whole job and always highlights the next step. Each step shows ✓ when it is done, or how far along it is.

![The production flow bar: song, direction, lyric timing, captions, cut into shots and storyboard are done; frames are at 40 of 44 and highlighted as the next step; takes at 7 of 44; export done](./docs/images/flow-bar.png)

1. **Song** — drop an audio file, or make one; it is analysed for beats, downbeats and sections.
2. **Direction** — concept, synopsis, lyrics and the look (style, light, texture), plus things to avoid and reference images. Added to every generation, so you write them once.
3. **Lyric timing** — play the song and press Enter on the first syllable of each line.
4. **Captions** — the timed lines become text clips, previewed over black so you can check timing without paying for any pictures.
5. **Narration** (optional) — have an AI voice read your lines, or record your own and let it be transcribed into lines and captions. Noise removal is on by default and can be skipped per recording. The music ducks under the voice.
6. **Cut into shots** — place cuts while listening (Enter works anywhere, cuts snap to the beat), or in one click at section boundaries or lyric starts.
7. **Storyboard** — an AI drafts a description, a mood **and a camera** for every shot, each with *why this picture*. Nothing changes until you adopt a draft.
8. **Frames** — an AI draws each shot's start frame with the cast's reference images, and checks its own work (below).
9. **Takes** — the video for each shot, made from its start frame, with queue position, elapsed time and an estimate.
10. **Export** — H.264, the whole film or selected shots, into `~/Movies/ixa-video-creator/<project>/`. Plus a YouTube thumbnail.

Skipping a step is allowed, but you are asked first.

## Sound, finish and second opinions

### Sound effects that land on the picture

![The "make sound effects" window for one shot: a motion curve of the adopted take with peaks marked in yellow, labelled events such as "engine and road noise in the cabin", "turning the wheel", "tyre squeal" and "body lurch", and one editable row per cue with time, length, volume and an English prompt](./docs/images/sfx-from-motion.jpg)

*＋ Sound effect* analyses the adopted take's motion ([ADR-0054](./docs/adr/0054-motion-analysis-for-sfx.md)): how much the picture changes frame to frame, where it suddenly jumps, and — by showing Claude twelve frames from the take — *what* is happening. You get one row per event with a time, a length and an English prompt; edit them, untick what you don't want, and Stable Audio 3 makes the sounds on your Mac and places them on the SFX lane. Instant sounds are snapped to the nearest motion peak, and you can ask for a sound's loudest moment to sit exactly on the event. On a test shot, all eight hand-placed footstep landings fell within ±0.1 s of a detected peak. Warm, Stable Audio makes a 10-second sound in about half a second on an M5 ([ADR-0052](./docs/adr/0052-sound-effects-with-local-stable-audio.md)).

Your own sound files can go on the SFX lane too ([ADR-0056](./docs/adr/0056-uploaded-sound-effects.md)), and voices, songs and sound effects can be imported from other projects ([ADR-0053](./docs/adr/0053-import-voices-music-sfx.md)).

### A timeline with layers

![The NIGHT RUN trailer in the workbench: storyboard and shot list above, and a timeline below with lanes for the music waveform, the video shots, transitions, narration, three caption layers, effects and a sound-effect lane full of clips with faint motion markers](./docs/images/workbench-layers.jpg)

Music, video, transitions, narration, captions, effects and sound effects each get their own lane, in that order. Clips that overlap in time spread onto extra rows instead of hiding each other. **Effects** are eight ready-made templates — flash, light leak, speed lines, film burn, glitch, title card, shake and zoom punch — chosen by type and strength rather than written as prompts, so the preview and the export draw the same frame ([ADR-0050](./docs/adr/0050-effect-templates.md)). Almost every edit — clips, shots, transitions, captions, styles, characters, music — can be undone with **⌘Z**, and the change history sits in its own tab.

### The AI checks its own pictures — and asks before re-shooting video

- **Start frames** ([ADR-0055](./docs/adr/0055-image-check-and-retry.md)): Claude looks at each new picture for broken anatomy, melted objects, nonsense text, the wrong person or a missing subject. With a local image model, an obvious failure is redrawn automatically (up to twice by default); every attempt is kept, and you can go back to an earlier one. When the text AI is not Claude, the check is skipped and the frame is marked *not checked* — never silently passed.
- **Takes** ([ADR-0057](./docs/adr/0057-video-retake-by-request.md)): a failed review marks the take *retake recommended* instead of spending another ten minutes of GPU on its own. Tick *retake automatically if NG* when you queue an overnight batch, and it reviews and re-shoots up to the limit.
- **Upscaling** shows in the shot list and the storyboard as *waiting* or *upscaling*, so an overnight run is readable at a glance.

### The thumbnail, too

*File → Export thumbnail…* draws a 1280×720 JPEG under 2 MB from the same Remotion composition as the film ([ADR-0051](./docs/adr/0051-youtube-thumbnail.md)): the frame at the playhead, a shot's picture, or key art the AI paints for it, with the title placed in a 3×3 grid, sizes and colours you choose, and an optional accent bar.

### Choosing which AI does what

![The "which AI to use" dialog on the Music tab: on the left, the current choice for text, images, video, voice, transcription, music and sound effects; on the right, ACE-Step 1.5, MiniMax-Music3 and Stable Audio 3 Medium (instrumental, selected), each tagged "this Mac" and "free", with notes on speed and limits](./docs/images/ai-chooser.jpg)

The first time you open the workbench, *使う AI* (which AI to use) looks for AI CLIs, API keys and local generation servers on this Mac and lets you pick one for each job:

| Purpose | Choices |
|---|---|
| Text — storyboard drafts, writing help, reviews, image checks, the agent tab | Claude Code · Codex · Grok |
| Images — start frames, character sheets, key art | Codex · FLUX.2 [klein] (local, free) |
| Video — takes | still-motion (free) · MiniMax H3 (local, free) · Wan 2.2 5B (local, free) · Seedance via fal (paid) |
| Voice — narration | Mac voice (free) · Gemini API · ElevenLabs (paid) |
| Transcription — recorded narration into lines | whisper.cpp (local, free) · Gemini API · ElevenLabs (paid) |
| Music — *Make a song* | Stable Audio 3 Medium (instrumental) · ACE-Step 1.5 · MiniMax-Music3 (all local, free) |
| Sound effects | Stable Audio 3 · MOSS SFX v2 (local, free) |

Every job also has a stub (*お試し*) that runs without any AI. Paid paths must be enabled in `.env` before they can be chosen — the screen alone never opens a billing path.

## A 30-second spot, start to finish

The sample project is **LUNA BREW**, a fictional night coffee stand: a 30-second spot cut to a 120 BPM track, nine shots, two recurring characters.

![Nine stills of the LUNA BREW spot: a rainy back street, a crescent-moon neon in a puddle, the barista pulling an espresso, latte art, the rider in the rain, the handoff at the counter, steam, and the two of them on a rooftop at dawn](./docs/images/luna-brew-stills.jpg)

These stills were made with an image model outside the app and brought in as each shot's **start frame** — which still works. The built-in `local/still-motion` model turns a start frame into a take — a slow push, pull or pan that follows the shot's camera setting — for free and without an API key.

| | |
|---|---|
| ![Playing the cut end to end: the preview player above the timeline](./docs/images/preview.jpg) | ![Take comparison: two takes of the same shot side by side on the same beats](./docs/images/take-compare.jpg) |
| **Preview is the render** — the player and the export share one composition. | **Compare takes on the beat** — two takes of a shot, looped over the shot's span. |
| ![The inspector: timing, camera, cast, location and start frame of a shot](./docs/images/inspector.jpg) | ![The library: a character's identity image and looks](./docs/images/library.jpg) |
| **One shot, everything in one place** — camera, cast with looks, location, start frame. | **Characters, looks, locations, brand** — per project, importable from other projects. |

## Why it might interest you

**The song's structure is data, not a picture of a waveform.** Beats and downbeats are numbers you can snap to, filter by and sort against. The tool shows where each shot sits relative to the beat *without calling it a mistake* — on the reference project 16 of 27 cuts are deliberately off the grid.

**Preview is the render.** The player, the exported file and the thumbnail consume the *same* `TimelineDocument` through the *same* Remotion composition. There is no separate preview path that can drift from the output.

**An agent is a first-class user, not a bolt-on.** The MCP tools are coarse, production-shaped steps over the same API the screen uses, every tool declares how risky it is, and everything an agent does lands as ordinary, reviewable, undoable work.

**Your footage is just files.** Frames, takes and renders are written to a folder on your disk (`STORAGE_DIR`), and one button copies a project's assets into `~/Movies/ixa-video-creator/<project>/素材/` under readable names in shot order — as hard links, so nothing is duplicated. The browser gets signed, expiring URLs, issued per request and never stored.

**AI drafts never overwrite your work.** Storyboard drafts sit next to the current description with a reason for each. Takes are append-only: generating again never replaces a previous result. Start frames keep their history.

**Built for keeping one character across a whole film.** Characters, looks, locations and brand assets resolve into each shot's reference images, rather than prompt text you retype 27 times and get subtly wrong.

**Money is treated as a first-class hazard.** Per-project budgets are enforced server-side before a job is enqueued. A local FFmpeg stub implements the whole `VideoProvider` interface, so queueing, polling, failure handling and the budget guard all run end to end at zero cost before you connect a paid API.

## Limits, honestly

- **It assumes an Apple Silicon Mac.** The free local models run through separate servers (vpipe-api, wan-api, klein-api, ace-step-api, sfx-api) built for Apple Silicon. Without them you are on stubs, Codex images, or paid APIs.
- **Local generation is slow, and it is one at a time.** All local models share one GPU, so video, images, upscaling, music and sound effects wait in a single line. Measured on an M5: a 5-second H3 draft takes 7.4 min; on the vertical short, takes at 576×1024 took about 10 min each; MiniMax-Music3 needs about 10 min per 60 seconds of song. Plan on overnight runs for a whole film.
- **Local models have their own limits.** Wan stops at 5 seconds. Text the model is told not to draw sometimes appears anyway. On the vertical short the local image model struggled with close-ups. Stable Audio cannot sing — vocals go to ACE-Step or MiniMax-Music3.
- **The agent tab needs the Claude Code CLI** as the text AI; it does not work with Codex or Grok, and it uses your Claude plan's usage. One conversation per project at a time; to add instructions mid-task you stop it and say it again; images cannot be attached yet. Confirmation relies on the CLI's permission hook; enforcing it in the API as well is designed but not built.
- **The MCP server is stdio only,** and an automation key can do anything the screen can — there are no per-key scopes yet.
- **Some edits are screen-only for now.** Over MCP you cannot yet work with sequences (chapters), change a shot's dialogue or lock after it is made, reorder shots, or place an image clip (a logo) on the timeline.
- **Image checks need Claude as well.** With Codex or Grok as the text AI, generated pictures are marked *not checked*.
- **There is no HTTPS.** On a LAN the passphrase travels in plain text. In Safari the preview can stutter at cuts; Chrome plays them smoothly.
- **It is a personal project.** Interfaces still move between versions.

## How it fits together

```
apps/
  web       Next.js workbench — dockable panels (storyboard, cutter, timeline, compare, agent chat)
  api       Hono + zod-openapi; also starts the agent's Claude CLI per conversation
  worker    BullMQ consumers: video, image, voice, music, sound effects, motion analysis, rendering
  audio     Python service — librosa analysis (beats, downbeats, sections, waveform)
  mcp       MCP server for AI agents (stdio) — a thin client of the API
packages/
  domain    Pure. No IO. The single source of truth for the model.
  providers Adapters (video / image / llm / voice / music / sfx). External SDKs and CLIs stop here.
  render    Remotion compositions (film and thumbnail) + FFmpeg plan
  db        Drizzle schema and repositories
```

The dependency direction is always `apps → packages → domain`, never back.

**Shot First.** Storyboard, generation, takes, review and the timeline all hang off one entity. A `Shot` owns its position on the master timeline — the position you gave it by cutting the song — so there is no second place where time can disagree. Time is stored in seconds as a float; frames and milliseconds never enter the domain or the database.

## Quick start

Requires a Mac with Node 22, pnpm 9, Docker Desktop, FFmpeg and [uv](https://docs.astral.sh/uv/) (uv brings Python 3.12 for the audio service). Optional: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex) or Grok CLI, signed in on the same Mac, for AI text and images — and Claude Code for the agent tab.

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install
pnpm ixa setup    # .env, signing key, postgres + redis, DB migrations, workspace, audio deps — safe to re-run

pnpm dev          # web :3000, api :3001, worker, audio :8100
```

`setup` never installs anything for you: if a tool is missing it prints the one line that installs it (`brew install ffmpeg`) and stops. `pnpm ixa doctor` shows the state of everything as ✓ / ! / ✗ with a one-line fix for each problem — keys only as set or not set. Both take `--json` for agents; [INSTALL.md](./INSTALL.md) is the runbook an agent follows, including where it must stop and ask you ([ADR-0063](./docs/adr/0063-ixa-cli-setup-doctor-update.md)).

Open <http://localhost:3000>, create a project, and drop an audio file onto the window — the flow bar takes it from there. **Out of the box everything runs on local stubs — no API keys, no cost.**

### Upgrading

```bash
pnpm ixa update           # to the latest release (--main for the tip of main)
pnpm ixa update --check   # only tell me whether there is one
```

It refuses to run with uncommitted changes, off `main`, while `pnpm dev` is running (stop it first, or `--while-running`), or while jobs (generation, export, images, music, sound effects, voices, upscaling, storyboard drafts, reviews, thumbnails, the agent) are running — `--force` lifts only the jobs check. If it stops halfway, fix the cause and run `pnpm ixa update --resume`. It fast-forwards to the release tag and installs dependencies, then hands over to the **new** version of itself to run `uv sync` and the DB migrations, list any `.env` items the new version added (it never writes values), link the release notes and run `doctor`. Restart `pnpm dev` afterwards.

### Connecting a paid provider

```bash
# .env
VIDEO_PROVIDER=fal            # default is `stub`
FAL_API_KEY=...
```

The switch is deliberate and separate from the key: having a key never enables billing on its own. Choosing `fal` without a key stops the worker at startup rather than silently falling back to the stub. Settings → *Connections and runtime* shows which keys are set (never their values) and whether the billing path is open.

### Generating on this Mac (optional)

Five local servers turn one Apple Silicon Mac into a free studio. Enable any of them, or all of them.

```bash
pnpm ixa ai install          # pick models by number, agree to each licence, then it installs, starts and wires them into .env
pnpm ixa ai install --plan   # just the list: size, memory, licence, and whether it runs on this Mac
```

Each server's own `setup` installs its engine and weights; ixa only asks what you want and calls it ([ADR-0064](./docs/adr/0064-select-and-install-local-ai.md)). To run the models on a **separate Mac**, run this there (only [uv](https://docs.astral.sh/uv/) is needed) then run `pnpm ixa ai connect` on your ixa Mac and paste the connection code it printed once (it is not echoed):

```bash
uv run https://raw.githubusercontent.com/kabatin/ixa-video-creator/<version>/tools/ixa-ai/ixa_ai.py install --lan
```

Or by hand: **start the server, list it in `.env`, pick it under *Which AI*.**

| Server | Makes | Models | Default address |
|---|---|---|---|
| [vpipe-api](https://github.com/kabatin/vpipe-api) | video, upscaling | MiniMax H3 Turbo, FlashVSR | `http://127.0.0.1:8765` |
| [wan-api](https://github.com/kabatin/wan-api) | video | Wan 2.2 TI2V-5B | `http://127.0.0.1:8766` |
| [klein-api](https://github.com/kabatin/klein-api) | images | FLUX.2 [klein] | `http://127.0.0.1:8767` |
| [ace-step-api](https://github.com/kabatin/ace-step-api) | songs | ACE-Step 1.5, MiniMax-Music3 | `http://127.0.0.1:8768` |
| [sfx-api](https://github.com/kabatin/sfx-api) | sound effects, BGM | Stable Audio 3, MOSS SFX v2 | `http://127.0.0.1:8769` |

```bash
# .env (default for each is `none`)
LOCAL_VIDEO_GENERATOR=vpipe,wan   # comma-separated
LOCAL_IMAGE_GENERATOR=klein
LOCAL_MUSIC_GENERATOR=ace_step
LOCAL_SFX_GENERATOR=sfx_api       # also enables Stable Audio BGM
VPIPE_API_URL=http://127.0.0.1:8765
VPIPE_API_TOKEN=                  # required only when the URL points off this machine
# WAN_ / KLEIN_ / ACE_STEP_ / SFX_ API_URL and API_TOKEN work the same way
```

<details>
<summary><b>Measured speeds and how each local path behaves</b></summary>

**Images** ([ADR-0047](./docs/adr/0047-local-flux2-klein-images-via-klein-api.md)): about 30 s per image; a fixed seed reproduces the picture.

**Songs** ([ADR-0048](./docs/adr/0048-generate-music-with-local-ace-step.md)): ACE-Step makes a 60-second song in about 40 s (up to ~1.5 min on the first run). Stable Audio 3 Medium makes instrumental BGM of 10–190 s; a request with vocals is routed to ACE-Step when it is enabled. MiniMax-Music3 sings too, but takes about 9 s per second of song and may end early. Only the master track plays in the preview and the export — the others are candidates.

**Sound effects** ([ADR-0052](./docs/adr/0052-sound-effects-with-local-stable-audio.md)): Stable Audio 3, warm on an M5, makes a 2-second sound in 0.37 s and a 10-second one in 0.53 s (3.2 s cold). MOSS is the slower fallback.

**Draft now, final overnight** ([ADR-0031](./docs/adr/0031-local-h3-video-via-vpipe-api.md), [ADR-0040](./docs/adr/0040-local-wan-2-2-video-via-wan-api.md)). Shoot every shot with the draft model (832×480), adopt the takes you like, then *remake at final quality* (1344×768) — same prompt, seed and start frame. The final take is appended next to the draft. Measured on an M5: a 2.7 s shot took 5.1 min as a draft and 14.0 min as a final. A different size draws a different picture — it is a re-shoot, not an upscale.

**Or keep the picture and upscale it** ([ADR-0044](./docs/adr/0044-upscale-takes-with-flashvsr.md)): FlashVSR sharpens an adopted take to 1920×1080 in about 5.5 min per shot, appended next to the original.

Measured on an M5 (10-core GPU, 32 GB), on AC power, 832×480 output, one 5-second clip:

| | H3 (draft) | Wan (draft) | Wan (standard) |
|---|---|---|---|
| time | **7.4 min** | 11.3 min | 19.4 min |
| frame 0 vs start image (SSIM) | 0.695 | **0.851** | 0.852 |

**H3 is faster; Wan holds the start frame.** Nothing here scores how the results look. Wan tops out at 5 seconds: a 5–7.5 s shot is generated at 5 s and slowed to fit, and beyond that ixa asks you to split the shot (H3 goes up to 10.125 s). With wan-api's `drawthings` backend a start image is rejected — use `mlx`, the default.

</details>

## Costs, honestly

Everything except fal, ElevenLabs and Gemini's paid tier is free to run: the stubs, `local/still-motion`, the five local servers, the Mac voice and whisper.cpp. Claude Code, Codex and Grok use whatever plan you are already signed in with — that includes the agent tab, image checks and motion analysis, whose cost the app records per conversation or per check.

For the reference project — 27 shots, 110.9 s of edited footage — Seedance 2.5 via fal.ai bills **140 s**, because the model's minimum clip is 4 seconds and 12 of those shots are shorter. At $0.3024/s that is **$42 for one take each**, or **$127 for three**. Short cuts and a 4-second minimum are a bad match; start with one take.

For scale on the free side: on the vertical short, Claude Code drafted the storyboard for seven shots in 2 min 18 s, recorded at $0.62 of plan usage.

## Status

Working end to end, from an empty project to an exported file and thumbnail — by hand in the workbench, by asking in the agent tab, or by an agent through MCP. Local images (klein), songs (ACE-Step, Stable Audio), sound effects (Stable Audio) and video (still-motion, MiniMax H3) are measured on real hardware and used for real work. **No clip has been generated from ixa through wan-api yet**: those numbers come from wan-api's own benchmarks and the adapter is covered by contract tests. The fal.ai / Seedance 2.5 adapter is tested against mocked responses, but its price and frame rate are **from documentation, not measured**, and are marked as such in the source.

## Security

**A passphrase guards the API once you set one** ([ADR-0046](./docs/adr/0046-passphrase-and-access-tokens.md)). Out of the box there is none, and the API listens on `127.0.0.1` only. Set `IXA_PASSPHRASE` (12+ characters) and every endpoint answers 401 until it is entered — it is **required** before the API will listen beyond this machine. Automation (Claude Code, Codex, the agent tab) gets its own revocable access keys. There is no HTTPS — do not expose it to a network you do not control. See [SECURITY.md](./SECURITY.md).

## Third-party licensing

This project is MIT. Some dependencies carry obligations that pass to **you** as the operator:

- **[Remotion](https://www.remotion.dev/docs/license)** is free for individuals and organisations of up to three people; **four or more requires a company license**, aggregated across collaborating parties. MIT on this repository does not waive that.
- Provider APIs (fal.ai, Gemini, ElevenLabs) bill you directly under their own terms. Claude Code, Codex and Grok run under your own accounts.
- The local models are not shipped with ixa; check each one before enabling it. **MiniMax H3** (MiniMax H3 Community License) restricts where and how the weights may be used. **Wan 2.2** is Apache-2.0. **FLUX.2 [klein]**: the 9B weights do not cover commercial use. **ACE-Step 1.5** is MIT. **MiniMax-Music3** (MiniMax-Music3 Community License) asks for its name to be shown prominently, which the app does. **Stable Audio 3** (Stability AI Community License) allows commercial use below US$1M annual revenue. **MOSS SFX v2** is Apache-2.0.

## Contributing

Issues, [discussions](https://github.com/kabatin/ixa-video-creator/discussions) and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Please read [AGENTS.md](./AGENTS.md) first: it documents the conventions this codebase actually enforces (immutability, zod at every boundary, no `any`, secrets only via env, append-only takes). `CLAUDE.md` holds the naming and wording rules, the [ADRs](./docs/adr/) record why things are the way they are, and [docs/LESSONS.md](./docs/LESSONS.md) collects the mistakes this project actually made — mostly variations on *a green test suite that was checking nothing*.

Run what CI runs before opening a PR:

```bash
npx turbo run lint typecheck test --concurrency=2
```

If this project is useful or interesting to you, a ⭐ helps other people find it.

## License

[MIT](./LICENSE) © Hiroshi Kabayama
