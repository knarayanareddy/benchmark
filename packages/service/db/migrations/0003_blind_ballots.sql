-- Device-held ballots: the server records THAT an expert asked for a blind-signed
-- token for a card (at most once), never which token it was. The blinded value is
-- unlinkable to the token the device later submits. Kept in the roster, not with answers.

create table roster.issuances (
  k         text primary key,
  seq       bigserial,
  doc       jsonb not null,
  expert_id text not null,
  card_id   text not null,
  unique (expert_id, card_id)
);
