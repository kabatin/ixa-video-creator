# Security

## Read this before you expose it

**There is one passphrase and no user accounts** (ADR-0046). It is a single-operator tool that
runs on the machine of the person editing the film.

- **The passphrase is optional while the API listens on loopback only** (the default). Without
  one, the login screen signs you in without asking. **It is required to listen beyond this
  machine**: with a non-loopback `API_HOST` and no `IXA_PASSPHRASE`, the API refuses to start.
- With a passphrase set, the API answers 401 to everything except `/health`, signed `/files/*`
  URLs and the login itself until you enter `IXA_PASSPHRASE` (12+ characters).
- A login issues a random session key; only its hash is stored. The key lives in an HttpOnly,
  SameSite=Lax cookie for 30 days. Automation gets separate access tokens sent as a Bearer
  header, and either kind can be revoked.
- Cookie-authenticated writes must come from an origin listed in `CORS_ORIGINS`.
- Five wrong passphrases from one address within 15 minutes are answered with 429.

**There is no HTTPS.** On a LAN the passphrase and the session cookie travel in plain text,
so anyone who can watch that network can take over the session. Treat the passphrase as a
lock against casual access, not as protection on a network you do not trust.

### What an attacker could do with the passphrase or a session

Anyone holding either can:

- delete projects, shots and timeline data
- **enqueue generation jobs that bill your provider account**
- read every asset in the storage bucket through signed URLs the API hands out
- change the project budget, removing the only spending limit

There is no audit trail of who did what.

### Defaults

| | Default | Notes |
|---|---|---|
| API (`:3001`) | `127.0.0.1` | Set `API_HOST` to change. A warning is logged when it is not loopback. |
| Web (`:3000`) | Next.js default | `next dev` listens on all interfaces. Bind or firewall it yourself if that matters. |
| Video provider | `stub` | No billing until `VIDEO_PROVIDER=fal`. |

**Do not put this on the public internet.** If you need access from another device over a
network you do not control, use a VPN or an SSH tunnel:

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

Please do not report "the LAN traffic is not encrypted" — it is documented here and is a known
property of the current scope. Reports about *unintended* exposure (a secret reaching a
response body or a log, a path that escapes its bucket, an injection) are very welcome.
