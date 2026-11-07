-- Publication credit: one specific contribution, published with its author's consent after a
-- safety review. Lives in the ROSTER store because it names a person.

create table roster.publications (
  k           text primary key,
  seq         bigserial,
  doc         jsonb not null,
  expert_id   text not null,
  status      text not null check (status in ('proposed','consented','approved','published','declined','rejected','withdrawn')),
  source_kind text not null check (source_kind in ('dissent','post')),
  source_id   text not null,
  card_id     text not null,
  proposer    text not null,
  reviewer    text,
  -- the two-person rule, enforced by the database as well as the service
  check (reviewer is null or reviewer <> proposer),
  -- one publication per contribution
  unique (source_kind, source_id)
);
