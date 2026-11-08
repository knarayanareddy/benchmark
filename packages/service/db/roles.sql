-- Least-privilege database roles. Run once as the database owner, after schema.sql.
--
--   bm_roster   the ROSTER schema only: who the experts are.
--   bm_answers  the ANSWERS schema only: what was said. Cannot read the roster.
--
-- Neither role can see the other's schema, so a reader who gets one connection
-- string cannot join answers to people. bm_answers cannot rewrite the audit log
-- (the trigger refuses anyway). Give each role a password and LOGIN in your
-- deployment (see bin/migrate.mjs); they are created NOLOGIN here so this file
-- never contains a credential.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bm_roster') then create role bm_roster nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'bm_answers') then create role bm_answers nologin; end if;
end $$;

revoke all on schema roster, answers from public;
revoke all on all tables in schema roster, answers from public;

grant usage on schema roster to bm_roster;
grant select, insert, update, delete on all tables in schema roster to bm_roster;
grant usage, select on all sequences in schema roster to bm_roster;

grant usage on schema answers to bm_answers;
grant select, insert, update, delete on all tables in schema answers to bm_answers;
revoke update, delete, truncate on answers.audit from bm_answers;
grant usage, select on all sequences in schema answers to bm_answers;
