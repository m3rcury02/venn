# Venn — Requirements Spec

Shared movie lists and group recommendations. Personal libraries, friend groups, and a picker that suggests what everyone present actually wants to watch.

**Path:** private build for 4–6 friends → public launch. Solo developer, AI agents writing code. Mixed iOS/Android.

---

## 1. Core Decisions

| Area | Choice | Notes |
|---|---|---|
| Distribution | Installable PWA + private Android TWA | The TWA adds Android Quick Settings search without duplicating the web UI. Native iOS wrapper later via Capacitor if the data justifies it |
| Frontend | Next.js on Vercel | Hobby tier during development — see §2 |
| Backend | Supabase free tier | Postgres, Google OAuth (primary) + magic-link (secondary) auth, RLS |
| Movie data | TMDB, behind a swappable provider interface | See §2 |
| Scoring | Plain SQL over normalized tag tables | **Not pgvector.** See §4 |
| Push | Web Push | Works on Android PWA and iOS PWA when installed to home screen |
| Email | Resend or similar free tier | Supabase's built-in email is not production-grade |
| Analytics | PostHog free tier | From day one |
| Ads | Deferred — see §2 | If ever added: list views only, never in the picker |

---

## 2. Cost and Licensing Constraints

**Verify these numbers with the vendors directly before they drive a decision.** They come from secondary sources and vendor pages that were internally inconsistent.

- **TMDB:** developer key is for applications generating no revenue. Commercial key reportedly $149/month.
- **TheTVDB:** reportedly free under $50k/year revenue with attribution, rising in tiers above that. Their own licensing text was ambiguous on whether a negotiated key is still required — ask.
- **Vercel:** the Hobby tier prohibits commercial use. Revenue means Pro at ~$20/month.

**The sequence:**
1. **Dev and early public:** free, no revenue. TMDB developer key, Vercel Hobby — both legitimate.
2. **Monetize only when scale justifies it.** Turning on revenue triggers TMDB commercial *and* Vercel Pro on the same day. Both are fixed costs owed from your first rupee.

**Action before public launch:** email TMDB to confirm a free, zero-revenue *public* app is acceptable on a developer key — their wording says "personal applications," which is ambiguous at scale. Ask about their clause restricting use with machine-learning or AI-based applications in the same email; the recommender here is algorithmic, not ML-trained, but it's worth having in writing.

**Attribution is a licence condition:** TMDB logo plus "This product uses the TMDB API but is not endorsed or certified by TMDB" in an About/Credits section. On termination you must purge cached TMDB content — this design caches, so it's a real obligation.

### Provider interface

```ts
interface MovieDataProvider {
  search(query: string, region: string): Promise<MovieSummary[]>
  getMovie(externalId: string): Promise<Movie>
  getTags(externalId: string): Promise<Tag[]>          // genres, keywords, cast, director
  getWatchProviders(externalId: string, region: string): Promise<Provider[]>
  getImageUrl(path: string, size: ImageSize): string
  findByImdbId(imdbId: string): Promise<Movie | null>
  nowPlaying(region: string): Promise<MovieSummary[]>
  upcoming(region: string): Promise<MovieSummary[]>
}
```

`externalId` is provider-scoped by media type (`"movie-27205"`, `"tv-1396"` for TMDB) —
TMDB's movie and TV id spaces are independent and both start at 1, so a bare numeric id
is ambiguous. `Movie` and `MovieSummary` both carry a `mediaType: "movie" | "tv"`.
`nowPlaying`/`upcoming` (theatre mode, phase 9) stay movie-only.

**Escape hatches, in order of viability:** TheTVDB (revenue-tiered, has movies), Watchmode or the Streaming Availability API (availability data only, both have free tiers).

**OMDb is not an option** — its data licence is CC BY-NC 4.0, non-commercial on every tier including paid.

**Untested assumption:** the recommender leans on TMDB *keywords*. TheTVDB is TV-first and may not have an equivalent. Test movie coverage and tag richness on ten films during phase 1a, before treating it as a real escape hatch. Fallback if keywords are absent: genres + cast + director only, which is weaker but functional.

---

## 3. Data Model

Movie identity is **provider-agnostic**. Internal IDs never change when you swap providers; only the external-ID mapping does.

