-- The optional "second look" (Round 2 only): which background arm each respondent
-- was assigned, and whether they opened it. Keyed like estimates (card + respondent
-- key, never a name), so it is personal data of the same kind: erased and retained
-- with the estimates it belongs to.

create table answers.second_look (
  k              text primary key,        -- '<card>|<respondent key>'
  seq            bigserial,
  doc            jsonb not null,
  card_id        text not null references answers.cards(k),
  respondent_key text not null,
  arm            text not null check (arm in ('control','balanced','acaps_view')),
  unique (card_id, respondent_key)
);
