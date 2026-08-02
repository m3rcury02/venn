# Goal

Add a new section to Venn at `/explore`: a full-screen, vertically scroll-snapping feed of movie cards, one film per screen, where each card autoplays that film's YouTube trailer muted and offers the app's existing vote controls beneath it. The user scrolls, watches, votes, scrolls. Every vote writes to `user_movie_status` exactly as the search screen does, which feeds `user_tag_weights` and therefore sharpens the group recommender that already exists. This is net-new product surface: Venn currently has no way to browse films you don't already know the name of.

This feature is **not** in `docs/SPEC.md` §9's build order (the repo is on phase 9; phase 10 is "Public profiles, follows, visibility toggles, blocks"). The user has explicitly approved building it now as a post-phase feature and amending the spec in place. Do not skip Task 9.

**Do not confuse this with SPEC §7 screen 9 "Discover"**, which reads *"search users, browse public lists and groups"* — that is a people directory belonging to phase 10 and is a different feature.

---

# Constraints

## Hard rules from `CLAUDE.md` — violating any of these fails the task

- **No new npm dependencies.** Current deps are exactly: `@supabase/ssr`, `@supabase/supabase-js`, `csv-parse`, `fflate`, `next`, `react`, `react-dom`. Do not add a gesture library, animation library, carousel, or icon package. Do not add the YouTube IFrame Player API script.
- **Movie provider calls are server-side ONLY.** Never prefix `TMDB_API_KEY` with `NEXT_PUBLIC_`. This repo is public.
- **All movie data goes through `lib/providers/`.** Never call `api.themoviedb.org` from a route handler or component.
- **Never re-host images.** Hotlink `image.tmdb.org` with a plain `<img>` and an `// eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted` comment. **Never use `next/image`** — it proxies bytes through Vercel, which is a re-host.
- **Schema changes go in a migration file**, never applied by hand.
- **After any schema change, append the reasoning to `docs/DECISIONS.md`.**
- Movies and TV are treated identically in the catalog. A series is one title.

## APIs that must be preserved — do not modify these files' behaviour

- `app/status/actions.ts` — `setWatched`, `setRating`, `setHype`. **Do not change these.** In particular, `setRating` is deliberately an `UPDATE`, not an upsert: it matches zero rows for a movie with no status row. This is safe here because the Explore card, like the search card, only offers the rating control after `setWatched`/`addToList` has created the row. Do not "fix" it.
- `components/vote-control.tsx` — **do not change.** It already implements watched→rating / unwatched→hype and the `beam-a` / white / `beam-b` scale. Reuse it as-is.
- `app/list/actions.ts` — `addToList`, `addWatchedToList`, `removeFromList`. Reuse, do not change.
- `lib/movies/theatre.ts` — `theatreCandidates(region)`. Call it, do not change it.
- `proxy.ts` and `lib/supabase/proxy.ts` — **no change needed.** `/explore` is not in `PUBLIC_PATHS`, so it automatically inherits the auth gate and the onboarding redirect.

## Conventions to follow

- **Migrations:** every non-obvious line carries a comment explaining *why*, frequently citing SPEC sections and prior phases. Read `supabase/migrations/20260730190000_phase9_theatre.sql` and match its comment density. A thin migration is wrong here.
- **Supabase clients:** `lib/supabase/server.ts` (`await createClient()`) in server components and server actions; `lib/supabase/service.ts` (`createServiceClient()`) only for catalog writes; `lib/supabase/client.ts` in client components.
- **Auth:** `supabase.auth.getClaims()` then `claims?.claims?.sub`, never `getSession()`. Each actions file defines its own small local helper; follow that.
- **No generated Supabase types exist.** Hand-type query results inline and cast, as every existing file does.
- **PostgREST types every embed as an array** — `movie.user_movie_status[0] ?? null`.
- Design tokens live only in `app/globals.css`. Do not add tokens, colors, fonts, or `@keyframes`.

---

# Tasks

## Task 1 — Add trailer support to the provider

- [x] done

**Edit `lib/providers/types.ts`:**

1. Add to the `Movie` type: `trailerKey: string | null;` with a comment that it is a YouTube video key, null when the provider has no trailer.
2. Add to the `MovieDataProvider` interface: `getTrailerKey(externalId: string): Promise<string | null>;`

**Edit `lib/providers/tmdb.ts`:**

3. Add a response type near the other Tmdb types:
   ```ts
   type TmdbVideo = {
     key: string; site: string; type: string; official: boolean;
   };
   type TmdbVideos = { videos: { results: TmdbVideo[] } };
   ```
