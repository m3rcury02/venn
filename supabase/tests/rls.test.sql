-- RLS tests for the phase 0 tables, phase 3's groups and the policies it
-- widened, and phase 4's tag weights and recommender.
--
-- The positive controls are load-bearing. Every negative assertion here is of
-- the form "A cannot see B's row" -- and if request.jwt.claims were missing or
-- malformed, auth.uid() would be NULL for every role and all of them would pass
-- for the wrong reason: A sees nothing, therefore A sees nothing of B's. The
-- controls are what fail loudly when impersonation is not wired, which is what
-- makes the negatives mean anything.
--
-- Note that "authenticated can read movies" is NOT a control: that policy is
-- `using (true)`, so it passes with a NULL uid too.
--
-- Four actors. A and B are phase 0's pair and share nothing; phase 3 adds C and
-- D, who share a group. A is therefore the non-member for every group negative,
-- and it stays true that A sees exactly one profile and one default list.

begin;

create extension if not exists pgtap with schema extensions;

select plan(148);

-- ------------------------------------------------------------- fixtures
-- Run as postgres (bypasses RLS). Inserting into auth.users fires
-- handle_new_user, so each user arrives with a profile and a default list
-- already created -- the tests assert against those rather than making their own.

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{}'::jsonb, '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{}'::jsonb, '{}'::jsonb),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@test.dev',
   '{"provider":"google","providers":["google"]}'::jsonb,
   '{"full_name":"Caroline Example","name":"Caroline Example"}'::jsonb),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd@test.dev', '{}'::jsonb, '{}'::jsonb),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e@test.dev', '{}'::jsonb, '{}'::jsonb),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'f@test.dev', '{}'::jsonb, '{}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'g@test.dev', '{}'::jsonb, '{}'::jsonb);

-- Phase 10 social fixtures: E follows F, F blocks G
insert into follows (follower_id, followee_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff');

insert into blocks (blocker_id, blocked_id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

update lists set visibility = 'followers'
where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

select is(
  (select display_name from profiles
   where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Caroline'::text,
  'the first part of Google full_name seeds the profile display name'
);

select is(
  (select display_name from profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  null::text,
  'a non-Google signup does not receive a guessed display name'
);

-- Three movies: list_items' primary key is (list_id, movie_id), so the group
-- assertions below need distinct films to test the policy rather than the key.
insert into movies (id, title, year) values
  ('33333333-3333-3333-3333-333333333333', 'Test Movie', 2020),
  ('55555555-5555-5555-5555-555555555555', 'Second Movie', 2021),
  ('66666666-6666-6666-6666-666666666666', 'Third Movie', 2022);

-- Add a movie item to F's default list
insert into list_items (list_id, movie_id, added_by)
select id, '33333333-3333-3333-3333-333333333333', 'ffffffff-ffff-ffff-ffff-ffffffffffff'
from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

-- A TV title, deliberately given no movie_tags row: it exists only to exercise
-- list_items_insert_via_list's media_type clause below, and a tag row here
-- would perturb the "A can read movie tags" count.
insert into movies (id, title, year, media_type) values
  ('77777777-7777-7777-7777-777777777777', 'Test Show', 2023, 'tv');

insert into tags (id, tag_type, tag_value) values (1, 'genre', 'sci-fi');
insert into movie_tags (movie_id, tag_id) values
  ('33333333-3333-3333-3333-333333333333', 1);

-- B's private data, which A must never reach.
insert into list_items (list_id, movie_id, added_by)
select id, '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222'
from lists where owner_user_id = '22222222-2222-2222-2222-222222222222';

insert into user_movie_status (user_id, movie_id, watched, rating)
values ('22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333', true, 'love');

-- C's group. handle_new_group fires here, so C arrives as owner and the
-- group's one list already exists. invite_code is set explicitly rather than
-- defaulted so D can join with a known value below.
insert into groups (id, name, invite_code, created_by) values
  ('99999999-9999-9999-9999-999999999999', 'Test Group', 'TESTCODE',
   'cccccccc-cccc-cccc-cccc-cccccccccccc');

insert into list_items (list_id, movie_id, added_by)
select id, '33333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
from lists where owner_group_id = '99999999-9999-9999-9999-999999999999';

-- C's private rating. Group membership must not expose it to D (SPEC §11).
insert into user_movie_status (user_id, movie_id, watched, rating)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '33333333-3333-3333-3333-333333333333', true, 'hate');

-- Global-percentage fixtures on a movie outside the group candidate pool:
-- `hyped` is positive and `dont_care` stays in the hype denominator. Neither
-- row affects tag weights because both are unwatched.
insert into user_movie_status (user_id, movie_id, watched, hype) values
  ('22222222-2222-2222-2222-222222222222',
   '66666666-6666-6666-6666-666666666666', false, 'hyped'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '66666666-6666-6666-6666-666666666666', false, 'dont_care');

-- Phase 4. Also exercises the path the migration's backfill uses.
select public._rebuild_tag_weights('cccccccc-cccc-cccc-cccc-cccccccccccc');

-- Phase 5. Both tables are written here as postgres because that is the only
-- way an inbox row can exist at all: authenticated holds no INSERT grant on
-- ingest_inbox, which is the property the assertions below pin. The hashes are
-- literals -- the real ones are HMACs keyed on INGEST_TOKEN_PEPPER, which is
-- application-side and has no bearing on who can read the row.
insert into ingest_tokens (id, user_id, token_hash, label) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '11111111-1111-1111-1111-111111111111', 'hash-a', 'A phone'),
  ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
   '22222222-2222-2222-2222-222222222222', 'hash-b', 'B phone');

-- A's row carries a candidate, so resolving it below is the real two-column
-- update the Inbox performs rather than a status flip on its own.
insert into ingest_inbox (id, user_id, raw_text, source, candidate_movie_ids) values
  ('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
   '11111111-1111-1111-1111-111111111111', 'Inception (2010)', 'paste',
   array['33333333-3333-3333-3333-333333333333']::uuid[]),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   '22222222-2222-2222-2222-222222222222', 'B''s private share', 'ios_shortcut',
   '{}'::uuid[]);

