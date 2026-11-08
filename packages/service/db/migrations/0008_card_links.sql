-- Analyst-authored links between questions: "this one is downstream of that one", with a stated mechanism and a rival
-- explanation. Never inferred. Lives with the answers because it names cards, not people.

create table answers.card_links (
  k            text primary key,
  seq          bigserial,
  doc          jsonb not null,
  from_card_id text not null references answers.cards(k),
  to_card_id   text not null references answers.cards(k),
  check (from_card_id <> to_card_id),
  unique (from_card_id, to_card_id)
);
