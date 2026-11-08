-- Roundtable: one moderated thread per card, between Round 1 and Round 2.
-- Posts hold a respondent key (never a name), exactly like estimates do. A post is invisible to
-- other experts until a moderator approves it.

create table answers.thread_posts (
  k              text primary key,
  seq            bigserial,
  doc            jsonb not null,
  card_id        text not null references answers.cards(k),
  respondent_key text not null,
  status         text not null check (status in ('pending','approved','rejected')),
  kind           text not null check (kind in ('claim','evidence','counter','question','missing_risk','reply')),
  parent_id      text,
  -- a reply has a parent and nothing else does
  check ((kind = 'reply') = (parent_id is not null))
);

-- "Participant N": the same person is the same number within one thread, and nowhere else.
create table answers.thread_participants (
  k              text primary key,
  seq            bigserial,
  doc            jsonb not null,
  card_id        text not null references answers.cards(k),
  respondent_key text not null,
  n              integer not null check (n >= 1),
  unique (card_id, respondent_key),
  unique (card_id, n)
);

-- Whether a respondent opened the thread before answering Round 2, recorded by the server.
create table answers.thread_views (
  k              text primary key,
  seq            bigserial,
  doc            jsonb not null,
  card_id        text not null references answers.cards(k),
  respondent_key text not null,
  unique (card_id, respondent_key)
);