-- Labelled `weights:` for the same reason one assertion below is labelled
-- `constraint:` -- this is §4.1's arithmetic, not access control, and it runs
-- as postgres. C rated exactly one movie, `hate`; that movie carries exactly
-- one tag, genre. So: -2 (hate) x 3 (genre) / 1 rated movie.
--
-- Both this number and D's +9 below depend on movie 33333333 having exactly
-- one movie_tags row. Add another and they break with a confusing value rather
-- than a clear failure.
select is(
  (select weight::numeric from user_tag_weights
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  -6::numeric,
  'weights: hate -2 x genre 3 / 1 rated movie'
);

-- Added after C's weight assertion so this tagless TV rating cannot change
-- Phase 4's deliberately exact denominator above. It exists only to pin that a
-- `like` remains in the global Loved denominator.
insert into user_movie_status (user_id, movie_id, watched, rating) values
  ('22222222-2222-2222-2222-222222222222',
   '77777777-7777-7777-7777-777777777777', true, 'love'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '77777777-7777-7777-7777-777777777777', true, 'like');

-- --------------------------------------------------- controls: A as itself

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from profiles where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'control: A sees its own profile row'
);

select is(
  (select count(*)::int from profiles),
  7,
  'control: A sees all non-blocked profiles'
);

select is(
  (select count(*)::int from lists where is_default),
  1,
  'control: A sees its auto-created default list'
);

select lives_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '33333333-3333-3333-3333-333333333333',
           '11111111-1111-1111-1111-111111111111'
    from lists where owner_user_id = '11111111-1111-1111-1111-111111111111'$$,
  'control: A can add an item to its own list'
);

-- Personal lists accept TV (SPEC §3); only group lists are movies-only.
select lives_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '77777777-7777-7777-7777-777777777777',
           '11111111-1111-1111-1111-111111111111'
    from lists where owner_user_id = '11111111-1111-1111-1111-111111111111'$$,
  'control: A can add a TV title to its own list'
);

select lives_ok(
  $$insert into user_movie_status (user_id, movie_id, watched, hype)
    values ('11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333', false, 'hyped')$$,
  'control: A can create its own movie status'
);

select lives_ok(
  $$update user_movie_status set hype = 'superhyped'
    where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'control: A can update its own movie status'
);

select is(
  (select hype::text from user_movie_status
   where user_id = '11111111-1111-1111-1111-111111111111'),
  'superhyped',
  'control: A''s update actually landed'
);

-- The aggregate sees all current votes even though the caller can select only
-- its own user_movie_status rows. Movie 33333333 has A's superhype plus B/C's
-- love/hate ratings: the two pools stay independent.
select results_eq(
  $$select hyped_percent, loved_percent
    from public.get_movie_vote_percentages(
      '33333333-3333-3333-3333-333333333333')$$,
  $$values (100, 50)$$,
  'global percentages combine private votes in separate hype and rating pools'
);

select results_eq(
  $$select hyped_percent, loved_percent
    from public.get_movie_vote_percentages(
      '66666666-6666-6666-6666-666666666666')$$,
  $$values (50, null::int)$$,
  'hyped includes hyped votes while dont-care remains in the denominator'
);

select results_eq(
  $$select hyped_percent, loved_percent
    from public.get_movie_vote_percentages(
      '77777777-7777-7777-7777-777777777777')$$,
  $$values (null::int, 50)$$,
  'liked remains in the Loved denominator'
);

select results_eq(
  $$select hyped_percent, loved_percent
    from public.get_movie_vote_percentages(
      '55555555-5555-5555-5555-555555555555')$$,
  $$values (null::int, null::int)$$,
  'a movie with no relevant votes returns null percentages'
);

-- The shared catalog cache is readable by any signed-in user.
select is(
  (select count(*)::int from movies),
  4,
  'A can read the movie cache'
);

select is(
  (select count(*)::int from movie_tags),
  1,
  'A can read movie tags'
);

-- ------------------------------------------------- negatives: A vs B's rows

select is(
  (select count(*)::int from profiles
   where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'A can read B''s profile (profiles widened)'
);

-- No error: RLS filters the row out, so the UPDATE simply matches nothing.
update profiles set display_name = 'hacked'
where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select display_name from profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'A cannot update B''s profile'
);

