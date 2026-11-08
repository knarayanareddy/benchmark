-- Round 1 is blind (rule R9). The ACAPS rating on a card is no longer a "seed" that
-- experts start from; it is ACAPS's own reading, kept for scoring and analysis and never
-- shown to an expert before they lock Round 1. The old name invited exactly the mistake
-- this migration exists to prevent, so rename it.
alter table answers.cards rename column seed_p to acaps_p;
alter table answers.cards rename constraint cards_seed_p_check to cards_acaps_p_check;
-- 11 of ACAPS's 139 risks carry no probability rating; a card must not invent one.
alter table answers.cards alter column acaps_p drop not null;
comment on column answers.cards.acaps_p is
  'ACAPS''s own reading of this risk (band midpoint). For scoring and analysis only. Never sent to an expert before they lock Round 1.';