4. Add a selection helper. It must be deterministic:
   ```ts
   // TMDB returns teasers, clips, featurettes and behind-the-scenes in the same
   // list. Order is not guaranteed, so pick explicitly rather than taking [0].
   function toTrailerKey(results: TmdbVideo[]): string | null {
     const youtube = results.filter((v) => v.site === "YouTube");
     return (
       youtube.find((v) => v.type === "Trailer" && v.official)?.key ??
       youtube.find((v) => v.type === "Trailer")?.key ??
       youtube.find((v) => v.type === "Teaser")?.key ??
       youtube[0]?.key ??
       null
     );
   }
   ```
5. **Change the `getMovie` function at `lib/providers/tmdb.ts:283-289`** to request videos. It currently makes a bare call with no `append_to_response`; adding one costs **zero extra HTTP requests**:
   ```ts
   async function getMovie(externalId: string): Promise<Movie> {
     const { mediaType, id } = parseExternalId(externalId);

     // append_to_response rides along on the detail call that was happening
     // anyway -- no extra round trip. Same argument the phase 9 migration makes
     // at its lines 22-26 about not paying a third call per candidate.
     return mediaType === "movie"
       ? toMovieDetail(await get<TmdbMovieDetail & TmdbVideos>(`/movie/${id}`, {
           append_to_response: "videos",
         }))
       : toTvDetail(await get<TmdbTvDetail & TmdbVideos>(`/tv/${id}`, {
           append_to_response: "videos",
         }));
   }
   ```
   **Do not touch `getTags`.** It is a separate call to the same endpoint and returns `Tag[]`, which cannot carry a trailer key.
6. Update `toMovieDetail` and `toTvDetail` (`lib/providers/tmdb.ts:219-241`) to accept the `& TmdbVideos` parameter type and set `trailerKey: toTrailerKey(detail.videos?.results ?? [])`.
7. `toMovieSummary` and `toTvSummary` return `MovieSummary`, which has no `trailerKey`. **Do not add it there** — list endpoints don't return videos.
8. Implement `getTrailerKey` on the exported `tmdb` object, for backfilling titles already in the cache without re-running the whole detail+tags fetch:
   ```ts
   async getTrailerKey(externalId) {
     const { mediaType, id } = parseExternalId(externalId);
     const { results } = await get<{ results: TmdbVideo[] }>(
       `/${mediaType}/${id}/videos`,
     );
     return toTrailerKey(results);
   },
   ```

**Done when:** `pnpm typecheck` passes and `pnpm smoke:tmdb` still passes.

---

## Task 2 — Migration for the trailer cache

- [x] done

**Create `supabase/migrations/20260802120000_explore_trailers.sql`.**

Use that exact filename. Phase-numbered migrations in this repo use round timestamps; this is a post-phase feature, so `20260802120000` is fine and sorts after `20260730190000_phase9_theatre.sql`.

Content — match the comment density of `20260730190000_phase9_theatre.sql`:

```sql
-- Explore (post-phase-9 feature): a vertical trailer feed at /explore.
--
-- No table is created here, so CLAUDE.md's REVOKE-then-GRANT rule and the
-- "every new table gets RLS in the same migration" rule do not apply. Stated
-- rather than left implicit, because both are absolute rules and a reader
-- needs to see they were considered.
--
-- `movies` already carries `grant select on movies, ... to authenticated`
-- table-wide, not column-scoped (20260726002633_phase0_core.sql:178), so both
-- columns below are readable with no grant change. The same migration grants
-- service_role table-wide, so lib/movies/cache.ts can write them. This is the
-- identical argument 20260727200002_media_type_tv.sql:6-9 made for media_type.

alter table movies add column trailer_key text;

-- Two columns, not one. `trailer_key is null` is ambiguous between "this film
-- has no trailer on the provider" and "nobody has looked yet". Without a
-- separate timestamp, the backfill in lib/movies/explore.ts would re-query
-- every trailer-less title on every pass, forever. This is the same role
-- fetched_at plays on movie_releases and on movies itself.
alter table movies add column trailer_fetched_at timestamptz;
```

**Done when:** `supabase db reset` succeeds with no error.

---

## Task 3 — Persist trailer keys in the catalog cache

- [x] done

**Edit `lib/movies/cache.ts`.**

The write site is `insertMovie` at `lib/movies/cache.ts:116-138` (**not** `cacheResolvedMovie`, which delegates). Add two fields to the `.insert({...})` object:

