# Deploying the service

**Status: written, not run.** Docker was not available where this was developed, so the `Dockerfile` and `deploy/` files have never been built or executed. What *was* run: the service against a real Postgres wire protocol (the `pg` client), the migration SQL and role grants on a Postgres engine, and the pages in a browser against the Node process. Treat the container files as a starting point to test, not a tested artefact.

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

`migrate` runs as the database owner, creates the schema and the roles `bm_roster` and `bm_answers`, and sets their passwords. The service then runs as those two roles, never as the owner (`BENCHMARK_MIGRATE=0`), so it cannot create tables, and neither role can read the other's schema.

## Secrets

| Variable | What it protects | If you lose it |
|---|---|---|
| `BENCHMARK_BALLOT_SECRET` | The key behind anonymous ballot tokens | Anonymous answers can no longer be matched to their authors, so they cannot be revised, exported or erased on request |
| `BENCHMARK_ALIAS_SECRET` | New pseudonyms | Existing aliases are stored and keep working; only new experts are affected |

Both must be at least 16 characters and different from each other; the service refuses to start otherwise. Keep them out of the database, its backups and the repository. Anyone holding a ballot secret **and** the roster can re-link anonymous answers. That residual risk is stated to experts on the consent screen.

## Before real experts are invited

- [ ] Run the migration and the service as above, and read `docs/05-service-and-privacy.md`.
- [ ] Sign in as staff through your real identity provider (this path has only met a fake one).
- [ ] Test backup and restore of the database, and store the secrets separately.
- [ ] Complete the DPIA and the data-sharing agreement. See `docs/06-protocol.md`.
- [ ] Have counsel read the consent text (`packages/service/src/consent.js`).
- [ ] Write the card objectives: `npm run worklist`, fill the `author_*` columns, then `node scripts/authoring-worklist.mjs --import <file> --out data/authored-cards.json`.

## Without Postgres (a one-machine trial only)

Set `BENCHMARK_DATA_DIR` instead of `DATABASE_URL` and the service keeps JSON snapshots there. It is enough to try the pages; it has no role separation and no constraints, so do not use it for real experts.
