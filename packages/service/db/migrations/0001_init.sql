-- Benchmark: Postgres schema for packages/service (see src/pg-store.js).
--
-- Two schemas on purpose. `roster` says WHO; `answers` says WHAT. No role has a
-- join privilege across them, so a reader of answers cannot re-link to people.
--
-- Every table has `k` (the store key), `seq` (insertion order), `doc` (the full
-- document the service reads back) and typed columns that exist to ENFORCE the
-- rules in the database as well as in the code: unique ballots, clamped
-- probabilities, the release floor, an immutable audit log.

create schema if not exists roster;
create schema if not exists answers;

-- ── roster ──────────────────────────────────────────────────────────────
create table roster.experts (
  k           text primary key,
  seq         bigserial,
  doc         jsonb not null,
  level       text check (level in ('identified','pseudonymous','anonymous')),
  declaration jsonb not null,
  created_at  timestamptz not null,
  -- an empty Declaration would match every card
  constraint declaration_has_country check (jsonb_array_length(declaration->'countries') >= 1)
);

create table roster.invites (
  k          text primary key,             -- sha256 of a 256-bit token; the token is never stored
  seq        bigserial,
  doc        jsonb not null,
  expert_id  text not null,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table roster.sessions (
  k          text primary key,
  seq        bigserial,
  doc        jsonb not null,
  expires_at timestamptz not null
);

-- One persisted alias per expert x country: a secret rotation cannot rename anyone.
create table roster.aliases (
  k         text primary key,
  seq       bigserial,
  doc       jsonb not null,
  expert_id text not null,
  country   text not null,
  alias     text not null,
  unique (expert_id, country),
  unique (country, alias)
);

-- ── answers ─────────────────────────────────────────────────────────────
create table answers.cards (
  k                 text primary key,
  seq               bigserial,
  doc               jsonb not null,
  parent_id         text,
  status            text not null check (status in ('open','closed','retired','resolved')),
  round             integer not null check (round in (1,2)),
  country           text not null,
  win_from          date not null,
  win_to            date not null check (win_to >= win_from),
  objective         text not null check (length(trim(objective)) > 0),
  resolution_source text not null check (resolution_source in ('ACLED','IPC','UNHCR','IMF','official_decree')),
  resolver          text not null check (length(trim(resolver)) > 0),
  seed_p            double precision not null check (seed_p between 0 and 1),
  evidence_url      text check (evidence_url is null or evidence_url like 'https://%')
);

-- unique(card, respondent, round) is the ballot-stuffing guard.
-- respondent_key is 'id:<expert>' or an HMAC ballot token; anonymous rows carry no expert id.
create table answers.estimates (
  k              text primary key,
  seq            bigserial,
  doc            jsonb not null,
  card_id        text not null references answers.cards(k),
  respondent_key text not null,
  round          integer not null check (round in (1,2)),
  expert_id      text,
  level          text not null,
  p              double precision not null check (p between 0.01 and 0.99),
  unique (card_id, respondent_key, round),
  check (level <> 'anonymous' or expert_id is null)
);

-- The release ledger: the memory a pure function cannot have. One row per
-- published snapshot; a concurrent duplicate loses to the unique constraint.
create table answers.releases (
  k          text primary key,
  seq        bigserial,
  doc        jsonb not null,
  card_id    text not null references answers.cards(k),
  round      integer not null,
  visibility text not null check (visibility in ('panel','public')),
  n          integer not null check (n >= 5),
  closed     boolean not null,
  unique (card_id, round, visibility, n, closed)
);

create table answers.dissents (
  k         text primary key,
  seq       bigserial,
  doc       jsonb not null,               -- carries `version`; updates are compare-and-set on it
  card_id   text not null references answers.cards(k),
  expert_id text,                         -- null for anonymous
  level     text not null,
  status    text not null check (status in ('open','routed','actioned','notified','closed')),
  check (level <> 'anonymous' or expert_id is null)
);

create table answers.notifications (
  k         text primary key,
  seq       bigserial,
  doc       jsonb not null,
  expert_id text not null
);

create table answers.audit (
  k        text primary key,
  seq      bigserial,
  doc      jsonb not null,
  actor_id text not null,
  action   text not null
);

-- The audit log is append-only: refuse any change, even from the table owner.
create function answers.audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'answers.audit is append-only';
end $$;
create trigger audit_no_update before update or delete on answers.audit
  for each row execute function answers.audit_immutable();
create trigger audit_no_truncate before truncate on answers.audit
  for each statement execute function answers.audit_immutable();

-- ── roles (run as a superuser; names are examples) ──────────────────────
-- bm_web:     insert estimates; select cards and the release ledger. No SELECT on
--             answers.estimates: statistics leave only through answers.releases.
-- bm_release: select estimates, insert releases (the cardRelease() choke point).
-- bm_roster:  roster only. No role is granted usage on both schemas' tables.
-- create role bm_web; create role bm_release; create role bm_roster;
-- grant usage on schema answers to bm_web, bm_release; grant usage on schema roster to bm_roster;
-- grant select on answers.cards, answers.releases to bm_web;
-- grant insert on answers.estimates to bm_web;
-- grant select on answers.estimates, answers.cards to bm_release; grant insert on answers.releases to bm_release;
-- grant all on all tables in schema roster to bm_roster;