```
-- Identity
profiles              id PK → auth.users, username UNIQUE, display_name,
                      avatar_url, region, default_list_visibility, created_at

follows               follower_id, followee_id, created_at
                      PK (follower_id, followee_id)
                      CHECK (follower_id <> followee_id)

blocks                blocker_id, blocked_id, created_at
                      PK (blocker_id, blocked_id)
                      CHECK (blocker_id <> blocked_id)

-- Groups
groups                id PK, name, invite_code UNIQUE, visibility (invite|public),
                      created_by, created_at
group_members         group_id, user_id, role, joined_at
                      PK (group_id, user_id)

-- Catalog
movies                id PK (uuid), title, original_title, year, poster_path,
                      backdrop_path, runtime, overview, rating_external,
                      release_date, media_type (movie|tv), fetched_at
movie_external_ids    movie_id, provider, external_id
                      PK (provider, external_id)
                      UNIQUE (movie_id, provider)
tags                  id PK (serial), tag_type (genre|keyword|person), tag_value
                      UNIQUE (tag_type, tag_value)
movie_tags            movie_id, tag_id, weight
                      PK (movie_id, tag_id)
movie_releases        movie_id, region, release_date, release_type
                      PK (movie_id, region, release_type)

-- Lists
lists                 id PK, name, owner_user_id NULL, owner_group_id NULL,
                      visibility (public|followers|private), is_default, created_at
                      CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
list_items            list_id, movie_id, added_by, note, added_at
                      PK (list_id, movie_id)
list_hidden_from      list_id, user_id
                      PK (list_id, user_id)

-- Status and taste
user_movie_status     user_id, movie_id, watched, rating (hate|like|love) NULL,
                      hype (dont_care|hyped|superhyped) NULL, watched_at, updated_at
                      PK (user_id, movie_id)
                      CHECK ((watched AND hype IS NULL)
                          OR ((NOT watched) AND rating IS NULL))
hype_history          id PK, user_id, movie_id, hype, recorded_at, resolved_rating
user_tag_weights      user_id, tag_id, weight
                      PK (user_id, tag_id)

-- Ingest
ingest_inbox          id PK, user_id, raw_text, source (android_share|ios_shortcut|paste),
                      status (pending|resolved|rejected), candidate_movie_ids,
                      resolved_movie_id, created_at
ingest_tokens         id PK, user_id, token_hash, label, last_used_at, revoked_at

-- Movie nights
movie_nights          id PK, group_id, mode (home|theatre), held_at,
                      picked_movie_id, created_by
movie_night_attendees movie_night_id, user_id
                      PK (movie_night_id, user_id)
watch_confirmations   movie_night_id, user_id, status (pending|confirmed|declined)
                      PK (movie_night_id, user_id)

-- Ops
imports               id PK, user_id, source (imdb|letterboxd), status, total,
                      matched, unmatched_rows jsonb, created_at
reports               id PK, reporter_id, target_type, target_id, reason,
                      status, created_at
notification_prefs    user_id, category, push, email
                      PK (user_id, category)
```

**Notes on the design:**
- `movies.id` is a surrogate UUID. Provider IDs live in `movie_external_ids`, so migrating providers remaps one table instead of breaking every foreign key.
- `tags` is normalized to integers. A user with 500 imported films generates thousands of tag rows; storing tag strings on every row would blow past the 500 MB free tier far sooner.
- `lists` uses two nullable owner columns with a check constraint rather than a polymorphic `owner_type`/`owner_id` pair, so foreign keys are actually enforced.
- `user_movie_status` allows `rating IS NULL` while watched — the vote is prompted, not blocking (§8).
- `movies` and `movie_tags` are a **local cache**. Fetch once on first sighting, never per read.
- `movies.media_type` distinguishes movies from TV series. A series is one row —
  no season or episode modeling. **Group-owned lists (`owner_group_id` set) only
  accept `media_type = 'movie'`**, enforced by `list_items`'s insert/update policies:
  the recommender (§4) draws its candidate pool from group lists, and its scoring
  (runtime tie-break, `nowPlaying`/`upcoming` candidate sourcing) is movie-shaped.
  Personal lists accept both.

**RLS on every table.** A user reads their own rows, plus lists that are public, or owned by a group they belong to, or owned by someone they follow where visibility = `followers` — minus anything in `list_hidden_from` or `blocks`.

---

## 4. The Recommender

Runs on **members marked present**, in either `home` or `theatre` mode.

### 4.1 Tag weights per user

Rebuilt when a user's rating changes. For each rated movie and each of its tags:

```
contribution = rating_weight × tag_type_weight

rating_weight:    love +3 · like +1 · hate −2
tag_type_weight:  genre ×3 · person ×2 · keyword ×1
```

Sum per tag into `user_tag_weights`, then divide by the user's rated-movie count so someone with 500 imported films doesn't drown out someone with 12.

The negative weight on `hate` is the important one — it's what stops the picker repeating a mistake the group already rejected.

