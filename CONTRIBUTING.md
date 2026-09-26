# Contributing

Thanks for taking an interest. Issues, discussions and pull requests are all welcome —
bug reports from actually cutting a video to music are the most valuable of all.

日本語での Issue・PR も歓迎します。

## Getting set up

Follow the [Quick start](./README.md#quick-start). Out of the box everything runs on local
providers — **no API keys and no cost** — including image-to-video from a start frame.

## Before you write code

Read [AGENTS.md](./AGENTS.md). It lists the conventions the codebase actually enforces:

- **Shot first** — storyboard, takes, review and the timeline all hang off `Shot`
- **Dependencies point one way** — `apps → packages → domain`; `packages/domain` has no IO
- **Immutability** — return new values, never mutate
- **zod at every boundary** — API input, provider responses, environment variables
- **Time is seconds as a float** — never milliseconds or frames in the domain or database
- **Takes are append-only** — never overwrite a generation result
- **No `any`, no `console.log`, secrets only via env**

`CLAUDE.md` holds naming and on-screen wording rules. [docs/LESSONS.md](./docs/LESSONS.md)
collects the mistakes this project actually made — mostly variations on *a green test suite
that was checking nothing*. Design decisions live in [docs/adr](./docs/adr).

## Tests

Domain logic (timing, beat snapping, reference resolution, routing) gets unit tests, and
provider adapters get contract tests against mocked responses. When you add a test, make sure
it **fails first** — break the implementation once and watch it go red.

Run what CI runs before opening a pull request:

```bash
npx turbo run lint typecheck test --concurrency=2
```

## Pull requests

- Keep a pull request to one change, and say *why* in the description
- Commit messages follow `type: description` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`)
- UI changes: include a screenshot
- Anything that could spend money (a real provider, a budget change) needs a note on how it was tested for free

## Where to start

Issues labelled [`good first issue`](https://github.com/kabatin/ixa-video-creator/labels/good%20first%20issue)
are small and self-contained. Questions and ideas are welcome in
[Discussions](https://github.com/kabatin/ixa-video-creator/discussions).

## Security

Do not open a public issue for a vulnerability — see [SECURITY.md](./SECURITY.md).