```ts
trailer_key: movie.trailerKey,
// Stamped whenever a movie row is minted, because getMovie now always asks
// for videos. A null key here therefore means "no trailer exists", not
// "not looked yet" -- which is exactly what the backfill needs to skip it.
trailer_fetched_at: new Date().toISOString(),
```

Do not change the write ordering in `persistMovie` — `movie_external_ids` is written last on purpose as the commit marker.

**Done when:** `pnpm typecheck` passes.

---

## Task 4 — The feed candidate pool

- [x] done

**Create `lib/movies/explore.ts`.** Model it closely on `lib/movies/theatre.ts` — read that file first and copy its `mapLimit` helper verbatim (it is private there; duplicating ~14 lines is correct, do not export it from `theatre.ts`).

Exports:

```ts
export type ExploreCard = {
  movieId: string;          // internal uuid -- the pool is always cached
  title: string;
  year: number | null;
  runtime: number | null;
  overview: string | null;
  posterUrl: string | null;    // provider.getImageUrl(path, "w500")
  backdropUrl: string | null;  // provider.getImageUrl(path, "w780")
  trailerKey: string | null;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
  isInList: boolean;
};

export async function exploreFeed(
  userId: string,
  region: string,
  page: number,
): Promise<ExploreCard[]>;
```

Behaviour, in order:

1. **Source 1 — releases.** Call `theatreCandidates(region)` from `lib/movies/theatre.ts`. These are the region's in-cinemas ∪ upcoming titles, already TTL-cached and already the titles most likely to have trailers. Use these first.
2. **Source 2 — popular overflow.** When source 1 is exhausted for the requested page, call `provider.popular(region, page)`. Resolve `movie_external_ids` in one batched query the way `loadPopularOnboarding` does at `app/onboarding/actions.ts:102-114`. Cache uncached titles with `cacheMovie`, capped:
   ```ts
   const MAX_NEW_TITLES = 12;  // 2 TMDB calls each; bounds a cold request
   const CONCURRENCY = 5;      // matches lib/movies/theatre.ts
   const PAGE_SIZE = 10;
   ```
3. **Exclude already-voted titles.** Drop any movie where the caller's `user_movie_status` row has `watched = true` OR `rating is not null` OR `hype is not null`. A *cleared* vote (row exists, both null, not watched) must **not** exclude — it means the user deliberately un-voted.
4. **Backfill trailer keys.** For pool movies where `trailer_fetched_at is null`, call `provider.getTrailerKey(externalId)` and write both `trailer_key` and `trailer_fetched_at` via `createServiceClient()`. Bound this by `MAX_NEW_TITLES` too. Wrap each call in try/catch — a failure must leave the title in the feed with `trailerKey: null`, not drop it.
5. **Never throw on a provider failure.** Follow `theatreCandidates`'s precedent at `lib/movies/theatre.ts:46-55`: catch and return whatever is available rather than failing the page.
6. Read `list_items` for the caller's default list to populate `isInList`.

**Done when:** `pnpm typecheck` passes.

---

## Task 5 — Smoke script

- [x] done

**Create `scripts/explore-smoke.ts`.** Read `scripts/theatre-smoke.ts` and copy its structure exactly: the `globalThis.fetch` counter, the `check()` / `section()` helpers, the env-var guard, `main().catch(...)` at the bottom (not top-level await — `package.json` has no `"type": "module"`).

Assert:
1. A cold call to `exploreFeed` returns cards and hits TMDB.
2. A second call returns cards and makes **fewer** TMDB calls (the pool is warm).
3. Every returned card has a non-null `movieId` (the pool must always be cached).
4. Cards with `trailerKey === null` also have a non-null `trailer_fetched_at` in the DB — proves the backfill marks its work and won't re-query forever.
5. **Positive control before any negative assertion.** Before asserting "already-voted titles are excluded", assert the feed is non-empty — otherwise an empty feed passes the exclusion check for the wrong reason. `scripts/theatre-smoke.ts:115-120` explains this rule.
6. Exclusion works: insert a `hype` vote for the first card's `movieId` via the service client, call `exploreFeed` again, assert that `movieId` is absent.

**Edit `package.json`** — add to `"scripts"`, after `"smoke:theatre"`:
```json
"smoke:explore": "node --env-file=.env.local --import tsx scripts/explore-smoke.ts",
```

**Done when:** `pnpm smoke:explore` prints `PASS` and exits 0.

