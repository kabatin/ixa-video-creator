# Security

## Read this before you expose it

**This application has no authentication or authorisation. None.** There are no users, no
logins, no tokens. Anyone who can reach the HTTP port has full control.

That is a deliberate scope decision — it is a single-operator tool that runs on the
machine of the person editing the film — but it means the deployment model matters more
than it usually would.

### What an attacker on the same network could do

If you bind the API to a reachable address, anyone on that network can:

- delete projects, shots and timeline data
- **enqueue generation jobs that bill your provider account**
- read every asset in the storage bucket through signed URLs the API hands out
- change the project budget, removing the only spending limit

There is no rate limiting and no audit trail of who did what.

### Defaults

| | Default | Notes |
|---|---|---|
| API (`:3001`) | `127.0.0.1` | Set `API_HOST` to change. A warning is logged when it is not loopback. |
| Web (`:3000`) | Next.js default | `next dev` listens on all interfaces. Bind or firewall it yourself if that matters. |
| Video provider | `stub` | No billing until `VIDEO_PROVIDER=fal`. |

**Do not put this on the public internet.** If you need access from another device, put it
behind something that authenticates — a reverse proxy with auth, a VPN, or an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 -L 3001:localhost:3001 you@your-machine
```

## Secrets

Secrets live in `.env` only, read through a zod schema in `packages/config`. They are never
written to the database and never sent to the browser.

The settings screen shows whether a key is configured and how many characters it is — never
the value, not even the last few characters. `GET /environment` is read-only by design and
there is deliberately **no endpoint that accepts a key**, because such an endpoint on an
unauthenticated API would let anyone on the network swap your billing credentials.

Signed URLs are treated the same way: issued on demand, never persisted, and never included
in log lines or exception messages.

If you think a key has leaked, rotate it at the provider. Nothing in this repository can
invalidate it for you.

## Cost as a safety property

Generation spends money, so it is guarded like a destructive operation:

- per-project budgets are checked server-side **before** a job is enqueued
- the failure path releases the shot instead of leaving it stuck as "generating"
- a transient provider error re-queues the poll rather than discarding a paid generation
- the local stub can be given a fake price (`STUB_VIDEO_COST_PER_SEC`) so you can verify
  the budget guard actually stops a run without spending anything

If you change any of this, please keep the guarantee that **a key being present is not
enough to start billing** — the `VIDEO_PROVIDER` switch has to be flipped deliberately.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something that should not be public
first, use GitHub's private vulnerability reporting on this repository.

Please do not report "the API has no authentication" — it is documented here and is a known
property of the current scope. Reports about *unintended* exposure (a secret reaching a
response body or a log, a path that escapes its bucket, an injection) are very welcome.
