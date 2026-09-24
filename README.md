# iXA Video Creator

**An AI-native music-video workbench. Cut to the beat, generate each shot, and render what you previewed.**

[日本語版 README](./README.ja.md) · MIT licensed · TypeScript monorepo

![The workbench: storyboard, beat-accurate waveform cutter, and shot list](./docs/images/workbench.png)

---

Most AI video tools give you a prompt box and a clip. This one is built around the part
that actually takes the time: deciding **where** each cut lands, keeping a character
consistent across 27 of them, and getting a finished file out that matches what you saw
on screen.

It is a working tool, not a demo. The first film made with it is a 1m56s music video.

## Why it might interest you

**Preview is the render.** The player and the exported file consume the *same*
`TimelineDocument` through the *same* Remotion composition. There is no separate
"preview path" that can drift from the output — a class of bug that eats hours.

**Cut to the music, not to a grid.** Audio is analysed with librosa (beats, downbeats,
drops, 3-band RMS). You place cuts while listening; snapping to the beat is optional and
the tool tells you where each shot sits relative to the beat *without calling it a
mistake* — cutting to a vocal onset is a choice, not an error.

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

![Take comparison against the timeline, with per-shot inspector](./docs/images/timeline.png)

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
entity. A `Shot` owns its position on the master timeline, so there is no second place
where time can disagree. Time is stored in seconds as a float — never frames, never
milliseconds.

## Quick start

Requires Node 22, pnpm 9, Docker, FFmpeg, and Python 3.11+ for the audio service.

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install

cp .env.example .env          # defaults are safe: nothing bills
pnpm infra:up                 # postgres, redis, minio
pnpm db:migrate
pnpm db:seed

pnpm dev                      # web :3000, api :3001, worker
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

This project is MIT. Two dependencies carry obligations that pass to **you** as the
operator:

- **[Remotion](https://www.remotion.dev/docs/license)** is free for individuals and
  organisations of up to three people who operate it; **four or more requires a company
  license**, and headcount is aggregated across collaborating parties. MIT on this
  repository does not waive that.
- Provider APIs (fal.ai and others) bill you directly under their own terms.

## Contributing

Issues and pull requests are welcome. Please read [AGENTS.md](./AGENTS.md) first — it
documents the conventions this codebase actually enforces (immutability, zod at every
boundary, no `any`, secrets only via env, append-only takes). `CLAUDE.md` holds the naming
and wording rules.

Run what CI runs before opening a PR:

```bash
npx turbo run lint typecheck test --concurrency=2
```

## License

[MIT](./LICENSE) © Hiroshi Kabayama