### 4.2 Candidate pool
- **home mode:** movies on any list in the group (group lists are movies-only, §3)
- **theatre mode:** `nowPlaying(region)` ∪ upcoming within N weeks, for the region shared by present members
- Excluded: anything **any present member has watched**
- **Widen:** if fewer than ~10 candidates, pull provider recommendations seeded by the group's top-rated films and flag them "not on your lists yet." This is the "most of the list is watched" case.

### 4.3 Scoring

**Step 1 — raw taste score.** A join and sum:

```sql
raw(m,c) = Σ over tags t of c:  user_tag_weights[m,t] × movie_tags[c,t]
```

**Step 2 — normalize per member across the candidate set.** This step is not optional: raw scores can be negative (because `hate` is −2), while hype values sit in [0.25, 1]. Blending them unnormalized systematically punishes taste-scored candidates against hype-scored ones.

```
taste(m,c) = (raw(m,c) − min) / (max − min)     across all candidates for member m
```

If `max == min`, set `taste(m,c) = 0.5` for all candidates.

**Step 3 — hype overrides taste.**

```
score(m,c) = { superhyped: 1.0, hyped: 0.7, dont_care: 0.25 }  if m voted on c
             taste(m,c)                                         otherwise
```

> An explicit vote is stronger evidence than an inferred one. Taste similarity is the prior; the hype vote is the observation. `dont_care` is 0.25, not 0 — indifference shouldn't be fatal, only hatred should.

**Step 4 — aggregate.**

```
group_score(c) = 0.7 × min(scores) + 0.3 × mean(scores)
```

The `min` term is load-bearing: averaging alone lets the loudest taste in the group dominate and produces picks one person quietly resents. Weighting toward the minimum optimizes for *nobody objects*.

Tie-break: fewer members have seen it → higher external rating → shorter runtime. **Return top 3.**

All weights live in one config file. You will tune them.

### 4.4 Explanations
Generated from scoring components, no LLM:
- "All 4 of you are hyped for this" — strongest, lead with hype when present
- "3 of 4 love Christopher Nolan"
- "Matches: sci-fi, heist, mind-bending"
- "Nobody here has seen it"

### 4.5 Edge cases
- **Cold start:** signup requires rating 10 popular movies. A member with no tag weights is excluded from the `min` term.
- **Reroll:** exclude the previous three, recompute.
- **None of these:** log it — useful signal.
- **Remote nights:** a lobby with a join link; `movie_night_attendees` fills as people join.

---

## 5. Share-to-App Ingestion

**This is the daily engagement loop, not a convenience feature.** Movie night is weekly; Instagram and YouTube are constant. Prioritize accordingly.

### `POST /api/ingest` — `{ text, url?, token }`
1. Verify token against `ingest_tokens` (hashed at rest). **Return 200 immediately.**
2. Insert as `pending`.
3. Extract candidates, highest confidence first:
   - a TMDB / IMDb / Letterboxd URL in the text → parse the ID directly
   - `Title (Year)` patterns
   - quoted strings
   - Title Case runs, after stripping URLs and boilerplate
4. Resolve against the provider.
5. **One high-confidence match** → add to default list, mark resolved.
6. **Otherwise** → stay pending, badge the **Inbox**, user disambiguates later.

> Never guess. A silent wrong add is worse than a badge.

**Android:** Web Share Target in `manifest.json` (`action: /share`, POST, multipart, params `title`/`text`/`url`). Requires home-screen install.

**iOS:** PWAs cannot be share targets. Ship a Shortcut — receive text → POST to `/api/ingest` → notification. User pastes their ingest token once, from Settings. Treat the token as low-trust: ingest scope only, revocable, rate-limited.

**Instrument every ingest with its source.** That number decides whether the Apple developer account is worth it.

---

## 6. Imports

**Build IMDb first** — its export contains the IMDb ID, which resolves directly via `findByImdbId`. Letterboxd exports only title and year, requiring fuzzy matching and an unmatched-review queue.

| Source | hate | like | love |
|---|---|---|---|
| Letterboxd (0.5–5) | ≤ 2.0 | 2.5–3.5 | ≥ 4.0 |
| IMDb (1–10) | ≤ 4 | 5–7 | ≥ 8 |

- Letterboxd's separate "liked" file → **love**, regardless of stars.
- IMDb's export includes TV — import both, mapping the export's title type to
  `movies.media_type`. Letterboxd exports are films only, so every row imports as
  `media_type = 'movie'`.
- Watchlist entries import as **unwatched, no hype vote**.
- Background job with progress. Unmatched rows go to a review queue.
- **Rebuild `user_tag_weights` once at the end**, not per row.

---

