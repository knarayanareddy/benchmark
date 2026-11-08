# Deploying the service

**Status: build, migration, service start-up and the `/api/config` check pass in CI (run 42463970811); Caddy/HTTPS, real SSO and backup/restore are not checked.** A `docker` workflow (`.github/workflows/docker.yml`, on changes to the `Dockerfile`, `deploy/`, or `packages/service/`) builds the image and smoke-tests the stack: Postgres, the migration, then the service from `deploy/docker-compose.yml` (Caddy is not started), checking that `GET /api/config` returns 200 within 60 seconds with exactly the four boolean keys. It also sets a throwaway blind-signing key and checks that `deviceKeys` is true, which proves the key-file mount works. Those secrets are generated on the runner and never committed. The first run found that the migration CLI failed at start-up (`packages/service/bin/migrate.mjs` connected a client, then `migrate()` connected it again); it now uses a pool, and the job passes.

**Not checked by CI:** Caddy and HTTPS (the certificate, the redirect, the 64 KB body limit), sign-in through a real identity provider (CI sets OIDC variables but never signs in), backup and restore, the upgrade path on a database that already holds data, and the risk browser's content (CI does not assert that the radar loads).

## What you need

- A host with Docker and a DNS name pointing at it (Caddy fetches and renews the certificate).
- An OpenID Connect provider for staff, and a client registered with redirect URI `https://<domain>/api/staff/oidc/callback`.
- Two secrets, and a place to keep copies **that is not the database or its backups**.

## Steps

```bash
cp deploy/.env.example deploy/.env      # fill in every value
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d db
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile tools run --rm migrate
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d app caddy
curl -fsS https://<domain>/readyz
```

`migrate` runs as the database owner. It applies the versioned migrations in `packages/service/db/migrations/` (each in its own transaction, checksummed, under an advisory lock), re-applies the least-privilege grants, creates the roles `bm_roster` and `bm_answers` and sets their passwords. Run it again on every upgrade; `node packages/service/bin/migrate.mjs --status` shows what is applied and what is pending. The service then runs as those two roles, never as the owner (`BENCHMARK_MIGRATE=0`), so it cannot create tables, and neither role can read the other's schema.

## Migrations

Forward-only. There is no `down`: a destructive change ships in two releases, **expand** (add the new column or table, write both, backfill) then, once nothing reads the old one, **contract** (a later migration drops it). Editing a migration that has been applied anywhere is refused (its checksum is recorded), so fix mistakes with a new file. A migration that fails rolls back completely and is not recorded.

## Optional features

With compose, name the key files in `deploy/.env` (`BLIND_KEY_FILE`, `BREAKGLASS_PUBLIC_KEY_FILE`) as host paths. Compose mounts each read-only into the app container at `/run/secrets/` and points the service at that path. Leave them empty to switch the feature off.

