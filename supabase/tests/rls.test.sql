-- RLS tests for the phase 0 tables.
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

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- ------------------------------------------------------------- fixtures
-- Run as postgres (bypasses RLS). Inserting into auth.users fires
-- handle_new_user, so each user arrives with a profile and a default list
-- already created -- the tests assert against those rather than making their own.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev');

insert into movies (id, title, year) values
  ('33333333-3333-3333-3333-333333333333', 'Test Movie', 2020);

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

-- --------------------------------------------------- controls: A as itself

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from profiles),
  1,
  'control: A sees exactly its own profile row'
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

-- The shared catalog cache is readable by any signed-in user.
select is(
  (select count(*)::int from movies),
  1,
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
  0,
  'A cannot read B''s profile'
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

-- ------------------------------------------------------------ anon access

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

reset role;

select * from finish();

rollback;