## 7. Screens

1. **Auth** — Google OAuth (primary), magic link (secondary)
2. **Onboarding** — username, region, rate 10 popular movies
3. **My List** — filter by watched / unwatched / rating / hype
4. **Group List** — who added what
5. **Inbox** — pending shares, candidate picker
6. **Movie Night** — mode (home/theatre) → who's present (checklist or join link) → Top 3 with reasons → pick → logs night, prompts confirmations
7. **Movie Detail** — poster, overview, runtime, where to watch, global hype/love percentages, vote control (rating if watched, hype if not)
8. **Profile** — public username, public lists, follow button
9. **Discover** — search users, browse public lists and groups
10. **Stats** — watch history, hype-vs-reality
11. **Settings** — groups, ingest token + shortcut install, visibility toggles, notification matrix, blocks, export, delete account

**Movie-detail global percentages use current votes.** "Hyped" is
`hyped | superhyped` divided by all non-null hype votes (including
`dont_care`); "Loved" is `love` divided by all non-null watched ratings. The
two pools are independent, round to whole percentages, and show no percentage
when their relevant pool is empty. When a user marks a title watched, their
cleared hype vote leaves the hype pool and their rating enters the rating pool.

---

## 8. Notifications

| Category | Push default | Email default |
|---|---|---|
| Watch confirmation request | ✅ | — |
| Movie night invite | ✅ | — |
| New follower | ✅ | — |
| Friend added a movie | ❌ **digest only** | — |
| Weekly digest | — | ✅ |

"Friend added a movie" is fine at 5 follows and unusable at 200. Do not default it to push.

**Watch confirmation flow:** person A marks watched and rates → everyone in `movie_night_attendees` for that night gets a confirmation prompt → each confirms and rates independently. Scoped to the night; a solo watch notifies nobody.

**Rating is prompted, never blocking.** Badge it, nag it gently, allow snooze. Mandatory modals get apps deleted.

---

## 9. Build Order

Phases are built in order. **Do not build ahead of the current phase.** The current phase is recorded at the top of `docs/DECISIONS.md`.

| Phase | Deliverable | Release |
|---|---|---|
| 0 | Supabase schema, RLS policies, magic-link auth | v1 |
| 1a | `MovieDataProvider` interface + TMDB adapter, movie cache write-through | v1 |
| 1b | Search UI, add to list, list views | v1 |
| 2 | Unified vote — rating if watched, hype if not — and watched status | v1 |
| 3 | Groups, invite codes, group lists, multi-user RLS | v1 |
| 4 | Tag weights, Top-3 recommender, explanations, reroll | v1 |
| 5 | `/api/ingest`, ingest tokens, Inbox resolution UI | v1 |
| 6 | Android Web Share Target, iOS Shortcut | v1 |
| 7 | PWA polish — icons, install prompt, offline shell | v1 |
| 8 | 10-movie onboarding, IMDb import, Letterboxd import | v2 |
| 9 | Theatre mode — same picker, release-status filter | v2 |
| 10 | Public profiles, follows, visibility toggles, blocks | v2 |
| 11 | Notification matrix, moderation, analytics, deletion + export, legal pages | v2 |
| 12 | Hype-vs-reality stats, joinable groups, monetization | v3 |

---

## 10. Non-Goals

State these in agent prompts or they will get built unasked: no seasons or episodes for TV (a series is one title, §3), no TV on group lists (§3), no separate native UI in v1 (the Android TWA is only a signed wrapper around the web app), no comments or DMs, no LLM calls at runtime, no admin dashboard beyond a moderation view, no payments before phase 12, **no pgvector** — §4 is plain SQL by design.

---

## 11. Security & Compliance

```
TMDB_API_KEY                 # server-side ONLY — never NEXT_PUBLIC_
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY    # server-side only
RESEND_API_KEY
INGEST_TOKEN_PEPPER
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

- **Public repo:** any `NEXT_PUBLIC_` var ships to the browser. Agents will put the TMDB key there by default. All provider calls server-side. `gitleaks` as a pre-commit hook.
- **Never re-host posters.** Hotlink the provider CDN — keeps Supabase storage and egress near zero.
- **Tests:** shipping fast is fine, but write ~10 RLS tests. A non-member must not read a group's list; a user must not read another's private ratings. An RLS bug doesn't crash, it silently serves everyone's data to everyone.
- **Moderation before public launch:** report button, block user, username blocklist, admin delete view. Free-text list names and notes are where abuse appears. Under Indian IT rules you are responsible for what you host.
- **DPDP Act:** account deletion and data export are not optional at public launch.
- Rate-limit `/api/ingest` per token.