| Feature | Turn on | Leave off and |
|---|---|---|
| Device-held anonymous keys | `node packages/service/bin/blind-keygen.mjs > blind-key.pem`, set `BENCHMARK_BLIND_KEY` or `BENCHMARK_BLIND_KEY_FILE` (`deviceKeys` in `/api/config`) | the option is not offered |
| Two-moderator safety override | `node packages/service/bin/breakglass-keygen.mjs`, give the service only the **public** key (`BENCHMARK_BREAKGLASS_PUBLIC_KEY` or `BENCHMARK_BREAKGLASS_PUBLIC_KEY_FILE`), keep the private key offline with the moderators who may approve (`breakGlass` in `/api/config`) | there is no override, and the consent text says so |
| Sensitive-country list for publication credit | `BENCHMARK_SENSITIVE_COUNTRIES="TCD,SDN,..."` (ISO 3-letter codes) | a conservative default list applies; naming in those countries needs an extra acknowledgement |
| Risk browser data | `BENCHMARK_RADAR_FILE=/path/to/risk-radar.json` (the organisers' export as JSON) | the service reads `data/risk-radar.json`, which the image also contains; if that file is missing the browser is empty and the service still starts, with a warning |
| Demo mode | `BENCHMARK_DEMO=1` (see the warning below) | off: no try-the-demo entry, no demo accounts, no demo questions, no demo credentials |
| Presenter mode for a showcase | `BENCHMARK_DEMO_LABELS=0` with `BENCHMARK_DEMO=1` | the demo labels are shown: the banner, the notice in the join wizard, and the `DEMO:` prefix on objectives. Presenter mode hides labels only; it is not a safeguard, and it does not make a demo safe on a pilot database |

**What the join page is told.** `GET /api/config` returns exactly four booleans: `demo` (`BENCHMARK_DEMO=1`), `deviceKeys` (a blind-signature key is configured: `BENCHMARK_BLIND_KEY` or `BENCHMARK_BLIND_KEY_FILE`), `breakGlass` (a break-glass public key is configured: `BENCHMARK_BREAKGLASS_PUBLIC_KEY` or `BENCHMARK_BREAKGLASS_PUBLIC_KEY_FILE`) and `demoLabels` (demo on and not presenter mode: `BENCHMARK_DEMO_LABELS` is not `0`). No key material is returned. The device-held option in the join wizard is offered only when `deviceKeys` is true, and the anonymous safety line describes the override only when `breakGlass` is true; otherwise it says nobody at ACAPS can open an objection (`docs/13-onboarding.md`). A key added later changes the text shown to people who join afterwards; a consent already given keeps the text and hash it was accepted with.

**Demo mode must never run on a real pilot database, and never on a public URL that real experts use.** With `BENCHMARK_DEMO=1` the service seeds a synthetic panel and demo questions into whatever database it is given and lets anyone open an account without an invite. It also registers two moderator credentials for the showcase: random per boot (or exactly two values in `BENCHMARK_DEMO_STAFF_CREDENTIALS`), printed to the server console only and never served over HTTP. They work only when OIDC is not configured (`OIDC_ISSUER` unset). Anyone who can read the console or the log can sign in as a moderator, so keep that log private. With `DATABASE_URL` set the service refuses to start unless `BENCHMARK_DEMO_ALLOW_DATABASE=1` is also set. Demo data is labelled, but only the second-look analysis skips it: it still flows through released aggregates (`docs/05-service-and-privacy.md`), which is why a demo deployment must not share a database with a pilot.

**The risk radar is copied into the container image.** The `Dockerfile` copies `data/risk-radar.json` (the organisers' export, already in the repository) to `/app/data/`, and `.dockerignore` re-includes that one file while excluding the rest of `data/`. The compose file needs no radar mount. To use a different export, set `BENCHMARK_RADAR_FILE` to a path inside the container and mount that file there (for example a read-only bind mount or a Docker secret). The service never serves the file itself. CI builds the image but does not check that the copy is there or loads.

Who maintains the sensitive-country list, who moderates the roundtable, and who is the second reviewer of a publication are decisions for ACAPS, not settings (`docs/09-roundtable-and-credit.md`).

Decide both before inviting anyone: the consent text an expert accepts describes what the deployment can do at that moment, and a hash of it is stored with their consent.

## The apps

`packages/web` is built by Vite (`npm run build -w @benchmark/web`; the Dockerfile does it) and served by the service at `/` (experts) and `/staff`. They are installable (a web app manifest and PNG icons) and the shell works offline through a service worker that never touches `/api/*`: no answer, token or ballot is cached by it. Answers given offline wait in the phone's IndexedDB and are sent on reconnect. Because the pages and the worker are served `no-cache`, a deploy reaches installed apps on their next visit. Installing needs HTTPS (Caddy provides it) and has not been tried on a physical phone.

## Do not rotate the ballot secret in the middle of a round

`BENCHMARK_BALLOT_SECRET` keys the anonymous ballot tokens **and** the random assignment of second-look arms (`docs/08-second-look.md`). Changing it moves every expert to a new arm and breaks the comparison, and for service-held anonymous experts it also stops their earlier answers being found for revision, export or erase. Rotate only between experiments, with all rounds closed.

## Secrets

| Variable | What it protects | If you lose it |
|---|---|---|
| `BENCHMARK_BALLOT_SECRET` | The key behind anonymous ballot tokens | Anonymous answers can no longer be matched to their authors, so they cannot be revised, exported or erased on request |
| `BENCHMARK_ALIAS_SECRET` | New pseudonyms | Existing aliases are stored and keep working; only new experts are affected |

Both must be at least 16 characters and different from each other; the service refuses to start otherwise. Keep them out of the database, its backups and the repository. Anyone holding a ballot secret **and** the roster can re-link anonymous answers. That residual risk is stated to experts on the consent screen.

## Before real experts are invited

- [ ] Run the migration and the service as above, and read `docs/05-service-and-privacy.md`.
- [ ] `BENCHMARK_DEMO` is unset, and the start-up log shows no "DEMO MODE" line.
- [ ] The risk radar is loaded: the start-up log has no "no radar loaded" warning, and `GET /api/risks` returns risks.
- [ ] Sign in as staff through your real identity provider (this path has only met a fake one).
- [ ] Test backup and restore of the database, and store the secrets (and the blind key) separately from it.
- [ ] Have a cryptographer review `packages/core/src/blind.js` before offering device-held keys, or leave `BENCHMARK_BLIND_KEY` unset.
- [ ] Open the app on a real phone over HTTPS, install it, switch to airplane mode, answer, reconnect.
- [ ] Complete the DPIA and the data-sharing agreement. See `docs/06-protocol.md`.
- [ ] Have counsel read the consent text (`packages/service/src/consent.js`).
- [ ] Write the card objectives: `npm run worklist`, fill the `author_*` columns, then `node scripts/authoring-worklist.mjs --import <file> --out data/authored-cards.json`.

## Without Postgres (a one-machine trial only)

Set `BENCHMARK_DATA_DIR` instead of `DATABASE_URL` and the service keeps JSON snapshots there. It is enough to try the pages; it has no role separation and no constraints, so do not use it for real experts.