---

## Task 6 — The trailer embed component

- [x] done

**Create `components/trailer-frame.tsx`** (`"use client"`).

Props: `{ trailerKey: string | null; posterUrl: string | null; title: string; active: boolean; muted: boolean; }`

Rules:

- Render the `<iframe>` **only when `active && trailerKey && !reducedMotion && !saveData`**. Unmounting when the card scrolls away is what stops playback — this is why no player API is needed.
- URL (use `youtube-nocookie.com`):
  ```
  https://www.youtube-nocookie.com/embed/{key}?autoplay=1&mute={0|1}&loop=1&playlist={key}&controls=0&playsinline=1&modestbranding=1&rel=0
  ```
  **`playsinline=1` is not optional** — without it iOS takes the video fullscreen and destroys the feed. `loop=1` requires `playlist={key}` to work on a single video; that is a YouTube quirk, not a typo.
- `allow="autoplay; encrypted-media"`, `title={`${title} trailer`}`, `className="absolute inset-0 h-full w-full"`, `frameBorder={0}`.
- **Fallback (no trailer, reduced motion, or save-data):** render the sharp poster in the same frame with `object-cover`. Same box, same size, no layout shift. Use a plain `<img>` with the eslint-disable comment.
- Detect preferences on mount only (they don't exist during SSR — follow the pattern at `components/mobile-navigation.tsx:145-152`):
  ```ts
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  ```
- When autoplay is suppressed by reduced motion or save-data, show an explicit play button over the poster that sets a local `userStarted` state, which then permits the iframe to mount.

**Done when:** `pnpm typecheck` and `pnpm lint` pass.

---

## Task 7 — The card and the feed

- [x] done

### `components/explore-card.tsx` (`"use client"`)

Layout — **a projection with a placard under it.** The controls never overlay the video: this app's design system is "a dark room, two projector beams, and a screen", and you do not put buttons on the screen.

```
┌───────────────────────────┐
│ ░░ backdrop, blurred ░░░░ │  full-bleed, blurred, saturated
│ ┌───────────────────────┐ │
│ │   trailer 16:9        │ │  sharp, full width, aspect-video
│ └───────────────────────┘ │
│                      (🔇) │  sound toggle, ghost
│ DUNE PART                 │  Anton, clamp(32px,9vw,64px)
│ TWO                       │
│ 2024 · 166M               │  .t-label, white
│ [ Add to list ][ Watched ]│
│ [ Meh ][ Hyped ][ Very ]  │  <VoteControl>, unchanged
└───────────────────────────┘
```

Concrete requirements:

- Root: `<section>` with `aria-label={title}`, `className="relative flex h-full w-full snap-start snap-always flex-col justify-center overflow-hidden"`.
- **Blurred backdrop fills the whole card**, behind everything. This is why the black around a 16:9 video is not dead space — it is lit by the film's own colour. Copy the treatment from `components/poster.tsx:34-42` and `components/night-pick-hero.tsx:38-56`:
  `className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-2xl saturate-[2.1]"`, `alt=""`, `aria-hidden`.
- If `backdropUrl` is null, use the two-beam radial gradient fallback from `components/night-pick-hero.tsx:49-56` verbatim.
- Scrim over the backdrop: `absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/25`, `aria-hidden`.
- Trailer frame wrapper: `relative aspect-video w-full overflow-hidden rounded-card border border-hairline`.
- `<div className="grain-art" aria-hidden />` over the card.
- Title: `<h2 className="t-display mt-4 text-[clamp(32px,9vw,64px)] text-fg">`. Smaller than `night-pick-hero.tsx`'s 96px because it shares the card with controls.
- Meta line (`year · runtime`): `.t-label`, **`text-fg` (white), NOT `text-fg-dim`.** `components/night-pick-hero.tsx:86-90` documents why: `--fg-dim` measures 4.36:1 over real backdrop art and fails AA, and poster art is arbitrary so no scrim can be trusted to hold a muted tone.
- Sound toggle: a real `<button>` with `aria-pressed={!muted}`, minimum 44px, styled as a ghost (`border-hairline bg-surface-2`). **Do not use `--marquee`** — that colour means "added to list" in this app. Toggling sound remounts the iframe and restarts the trailer; this is an accepted tradeoff, documented in Task 9.
- Entry animation: `motion-safe:animate-expose`. **Add no new keyframes.**
- No circles anywhere — `--radius-card: 3px` / `--radius-ctl: 2px` only. Circles are reserved for the mark and for things representing people.

### `components/explore-card-actions.tsx` (`"use client"`)

**Port the state machine from `components/search-movie-actions.tsx` rather than re-deriving it** — the user explicitly asked for search's exact vote semantics. Copy its `MovieState` type, its `toggle()` function, and its `handleVote()` function. The differences:

- It receives a `movieId` that is **always non-null** (the Explore pool is pre-cached), so unlike search it can render `<VoteControl>` immediately without requiring the movie be added to a list first. Drop the `movie.movieId && (movie.isInList || movie.watched)` gate at `components/search-movie-actions.tsx:147`.
- Still uses `addToList` / `removeFromList` / `addWatchedToList` / `setWatched` from the same imports.

### `components/explore-feed.tsx` (`"use client"`)

- Scroll container: `className="h-[calc(100dvh-4rem)] snap-y snap-mandatory overflow-y-scroll sm:h-dvh"`.
  **Leave a comment** that `4rem` must stay in sync with the tab bar spacer `h-16` at `components/mobile-navigation.tsx:182`. The `--mobile-nav-offset` variable looks right but is scoped to `[data-mobile-nav] ~ [data-install-prompt]` in `app/globals.css:232-235` and does not reach here.
- Track the active card with a single `IntersectionObserver` at `threshold: 0.6` over the card elements; pass `active` down so only one trailer is mounted.
- Paging: when the active index is within 3 of the end, call `loadExploreFeed(nextPage)` inside `useTransition`. Dedupe appended cards by `movieId`, mirroring how `components/onboarding-taste.tsx` dedupes by `externalId`.
- Hold `muted` state at the feed level so the preference persists across cards.

**Done when:** `pnpm typecheck` and `pnpm lint` pass.

---

## Task 8 — Route and navigation

- [x] done

**Create `app/explore/page.tsx`** (server component):
- Get `userId` via `supabase.auth.getClaims()` → `claims?.claims?.sub`.
- Read `profiles.region` (default `"IN"`, matching `app/onboarding/actions.ts:99`).
- Call `exploreFeed(userId, region, 1)`.
- Render `<AppHeader>` then `<ExploreFeed>`.
- **Do not wrap in `components/ui/screen.tsx`** — its `max-w-5xl px-5 py-8` fights full-bleed. This is the first route in the app to opt out; leave a comment saying so.
- If the feed comes back empty, render an empty state that invites action ("Nothing left to rate right now. Check back after the next release wave."), not a bare "no results".

**Create `app/explore/actions.ts`:**
```ts
"use server";
export async function loadExploreFeed(page: number): Promise<ExploreCard[]>
```
Resolve the user and region itself (do not trust a client-supplied userId), then delegate to `exploreFeed`. Follow the shape of `loadPopularOnboarding` at `app/onboarding/actions.ts:85-153`, including its `Number.isInteger(page) && page > 0 ? page : 1` guard.

**Create `app/explore/loading.tsx`** — reuse `components/venn-loader.tsx`, matching the other `loading.tsx` files.

**Edit `components/mobile-navigation.tsx`:**
1. Line 10: `const APP_PATHS = ["/explore", "/search", "/groups", "/inbox", "/settings", "/movies"];`
2. Add an `ExploreIcon()` component next to the others (lines 16-52). Inline SVG only, no icon package. Match the existing style: `viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current"`, `strokeWidth="1.8"`.
3. Line 188: `grid-cols-4` → `grid-cols-5`.
4. Add `const exploreActive = pathname.startsWith("/explore");` next to the other `*Active` consts (lines 156-158), and insert a `<TabLink href="/explore" label="Explore" active={exploreActive}>` as the **second** tab, after "My list".

**Edit `components/app-header.tsx` call sites** to add an Explore link, using the exported `navLinkClass`: at minimum `app/page.tsx:78`, `app/search/page.tsx:34`, `app/groups/page.tsx:36`.

**Done when:** `pnpm build` succeeds and `/explore` renders.

---

## Task 9 — Documentation (required, not optional)

- [x] done

**Edit `docs/SPEC.md`:**
- §7: add an **Explore** screen entry. Explicitly note that it is distinct from screen 9 "Discover" (which is user/list search for phase 10).
- §9: add a row or note recording Explore as a post-phase-9 feature, following how the build-order table is written.

**Append an entry to `docs/DECISIONS.md`.** Match the voice and depth of the existing post-phase entries (`Global movie vote percentages (post-phase-7 feature)` at ~line 3450 is the closest template). Cover:
1. Why Explore was built out of band, and that SPEC §7/§9 were amended rather than contradicted.
2. Why `trailer_key` and `trailer_fetched_at` are two columns, not one.
3. That `videos` rides on `getMovie`'s existing detail call at zero extra cost, and that `getTags` was deliberately left alone.
4. The YouTube iframe as a **new external surface** for this repo — `youtube-nocookie.com`, muted autoplay only, and that unmuting remounts and restarts the trailer because the IFrame Player API was rejected to avoid a new external script. Note the API as the upgrade path.
5. The screen-and-placard layout: why controls do not overlay the video, and why the blurred backdrop makes the surrounding black load-bearing rather than empty.
6. The reduced-motion and save-data autoplay opt-outs.
7. That Explore reuses search's vote semantics unchanged, and that `setRating`'s UPDATE-only behaviour is safe here because `setWatched`/`addToList` creates the row first.

**Do not update `docs/DECISIONS.md`'s "Current phase:" line** — this is a post-phase feature, not phase 10.

**Done when:** both files contain the new content.

---

# Verification

Run from `/home/gunal1501/Projects/venn`. Requires `.env.local` with `TMDB_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### After Tasks 1 and 3
```bash
pnpm typecheck
```
Expected: no output, exit 0.

```bash
pnpm smoke:tmdb
```
Expected: ends with `PASS`. Confirms adding `append_to_response: "videos"` did not break the existing detail mapping.

### After Task 2
```bash
supabase db reset
```
Expected: every migration applies, ending with `20260802120000_explore_trailers.sql`. No error.

```bash
supabase test db
```
Expected: `All tests successful.` with **119** pgTAP assertions passing — the same count as before. Two nullable columns should not move it. If the count changes, stop and find out why before continuing.

### After Task 5
```bash
pnpm smoke:explore
```
Expected: every line begins ` ok `, final line reads `PASS  ·  N TMDB calls total`, exit 0. If any line reads `FAIL`, fix before proceeding. Run this after a fresh `supabase db reset` — a warm catalog makes the cold/warm call-count assertions meaningless (same caveat as `scripts/theatre-smoke.ts:7-9`).

### After Tasks 6, 7, 8
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all three clean. `pnpm lint` must report no `@next/next/no-img-element` errors — every hotlinked `<img>` needs its eslint-disable comment.

```bash
grep -rn "TMDB_API_KEY" .next/static/ || echo "CLEAN — no provider key in the client bundle"
```
Expected: `CLEAN — no provider key in the client bundle`. **This is a hard security gate; the repo is public.**

```bash
pnpm dev
```
Then open `http://localhost:3000/explore` and confirm each of these by hand:

| # | Check | Expected |
|---|---|---|
| 1 | Scroll the feed | Exactly one card per screen, snapping firmly |
| 2 | Scroll to the next card | Previous trailer stops — **no audio continues** |
| 3 | Find a card with no trailer | Poster fills the same frame, **no layout shift** |
| 4 | Tap `Hyped`, reload the page | Vote persisted, and that title no longer appears in the feed |
| 5 | Tap `Mark watched` | Control row switches from hype to rating |
| 6 | Then tap `Loved`, reload | Rating persisted. **This is the path that would silently no-op if `setRating` were called without a row first** |
| 7 | Tap `Add to list`, then open `/` | Title appears on the list |
| 8 | Tap the sound toggle | Audio plays (trailer restarts — expected) |
| 9 | Scroll to the bottom of the first page | More cards load, none duplicated |
| 10 | Bottom tab bar | Five tabs, Explore highlighted while on `/explore` |

### Accessibility and responsive
In Chrome DevTools → Rendering → **Emulate `prefers-reduced-motion: reduce`**, reload `/explore`:
- Expected: **no trailer autoplays.** Each card shows its poster with a working play button.

In DevTools device toolbar at **360px width**:
- Expected: the vote row does not widen the page and produces no horizontal scrollbar. `docs/DECISIONS.md`'s "VoteControl label size" entry documents this exact failure mode at ≤388px.

Tab through a card with the keyboard:
- Expected: yellow (`--marquee`) focus ring on every interactive element, in order: sound toggle → Add to list → Mark watched → the three vote buttons.

### Network
DevTools → Network, scroll through three cards:
- Expected: image requests go to `image.tmdb.org` directly (**not** `/_next/image`), and exactly one `youtube-nocookie.com` iframe document is live at a time.