select is(
  (select count(*)::int from lists
   where owner_user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s lists'
);

select throws_ok(
  $$insert into lists (name, owner_user_id)
    values ('stolen', '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'A cannot create a list owned by B'
);

select is(
  (select count(*)::int from list_items
   where added_by = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read list items in B''s list'
);

-- Pins the parent-list join in list_items_insert_via_list. The read assertion
-- above would still pass if that policy were `using (added_by = auth.uid())`;
-- this one only passes if list ownership is what is actually checked. Phase 3
-- rewrites this policy, so it is the one most worth holding down.
select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    values ((select id from lists
             where owner_user_id = '22222222-2222-2222-2222-222222222222'),
            '33333333-3333-3333-3333-333333333333',
            '11111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'A cannot add an item to B''s list'
);

-- Constraint coverage, not access control: the composite pk still applies once
-- RLS has let the row through.
select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '33333333-3333-3333-3333-333333333333',
           '11111111-1111-1111-1111-111111111111'
    from lists where owner_user_id = '11111111-1111-1111-1111-111111111111'$$,
  '23505',
  null,
  'constraint: A cannot re-add the same movie to the same list twice'
);

select is(
  (select count(*)::int from user_movie_status
   where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s movie status'
);

select throws_ok(
  $$update user_movie_status
    set user_id = '22222222-2222-2222-2222-222222222222'
    where user_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'A cannot reassign its own status row to B (WITH CHECK)'
);

-- The catalog is a server-side write-through cache: only service_role writes.
select throws_ok(
  $$insert into movies (title) values ('injected')$$,
  '42501',
  null,
  'A cannot write to the movie cache'
);

-- ---------------------------------------------- A: ingest (phase 5)
-- Still impersonating A. Every negative here is paired with a control on the
-- same table, so none of them can pass because A sees nothing at all.

select is(
  (select count(*)::int from ingest_inbox),
  1,
  'control: A sees exactly its own inbox row'
);

select is(
  (select count(*)::int from ingest_tokens),
  1,
  'control: A sees exactly its own token'
);

select is(
  (select count(*)::int from ingest_inbox
   where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s inbox'
);

select is(
  (select count(*)::int from ingest_tokens
   where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s ingest tokens'
);

-- token_hash is excluded from the SELECT grant, so this fails on the column
-- privilege rather than returning A's own hash to A's browser. RLS is
-- row-level and would happily hand it over; the grant is the gate.
select throws_ok(
  $$select token_hash from ingest_tokens$$,
  '42501',
  null,
  'A cannot read token_hash even on its own token'
);

-- No INSERT grant and no INSERT policy on ingest_inbox: rows come from
-- /api/ingest, which is the only thing that has verified a token. The absence
-- is the enforcement, exactly as for the catalog tables (phase 0),
-- group_members (phase 3) and user_tag_weights (phase 4).
select throws_ok(
  $$insert into ingest_inbox (user_id, raw_text)
    values ('11111111-1111-1111-1111-111111111111', 'forged')$$,
  '42501',
  null,
  'A cannot insert an inbox row, even its own'
);

-- Rejecting sets a status; §5's whole point is that a share is never silently
-- lost, so there is no DELETE grant to undo that with.
select throws_ok(
  $$delete from ingest_inbox$$,
  '42501',
  null,
  'A cannot delete an inbox row'
);

-- UPDATE is granted on (status, resolved_movie_id) only, so resolve and reject
-- are structurally the only two edits that exist. What the user shared and what
-- the endpoint found are not theirs to rewrite afterwards.
select throws_ok(
  $$update ingest_inbox set raw_text = 'rewritten'$$,
  '42501',
  null,
  'A cannot rewrite the raw text of its own inbox row'
);

select lives_ok(
  $$update ingest_inbox
    set status = 'resolved',
        resolved_movie_id = '33333333-3333-3333-3333-333333333333'
    where id = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'$$,
  'control: A can resolve its own inbox row'
);

select is(
  (select resolved_movie_id from ingest_inbox
   where id = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'control: A''s resolve actually landed'
);

-- The check constraint, not a policy -- labelled the way the composite-key
-- assertion above is. A resolved row must name the movie it resolved to, or
-- the Inbox query and the badge count would disagree about what "resolved"
-- means.
select throws_ok(
  $$update ingest_inbox set status = 'resolved', resolved_movie_id = null
    where id = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'$$,
  '23514',
  null,
  'constraint: a resolved inbox row cannot have a null movie'
);

select lives_ok(
  $$insert into ingest_tokens (user_id, token_hash, label)
    values ('11111111-1111-1111-1111-111111111111', 'hash-a2', 'A laptop')$$,
  'control: A can mint its own token'
);

select throws_ok(
  $$insert into ingest_tokens (user_id, token_hash, label)
    values ('22222222-2222-2222-2222-222222222222', 'hash-forged', 'forged')$$,
  '42501',
  null,
  'A cannot mint a token for B'
);

-- UPDATE is granted on (revoked_at) alone, which makes revoke the only edit a
-- token can take: relabelling and re-pointing it at another user are not
-- features, and the grant is what keeps that true.
select throws_ok(
  $$update ingest_tokens set label = 'renamed'$$,
  '42501',
  null,
  'A cannot relabel a token'
);

select lives_ok(
  $$update ingest_tokens set revoked_at = now()
    where id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'$$,
  'control: A can revoke its own token'
);

-- ------------------------------------ negatives: A as a non-member (phase 3)
-- SPEC §11's named test: "a non-member must not read a group's list". A is
-- still impersonated here, so the controls at the top of this block cover these
-- too.

select is(
  (select count(*)::int from groups),
  0,
  'non-member A cannot read the group (nor therefore its invite code)'
);

select is(
  (select count(*)::int from group_members),
  0,
  'non-member A cannot read the group''s membership'
);

select is(
  (select count(*)::int from lists where owner_group_id is not null),
  0,
  'non-member A cannot read the group''s list'
);

select is(
  (select count(*)::int from list_items
   where added_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'non-member A cannot read items in the group''s list'
);

select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    values ((select id from lists
             where owner_group_id = '99999999-9999-9999-9999-999999999999'),
            '33333333-3333-3333-3333-333333333333',
            '11111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'non-member A cannot add an item to the group''s list'
);

-- Distinct from "A cannot read B's profile": C *is* in a group, so this pins
-- that the widened profiles policy leaks only to shared-group peers.
select is(
  (select count(*)::int from profiles
   where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'A can read C''s profile (profiles widened)'
);

-- recommend_movies is SECURITY DEFINER and reads every present member's
-- ratings and tag weights, so is_group_member is the only thing standing
-- between a non-member and the group's private data.
select throws_ok(
  $$select * from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['11111111-1111-1111-1111-111111111111']::uuid[])$$,
  '42501',
  null,
  'non-member A cannot run the recommender for the group'
);

-- ------------------------------------------- D: joining, and member access
-- Every assertion in this block is a positive that only passes as a real,
-- impersonated D, so the block controls itself: with claims unset the join
-- returns null and all of them fail.

set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

select is(
  (select public.join_group_by_code('  testcode  ')),
  '99999999-9999-9999-9999-999999999999'::uuid,
  'control: D joins by invite code, case- and whitespace-insensitively'
);

select is(
  (select public.join_group_by_code('NOSUCH00')),
  null,
  'an unknown invite code resolves to null rather than erroring'
);

select is(
  (select count(*)::int from groups),
  1,
  'control: D reads the group it just joined'
);

select is(
  (select count(*)::int from group_members),
  2,
  'control: D reads the group''s membership (C and itself)'
);

select is(
  (select count(*)::int from lists where owner_group_id is not null),
  1,
  'control: D reads the group''s list'
);

select is(
  (select count(*)::int from list_items
   where added_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'control: D reads what C added to the group list'
);

-- The regression guard for app/page.tsx's default-list .single(): being in a
-- group must not make a second is_default list visible.
select is(
  (select count(*)::int from lists where is_default),
  1,
  'control: D still sees exactly one is_default list while in a group'
);

select is(
  (select count(*)::int from lists
   where owner_group_id = '99999999-9999-9999-9999-999999999999' and is_default),
  0,
  'design: the group''s list is not is_default'
);

select is(
  (select count(*)::int from profiles
   where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'control: D reads its group peer C''s profile'
);

-- SPEC §11: sharing a group must not expose another member's ratings. Phase
-- 4's recommender reads them server-side; that is not a reason to widen here.
select is(
  (select count(*)::int from user_movie_status
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'D cannot read group peer C''s movie status'
);

-- Both writes into group_members are SECURITY DEFINER functions, so
-- authenticated holds no INSERT grant at all -- the same "no write policy is
-- the enforcement" argument phase 0 made for the catalog tables.
select throws_ok(
  $$insert into group_members (group_id, user_id)
    values ('99999999-9999-9999-9999-999999999999',
            '11111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'D cannot add a member to the group directly'
);

-- Group lists exist only because handle_new_group made them: lists_insert_own
-- checks auth.uid() = owner_user_id, which is NULL for a group-owned row.
select throws_ok(
  $$insert into lists (name, owner_group_id)
    values ('sneaky', '99999999-9999-9999-9999-999999999999')$$,
  '42501',
  null,
  'D cannot create a second list owned by the group'
);

select lives_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '55555555-5555-5555-5555-555555555555',
           'dddddddd-dddd-dddd-dddd-dddddddddddd'
    from lists where owner_group_id = '99999999-9999-9999-9999-999999999999'$$,
  'control: D adds to the group list'
);

-- A third film, so this fails on the policy's added_by clause rather than on
-- list_items' (list_id, movie_id) primary key.
select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '66666666-6666-6666-6666-666666666666',
           'cccccccc-cccc-cccc-cccc-cccccccccccc'
    from lists where owner_group_id = '99999999-9999-9999-9999-999999999999'$$,
  '42501',
  null,
  'D cannot attribute an add to C (added_by is pinned to auth.uid())'
);

-- The other clause list_items_insert_via_list checks: a group-owned list only
-- accepts a movie. "control: D adds to the group list" above is the positive
-- on this same table and policy.
select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '77777777-7777-7777-7777-777777777777',
           'dddddddd-dddd-dddd-dddd-dddddddddddd'
    from lists where owner_group_id = '99999999-9999-9999-9999-999999999999'$$,
  '42501',
  null,
  'D cannot add a TV title to the group''s list'
);

-- Documented decision, not an oversight: at 4-6 friends a per-adder delete rule
-- buys friction rather than safety.
select lives_ok(
  $$delete from list_items
    where added_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'control: any member may remove any member''s addition'
);

select is(
  (select count(*)::int from list_items
   where added_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'control: D''s delete of C''s item actually landed'
);

-- ------------------------------------------ D: tag weights (phase 4)
-- Tag weights are ratings in another shape, so SPEC §11 applies to them
-- unchanged: sharing a group must not expose them either. C has weights by now
-- (see fixtures), so the zero below is a real denial rather than an empty table.

select is(
  (select count(*)::int from user_tag_weights
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'D cannot read group peer C''s tag weights'
);

-- No INSERT/UPDATE/DELETE grant and no such policy: the absence is the
-- enforcement, exactly as for the catalog tables and group_members. Nothing but
-- _rebuild_tag_weights can write here, so a weight is always the derived
-- function of that user's ratings -- including for the user themselves.
select throws_ok(
  $$insert into user_tag_weights (user_id, tag_id, weight)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 99)$$,
  '42501',
  null,
  'D cannot write even its own tag weights directly'
);

select throws_ok(
  $$delete from user_tag_weights$$,
  '42501',
  null,
  'D cannot delete tag weights directly'
);

select lives_ok(
  $$insert into user_movie_status (user_id, movie_id, watched, rating)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
            '33333333-3333-3333-3333-333333333333', true, 'love')$$,
  'control: D rates a movie'
);

select results_eq(
  $$select hyped_percent, loved_percent
    from public.get_movie_vote_percentages(
      '33333333-3333-3333-3333-333333333333')$$,
  $$values (100, 67)$$,
  'global percentages round to the nearest whole percent'
);

-- The zero-argument wrapper, which is what app/status/actions.ts calls. It
-- reads auth.uid() internally: the only user it can rebuild is the caller.
select lives_ok(
  $$select public.rebuild_user_tag_weights()$$,
  'control: D rebuilds its own tag weights'
);

-- love +3 x genre 3 / 1 rated movie. A different number from C's -6 above, so
-- this also pins that the rebuild is per-caller rather than global.
select results_eq(
  $$select tag_id, weight::numeric from user_tag_weights
    where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  $$values (1, 9::numeric)$$,
  'control: D''s own weights are exactly love 3 x genre 3 / 1 rated movie'
);

-- ------------------------------------- D: the recommender (phase 4)

-- Without this guard a member could pass any uuid as "present" and read a
-- stranger's taste back off the scores.
select throws_ok(
  $$select * from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['11111111-1111-1111-1111-111111111111']::uuid[])$$,
  '42501',
  null,
  'D cannot blend a non-member''s taste into the group''s picks'
);

-- The group list holds only 55555555 by now: C's 33333333 was added in the
-- fixtures and deleted a few assertions ago. Neither present member has watched
-- 55555555, so it is the one eligible candidate, and no group member has seen
-- it -- which is what §4.4's "Nobody here has seen it" reads.
select results_eq(
  $$select movie_id, seen_count from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['cccccccc-cccc-cccc-cccc-cccccccccccc',
            'dddddddd-dddd-dddd-dddd-dddddddddddd']::uuid[])$$,
  $$values ('55555555-5555-5555-5555-555555555555'::uuid, 0)$$,
  'control: D gets the group''s one eligible candidate, unseen by the group'
);

select lives_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '33333333-3333-3333-3333-333333333333',
           'dddddddd-dddd-dddd-dddd-dddddddddddd'
    from lists where owner_group_id = '99999999-9999-9999-9999-999999999999'$$,
  'control: D puts a movie it has watched back on the group list'
);

-- §4.2: excluded is anything ANY present member has watched. D watched
-- 33333333 in the control above, so re-listing it must not make it a candidate.
select results_eq(
  $$select movie_id from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['cccccccc-cccc-cccc-cccc-cccccccccccc',
            'dddddddd-dddd-dddd-dddd-dddddddddddd']::uuid[])$$,
  $$values ('55555555-5555-5555-5555-555555555555'::uuid)$$,
  'a movie a present member has watched is not a candidate'
);

-- §4.5's reroll: exclude the previous picks and recompute.
select is(
  (select count(*)::int from public.recommend_movies(
     '99999999-9999-9999-9999-999999999999',
     array['cccccccc-cccc-cccc-cccc-cccccccccccc',
           'dddddddd-dddd-dddd-dddd-dddddddddddd']::uuid[],
     array['55555555-5555-5555-5555-555555555555']::uuid[])),
  0,
  'reroll: an excluded movie is not returned again'
);

-- ------------------------------------ D: onboarding and imports (phase 8)

select throws_ok(
  $$update profiles set onboarded_at = now()
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  '42501',
  null,
  'D cannot mark onboarding complete directly'
);

select lives_ok(
  $$update profiles
    set username = 'dee_test', region = 'IN'
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'control: D can save its onboarding profile fields'
);

select throws_ok(
  $$select public.complete_onboarding()$$,
  '22023',
  null,
  'onboarding cannot complete with fewer than ten ratings'
);

-- Insert the extra catalog rows outside RLS. The authenticated control below
-- still writes every status row through D's real policy.
reset role;

insert into movies (id, title, year) values
  ('80000001-0000-0000-0000-000000000001', 'Onboarding 1', 2001),
  ('80000002-0000-0000-0000-000000000002', 'Onboarding 2', 2002),
  ('80000003-0000-0000-0000-000000000003', 'Onboarding 3', 2003),
  ('80000004-0000-0000-0000-000000000004', 'Onboarding 4', 2004),
  ('80000005-0000-0000-0000-000000000005', 'Onboarding 5', 2005),
  ('80000006-0000-0000-0000-000000000006', 'Onboarding 6', 2006),
  ('80000007-0000-0000-0000-000000000007', 'Onboarding 7', 2007),
  ('80000008-0000-0000-0000-000000000008', 'Onboarding 8', 2008),
  ('80000009-0000-0000-0000-000000000009', 'Onboarding 9', 2009);

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

select lives_ok(
  $$insert into user_movie_status (user_id, movie_id, watched, rating)
    select
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      id,
      true,
      'like'::movie_rating
    from movies
    where id::text like '8000000%'$$,
  'control: D can add the nine remaining onboarding ratings'
);

select lives_ok(
  $$select public.complete_onboarding()$$,
  'control: D completes onboarding after ten ratings'
);

select ok(
  (select onboarded_at is not null from profiles
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'onboarding completion stamps the protected profile field'
);

select lives_ok(
  $$insert into imports (id, user_id, source, total)
    values (
      'a8000000-0000-0000-0000-000000000001',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'imdb',
      2
    )$$,
  'control: D can create its own import'
);

select lives_ok(
  $$insert into import_rows (
      id, import_id, row_number, imdb_id, title, year, watched, rating
    ) values
      (
        'a8100000-0000-0000-0000-000000000001',
        'a8000000-0000-0000-0000-000000000001',
        1, 'tt-import-1', 'Imported Rating', 2020, true, 'love'
      ),
      (
        'a8100000-0000-0000-0000-000000000002',
        'a8000000-0000-0000-0000-000000000001',
        2, 'tt-import-2', 'Imported Watchlist', 2021, false, null
      )$$,
  'control: D can enqueue rows under its own import'
);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from imports
   where id = 'a8000000-0000-0000-0000-000000000001'),
  0,
  'A cannot read D''s import'
);

select is(
  (select count(*)::int from import_rows
   where import_id = 'a8000000-0000-0000-0000-000000000001'),
  0,
  'A cannot read D''s import rows'
);

set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

select lives_ok(
  $$update imports set status = 'processing'
    where id = 'a8000000-0000-0000-0000-000000000001'$$,
  'control: D can start its own import'
);

select lives_ok(
  $$select public.apply_import_match(
      'a8100000-0000-0000-0000-000000000001',
      '55555555-5555-5555-5555-555555555555')$$,
  'control: D can apply a matched rating row'
);

select is(
  (select count(*)::int
   from list_items li
   join lists l on l.id = li.list_id
   where l.owner_user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     and li.movie_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'an imported match is added to D''s personal list'
);

select results_eq(
  $$select watched, rating::text, watched_at
    from user_movie_status
    where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and movie_id = '55555555-5555-5555-5555-555555555555'$$,
  $$values (true, 'love'::text, null::timestamptz)$$,
  'an imported rating wins and keeps its historical watch date unknown'
);

select lives_ok(
  $$select public.apply_import_match(
      'a8100000-0000-0000-0000-000000000002',
      '33333333-3333-3333-3333-333333333333')$$,
  'control: D can apply a matched watchlist row'
);

select results_eq(
  $$select watched, rating::text
    from user_movie_status
    where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and movie_id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (true, 'love'::text)$$,
  'a watchlist import does not downgrade an existing watched rating'
);

select is(
  (select public.finish_import(
    'a8000000-0000-0000-0000-000000000001')::text),
  'completed'::text,
  'a fully matched import completes'
);

select results_eq(
  $$select processed, matched, jsonb_array_length(unmatched_rows)
    from imports
    where id = 'a8000000-0000-0000-0000-000000000001'$$,
  $$values (2, 2, 0)$$,
  'the completed import records exact progress'
);

-- ------------------------------------------------ theatre mode (phase 9)

-- Fresh movies, not the earlier fixture ones: 55555555 was imported as D's
-- watched rating a few assertions ago (see 'an imported match is added to
-- D''s personal list' above), which would make it ineligible as a theatre
-- candidate for D and mask what this block is actually testing. Written
-- outside RLS because movie_releases is a service-role-only cache with no
-- authenticated write path at all -- there is no other way to create a row.
reset role;

insert into movies (id, title, year) values
  ('90000001-0000-0000-0000-000000000001', 'Now Showing', 2026),
  ('90000002-0000-0000-0000-000000000002', 'Coming Soon', 2026);

insert into movie_releases (movie_id, region, release_date, release_type) values
  ('90000001-0000-0000-0000-000000000001', 'IN', '2026-07-25', 'theatrical'),
  ('90000002-0000-0000-0000-000000000002', 'IN', '2026-08-20', 'upcoming');

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

-- Positive control, load-bearing per phase 0's rule: no negative on a table
-- without a control proving a real read succeeds first.
select is(
  (select count(*)::int from movie_releases where region = 'IN'),
  2,
  'control: D can read the region release cache'
);

select throws_ok(
  $$insert into movie_releases (movie_id, region, release_date, release_type)
    values ('90000001-0000-0000-0000-000000000001', 'US', now()::date, 'theatrical')$$,
  '42501',
  null,
  'D cannot write to the release cache directly'
);

select throws_ok(
  $$update movie_releases set release_date = now()::date$$,
  '42501',
  null,
  'D cannot update the release cache directly'
);

select throws_ok(
  $$delete from movie_releases$$,
  '42501',
  null,
  'D cannot delete from the release cache directly'
);

-- Same membership guard as p_present, exercised through the new argument:
-- without it a caller could pass any uuid as "present" regardless of which
-- pool scored the picks.
select throws_ok(
  $$select * from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['11111111-1111-1111-1111-111111111111']::uuid[],
      '{}'::uuid[],
      array['90000001-0000-0000-0000-000000000001']::uuid[])$$,
  '42501',
  null,
  'D cannot blend a non-member''s taste into a theatre-mode pick either'
);

-- Neither fresh movie is on any list in this group, and p_candidates is
-- non-null -- so both coming back is what proves the caller-supplied set
-- overrides the group-list pool entirely, rather than merely filtering it.
select results_eq(
  $$select movie_id from public.recommend_movies(
      '99999999-9999-9999-9999-999999999999',
      array['cccccccc-cccc-cccc-cccc-cccccccccccc',
            'dddddddd-dddd-dddd-dddd-dddddddddddd']::uuid[],
      '{}'::uuid[],
      array['90000001-0000-0000-0000-000000000001',
            '90000002-0000-0000-0000-000000000002']::uuid[])
    order by movie_id$$,
  $$values ('90000001-0000-0000-0000-000000000001'::uuid),
           ('90000002-0000-0000-0000-000000000002'::uuid)$$,
  'p_candidates overrides the group-list pool with the caller-supplied set'
);

-- -------------------------------------------------------- leaving a group

-- This block switches request.jwt.claims but never the role, and it deliberately
-- ends with D impersonated and back in the group. Both matter: the delete block
-- below opens "still impersonating D" and reads `count(*) from groups` as D, so
-- a stray `reset role` or a left-over C impersonation here would surface as a
-- failure down there, looking unrelated.

-- The owner first, while we are switching claims anyway. Not throws_ok:
-- authenticated holds the DELETE grant on group_members now, so the
-- `role <> 'owner'` clause stops C by filtering the row out of the delete's
-- target set, silently. Non-vacuous -- C is still a member and can read the row.
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

delete from group_members
where group_id = '99999999-9999-9999-9999-999999999999'
  and user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(
  (select count(*)::int from group_members
   where group_id = '99999999-9999-9999-9999-999999999999'
     and user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'C, the group''s owner, cannot leave its own group'
);

set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

select lives_ok(
  $$delete from group_members
    where group_id = '99999999-9999-9999-9999-999999999999'
      and user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'control: D, a member, can leave the group'
);

-- The user-visible consequence -- the group page 404s -- and self-controlling:
-- only a real D could have made the delete above succeed. Asserting this rather
-- than a row count read outside RLS is what keeps the block free of a role
-- switch; is_group_member being false here is equivalent to the row being gone.
select is(
  (select count(*)::int from groups
   where id = '99999999-9999-9999-9999-999999999999'),
  0,
  'after leaving, D can no longer read the group'
);

-- Leaving is recoverable, unlike deleting -- and this doubles as the fixture
-- restore the delete block below depends on. Wrapped in an assertion rather
-- than called bare: a naked `select` of a function would emit a row that is not
-- TAP. D rejoins with role = 'member', exactly as before.
select is(
  (select public.join_group_by_code('TESTCODE')),
  '99999999-9999-9999-9999-999999999999'::uuid,
  'D can rejoin after leaving'
);

-- The policy's other clause, isolated. C's negative above is stopped by
-- `role <> 'owner'` alone, so it says nothing about who may remove whom; D's
-- row is role = 'member', which passes that clause and leaves
-- `user_id = auth.uid()` as the only thing refusing C. That clause is the whole
-- of what keeps removing another member unbuilt -- and the owner has no more
-- power here than anyone else. A no-op, so the fixture survives for the delete
-- block below.
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

delete from group_members
where group_id = '99999999-9999-9999-9999-999999999999'
  and user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

select is(
  (select count(*)::int from group_members
   where group_id = '99999999-9999-9999-9999-999999999999'
     and user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1,
  'C, the owner, cannot remove another member'
);

set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

-- ------------------------------------------------------- deleting a group

-- Still impersonating D: a member, so D can SELECT the group and therefore
-- count it -- unlike A, who is worth no delete negative here since
-- groups_select_member already pins that A cannot see the group at all.

delete from groups where id = '99999999-9999-9999-9999-999999999999';

-- Not throws_ok: authenticated now holds the DELETE grant (see this phase's
-- migration), so a non-owner is stopped by RLS filtering the row out of the
-- delete's target set, which is silent -- the same shape as "A cannot update
-- B's profile" above.
select is(
  (select count(*)::int from groups),
  1,
  'D (a member, not the owner) cannot delete the group'
);

-- The control the house rule requires: no negative above without a positive on
-- the same table. C is the creator.
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

-- Captured before the delete: once the group is gone, `lists` cascades away
-- too, and `list_items where list_id in (select ... from lists where
-- owner_group_id = ...)` would then match against an empty subquery and pass
-- vacuously, proving nothing about the cascade at all.
create temp table _deleted_group_list as
  select id from lists where owner_group_id = '99999999-9999-9999-9999-999999999999';

select lives_ok(
  $$delete from groups where id = '99999999-9999-9999-9999-999999999999'$$,
  'control: C, the group''s creator, can delete it'
);

-- Read outside RLS: a zero read as C would prove nothing once the delete has
-- removed C's own group_members row -- it would pass even if the cascade had
-- not fired. reset role is the idiom this file already uses to get back to the
-- superuser; `set local role postgres` is not valid here since authenticated is
-- not a member of that role.
reset role;

select is(
  (select count(*)::int from group_members
   where group_id = '99999999-9999-9999-9999-999999999999'),
  0,
  'cascade: deleting the group removes its membership'
);

select is(
  (select count(*)::int from lists
   where owner_group_id = '99999999-9999-9999-9999-999999999999'),
  0,
  'cascade: deleting the group removes its list'
);

select is(
  (select count(*)::int from list_items
   where list_id in (select id from _deleted_group_list)),
  0,
  'cascade: deleting the group removes its list''s items'
);

-- ------------------------------------------------------------ anon access

-- ----------------------------------------------------------- Phase 10 Social tests

-- Positives & Controls: E as itself
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select is(
  (select count(*)::int from profiles where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'E reads F''s profile'
);

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'E reads F''s followers-visibility list'
);

select is(
  (select count(*)::int from list_items li join lists l on l.id = li.list_id where l.owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'E reads items from F''s followers-visibility list'
);

select is(
  (select count(*)::int from follows where follower_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  1,
  'E reads its own follows row'
);

-- F as itself
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

select is(
  (select count(*)::int from blocks where blocker_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'F reads its own blocks row'
);

select is(
  (select count(*)::int from list_hidden_from h join lists l on l.id = h.list_id where l.owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'F reads its own list_hidden_from rows'
);

-- A as itself (does not follow F)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'A cannot read F''s list while it is followers'
);

select is(
  (select count(*)::int from list_items li join lists l on l.id = li.list_id where l.owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'A cannot read items from F''s followers list'
);

-- Switch F's list to public as postgres
reset role;
update lists set visibility = 'public' where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'A reads F''s list once F sets it public'
);

select is(
  (select count(*)::int from list_items li join lists l on l.id = li.list_id where l.owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  1,
  'A reads items from F''s public list'
);

-- Switch F's list to private as postgres
reset role;
update lists set visibility = 'private' where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'Nobody but owner reads a private list (E gets 0)'
);

-- Restore F's list to public for remaining tests
reset role;
update lists set visibility = 'public' where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

-- E cannot write to F's list despite reading it
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select throws_ok(
  $$insert into list_items (list_id, movie_id, added_by)
    select id, '55555555-5555-5555-5555-555555555555', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default$$,
  '42501',
  null,
  'E, who can read F''s list, cannot insert into it'
);

select is(
  (select count(*)::int from list_items li join lists l on l.id = li.list_id
   where l.owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and li.movie_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'E insert on F''s list failed'
);

-- G as itself (G is blocked by F)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is(
  (select count(*)::int from profiles where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'G cannot read F''s profile (blocked)'
);

-- F as itself (reverse direction of block)
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

select is(
  (select count(*)::int from profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'F cannot read G''s profile (symmetric block)'
);

-- G cannot read F's public list (block beats visibility)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'G cannot read F''s public list (block beats visibility)'
);

select is(
  (select count(*)::int from blocks where blocker_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'G cannot read the block row F created against them'
);

select is(
  (select count(*)::int from follows where follower_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'A cannot read E->F follow edge'
);

select throws_ok(
  $$insert into follows (follower_id, followee_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ffffffff-ffff-ffff-ffff-ffffffffffff')$$,
  '42501',
  null,
  'G cannot follow F (is_blocked_with check)'
);

select throws_ok(
  $$insert into follows (follower_id, followee_id) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff')$$,
  '42501',
  null,
  'A cannot insert a follow edge on behalf of E'
);

select throws_ok(
  $$insert into blocks (blocker_id, blocked_id) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'Direct insert into blocks as authenticated fails'
);

select throws_ok(
  $$insert into list_hidden_from (list_id, user_id)
    select id, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default$$,
  '42501',
  null,
  'Direct insert into list_hidden_from as authenticated fails'
);

-- Test list_hidden_from filtering: insert row as postgres
reset role;
insert into list_hidden_from (list_id, user_id)
select id, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' and is_default;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select is(
  (select count(*)::int from lists where owner_user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'With a list_hidden_from row for E on F''s public list, E gets 0 rows'
);

-- Test block_user procedure tearing down follow edges (last test mutating state)
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select lives_ok(
  $$select block_user('ffffffff-ffff-ffff-ffff-ffffffffffff')$$,
  'E blocks F using block_user()'
);

select is(
  (select count(*)::int from follows where follower_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and followee_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'E->F follow edge is torn down after block_user()'
);

-- anon holds no grant on these tables, so it is stopped one layer earlier than
-- RLS: the read is refused outright rather than returning an empty set.

set local role anon;
set local request.jwt.claims = '';

select throws_ok(
  $$select count(*) from profiles$$,
  '42501',
  null,
  'anon cannot read profiles'
);

select throws_ok(
  $$select count(*) from lists$$,
  '42501',
  null,
  'anon cannot read lists'
);

select throws_ok(
  $$select count(*) from user_tag_weights$$,
  '42501',
  null,
  'anon cannot read tag weights'
);

select throws_ok(
  $$select count(*) from ingest_inbox$$,
  '42501',
  null,
  'anon cannot read the ingest inbox'
);

-- /api/ingest is the one route reachable without a cookie (SPEC §5), so this is
-- the assertion that the token table is still not reachable *through* it: the
-- route holds the service-role key, and anon holds nothing.
select throws_ok(
  $$select count(*) from ingest_tokens$$,
  '42501',
  null,
  'anon cannot read ingest tokens'
);

select throws_ok(
  $$select * from public.get_movie_vote_percentages(
      '33333333-3333-3333-3333-333333333333')$$,
  '42501',
  null,
  'anon cannot read global vote percentages'
);

select throws_ok(
  $$select count(*) from imports$$,
  '42501',
  null,
  'anon cannot read imports'
);

select throws_ok(
  $$select count(*) from import_rows$$,
  '42501',
  null,
  'anon cannot read import rows'
);

select throws_ok(
  $$select count(*) from follows$$,
  '42501',
  null,
  'anon cannot read follows'
);

select throws_ok(
  $$select count(*) from blocks$$,
  '42501',
  null,
  'anon cannot read blocks'
);

select throws_ok(
  $$select count(*) from list_hidden_from$$,
  '42501',
  null,
  'anon cannot read list hidden-from rows'
);

reset role;

select * from finish();

rollback;
