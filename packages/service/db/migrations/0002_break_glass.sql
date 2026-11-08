-- Break-glass: a two-person, audited, notify-afterwards override that opens the
-- sealed identity on one anonymous objection when there is a serious safety or
-- legal concern. The database holds only the request trail, never an identity.

create table answers.break_glass (
  k          text primary key,
  seq        bigserial,
  doc        jsonb not null,
  dissent_id text not null,
  status     text not null check (status in ('requested','approved','denied','collected','expired')),
  category   text not null check (category in ('safety_threat','safety_welfare','legal_obligation')),
  requester  text not null,
  approver   text,
  -- the two-person rule, enforced by the database as well as the service
  check (approver is null or approver <> requester)
);
-- at most one live request per objection
create unique index break_glass_one_live on answers.break_glass (dissent_id) where status in ('requested','approved');

-- Told afterwards: kept in the ROSTER, because it names an expert and must not sit next to answers.
create table roster.notices (
  k         text primary key,
  seq       bigserial,
  doc       jsonb not null,
  expert_id text not null
);
