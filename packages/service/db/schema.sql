-- Benchmark: Postgres schema mirroring packages/service/src/store.js.
-- Two schemas on purpose. `roster` says WHO; `answers` says WHAT. No role has a
-- join privilege across them, so a reader of answers cannot re-link to people.

create schema if not exists roster;
create schema if not exists answers;

-- ── roster ──────────────────────────────────────────────────────────────
create table roster.experts (
  id          text primary key,
  name        text,
  declaration jsonb not null,
  level       text check (level in ('identified','pseudonymous','anonymous')),
  consent     jsonb,                       -- { version, textHash, at }
  created_at  timestamptz not null,
  -- an empty Declaration would match every card (B-13)
  constraint declaration_has_country check (jsonb_array_length(declaration->'countries') >= 1)
);

create table roster.invites (
  token_hash text primary key,             -- sha256 of a 256-bit token; the token is never stored
  expert_id  text not null references roster.experts(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  version    integer not null default 0
);

create table roster.sessions (
  token_hash text primary key,
  subject    jsonb not null,               -- { kind:'expert', expertId } | { kind:'staff', id, role }
  expires_at timestamptz not null
);

-- One persisted alias per expert x country: a secret rotation cannot rename anyone.
create table roster.aliases (
  expert_id text not null references roster.experts(id) on delete cascade,
  country   text not null,
  alias     text not null,
  primary key (expert_id, country),
  unique (country, alias)
);

-- ── answers ─────────────────────────────────────────────────────────────
create table answers.cards (
  id                text primary key,
  version           integer not null default 0,
  parent_id         text references answers.cards(id),
  status            text not null check (status in ('open','closed','retired','resolved')),
  round             integer not null check (round in (1,2)),
  statement         text not null,
  country           text not null,
  region            text,
  theme             text,
  win_from          date not null,
  win_to            date not null check (win_to >= win_from),
  objective         text not null check (length(trim(objective)) > 0),
  resolution_source text not null check (resolution_source in ('ACLED','IPC','UNHCR','IMF','official_decree')),
  resolver          text not null check (length(trim(resolver)) > 0),
  seed_p            double precision not null check (seed_p between 0 and 1),
  outcome           text check (outcome in ('0','1','unobservable')),
  evidence_url      text check (evidence_url is null or evidence_url like 'https://%'),
  retired_by        text,
  created_day       date not null,
  resolved_day      date
);

-- unique(card, respondent, round) is the ballot-stuffing guard (B-06).
-- respondent_key is 'id:<expert>' or an HMAC ballot token; anonymous rows carry no expert id.
create table answers.estimates (
  card_id        text not null references answers.cards(id),
  respondent_key text not null,
  round          integer not null check (round in (1,2)),
  expert_id      text,
  level          text not null,
  p              double precision not null check (p between 0.01 and 0.99),
  at             timestamptz not null,
  primary key (card_id, respondent_key, round),
  check (level <> 'anonymous' or expert_id is null)
);

-- The release ledger: the memory a pure function cannot have (B-05).
create table answers.releases (
  id         bigserial primary key,
  card_id    text not null references answers.cards(id),
  round      integer not null,
  visibility text not null check (visibility in ('panel','public')),
  n          integer not null check (n >= 5),
  closed     boolean not null,
  at         timestamptz not null,
  snapshot   jsonb not null
);

create table answers.dissents (
  id          text primary key,
  version     integer not null default 0,    -- update ... where id=? and version=?
  card_id     text not null references answers.cards(id),
  expert_id   text,                          -- null for anonymous
  by          text not null,
  level       text not null,
  contactable boolean not null,
  kind        text not null,
  body        text not null,
  status      text not null check (status in ('open','routed','actioned','notified','closed')),
  doc         jsonb not null,                -- the full state-machine record
  created_day date not null,
  check (level <> 'anonymous' or expert_id is null)
);

create table answers.notifications (
  id         bigserial primary key,
  expert_id  text not null,
  dissent_id text not null,
  doc        jsonb not null,
  at         timestamptz not null
);

create table answers.audit (
  id        bigserial primary key,
  at        timestamptz not null,
  actor_id  text not null,
  role      text not null,
  action    text not null,
  target    text not null default '',
  reason    text not null default ''
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
