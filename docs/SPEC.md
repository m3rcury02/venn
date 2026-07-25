# Venn — Requirements Spec v2 (locked)

Shared movie lists and group recommendations. Personal libraries, friend groups, and a picker that suggests what everyone present actually wants to watch.

**Path:** private build for 4–6 friends → public launch. Solo developer, AI agents writing code. Mixed iOS/Android.

---

## 1. Core Decisions

| Area | Choice | Notes |
|---|---|---|
| Distribution | PWA, installable | No dev account. Native iOS wrapper later via Capacitor if the data justifies it |
| Frontend | Next.js on Vercel free tier | API routes co-located, needed for the ingest endpoint |
| Backend | Supabase free tier | Postgres, magic-link auth, RLS, pgvector |
| Movie data | TMDB, behind a swappable provider interface | See §2 |
| Vectors | pgvector extension | Taste vectors computed in-database |
| Push | Web Push | Works on Android PWA and iOS PWA when installed to home screen |
| Email | Resend or similar free tier | Supabase's built-in email is not production-grade |
| Analytics | PostHog free tier | From day one |
| Ads | AdMob, **test mode only until §2 threshold** | List views only, never in the picker |

---

## 2. The Money Constraint

TMDB's developer key is for applications generating **no revenue**. A commercial key is $149/month (~₹13,000), a fixed cost from the first live ad.

**Sequence:**
1. **Dev:** AdMob in test mode. Test ads generate no revenue → developer key stays legitimate.
2. **Public launch:** ship free, no live ads.
3. **Flip ads on** only past roughly 10,000 MAU, where ₹13,000/mo is a rounding error.

**Action item before public launch:** email TMDB and confirm in writing that a free, zero-revenue public app is acceptable on a developer key. Their wording says "personal applications," which is ambiguous at scale. Get it in writing.

**Attribution is mandatory:** TMDB logo plus the notice "This product uses the TMDB API but is not endorsed or certified by TMDB" in an About/Credits section. On termination you must purge all cached TMDB content — which our design caches, so this is a real obligation.

### Provider interface (build this from day one)

```ts
interface MovieDataProvider {
  search(query: string, region: string): Promise<MovieSummary[]>
  getMovie(id: string): Promise<Movie>
  getTags(id: string): Promise<Tag[]>          // genres, keywords, cast, director
  getWatchProviders(id: string, region: string): Promise<Provider[]>
  getImageUrl(path: string, size: ImageSize): string
  findByExternalId(imdbId: string): Promise<Movie | null>
  nowPlaying(region: string): Promise<MovieSummary[]>
  upcoming(region: string): Promise<MovieSummary[]>
}
```

Escape hatches: OMDb paid tier, Watchmode. Note that **metadata is easy to replace (Wikidata is CC0), posters are not** — images are copyrighted regardless of provider.

---

## 3. Data Model

```
profiles            id → auth.users, username UNIQUE, display_name, avatar_url,
                    region, list_visibility_default, created_at

follows             follower_id, followee_id, created_at
blocks              blocker_id, blocked_id, created_at

groups              id, name, invite_code, visibility (invite|public), created_by
group_members       group_id, user_id, role, joined_at

movies              provider_id PK, provider (tmdb|omdb|…), title, original_title,
                    year, poster_path, backdrop_path, runtime, overview,
                    rating_external, release_date, fetched_at
movie_tags          provider_id, tag_type (genre|keyword|person), tag_value, weight
movie_releases      provider_id, region, release_date, release_type   -- theatre mode

lists               id, name, owner_type (user|group), owner_id,
                    visibility (public|followers|private), is_default
list_items          list_id, provider_id, added_by, note, added_at
list_hidden_from    list_id, user_id            -- per-user hiding

user_movie_status   user_id, provider_id,
                    watched bool,
                    rating enum(hate|like|love)          NULL,  -- iff watched
                    hype  enum(dont_care|hyped|superhyped) NULL, -- iff NOT watched
                    watched_at, updated_at
                    CHECK (watched AND hype IS NULL) OR (NOT watched AND rating IS NULL)

hype_history        user_id, provider_id, hype, recorded_at, resolved_rating
                    -- preserves pre-watch hype so hype-vs-reality stays computable

taste_vectors       user_id, vector vector(N), updated_at   -- pgvector

ingest_inbox        id, user_id, raw_text, source (android_share|ios_shortcut|paste),
                    status (pending|resolved|rejected), candidate_ids,
                    resolved_id, created_at
ingest_tokens       id, user_id, token_hash, label, last_used_at, revoked_at

movie_nights        id, group_id, mode (home|theatre), held_at, member_ids[],
                    candidates[], picked_id
watch_confirmations movie_night_id, user_id, status (pending|confirmed|declined)

imports             id, user_id, source (imdb|letterboxd), status, total, matched,
                    unmatched_rows jsonb, created_at
reports             id, reporter_id, target_type, target_id, reason, status, created_at

notification_prefs  user_id, category, push bool, email bool
```

**RLS on every table.** A user reads their own rows, plus lists that are public, or owned by a group they belong to, or owned by someone they follow where visibility = followers — minus anything in `list_hidden_from` or `blocks`.

---

## 4. The Recommender

Runs on **members marked present**, in either `home` or `theatre` mode.

### 4.1 Taste vector (per user, stored in pgvector)
Built from rated movies' tags — genre ×3, person ×2, keyword ×1:

| Rating | Weight |
|---|---|
| love | +3 |
| like | +1 |
| hate | **−2** |

The negative weight is the important one. It's what stops the picker repeating a mistake the group already rejected. Normalize so a user with 500 imported films doesn't drown out one with 12. Recompute on rating change.

### 4.2 Candidate pool
- **home mode:** movies on any list in the group
- **theatre mode:** `nowPlaying(region)` ∪ upcoming within N weeks, for the region shared by present members
- Excluded: anything **any present member has watched**
- **Widen:** if fewer than ~10 candidates, pull provider recommendations seeded by the group's top-rated films and flag them "not on your lists yet." (This is the "most of the list is watched" case.)

### 4.3 Scoring — hype overrides taste
For each candidate `c` and present member `m`:

```
if m has a hype vote on c:
    score(m,c) = { superhyped: 1.0, hyped: 0.7, dont_care: 0.25 }
else:
    score(m,c) = cosine(taste_vector[m], tag_vector[c])
```

> An explicit vote is stronger evidence than an inferred one. Taste similarity is the prior; the hype vote is the observation. Note `dont_care` is 0.25, not 0 — indifference shouldn't be fatal, only hatred should.

```
group_score(c) = 0.7 × min(scores) + 0.3 × mean(scores)
```

The `min` term is load-bearing: averaging alone lets the loudest taste in the group dominate and produces picks one person quietly resents. Weighting toward the minimum optimizes for *nobody objects*.

Tie-break: fewer members have seen it → higher external rating → shorter runtime. **Return top 3.**

All weights live in one config file. You will tune them.

### 4.4 Explanations
Generated from scoring components, no LLM:
- "All 4 of you are hyped for this" (strongest — lead with hype when present)
- "3 of 4 love Christopher Nolan"
- "Matches: sci-fi, heist, mind-bending"
- "Nobody here has seen it"

### 4.5 Edge cases
- **Cold start:** signup requires rating 10 popular movies. A member with no signal is excluded from the `min` term.
- **Reroll:** exclude the previous three, recompute.
- **None of these:** log it — useful signal.
- **Remote nights:** a lobby with a join link; present-members list fills as people join.

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

**iOS:** PWAs cannot be share targets. Ship a Shortcut — receive text → POST to `/api/ingest` → notification. User pastes their ingest token once, from Settings. Treat the token as low-trust: ingest scope only, revocable.

**Instrument every ingest with its source.** That number is what decides whether the $99/yr Apple account is worth it.

---

## 6. Imports

**Build IMDb first** — its export contains the IMDb ID, which resolves directly via `findByExternalId`. Letterboxd exports only title + year, requiring fuzzy matching and an unmatched-review queue.

| Source | hate | like | love |
|---|---|---|---|
| Letterboxd (0.5–5) | ≤ 2.0 | 2.5–3.5 | ≥ 4.0 |
| IMDb (1–10) | ≤ 4 | 5–7 | ≥ 8 |

- Letterboxd's separate "liked" file → **love**, regardless of stars.
- Filter IMDb export by title type — it includes TV, and we're movies-only.
- Watchlist entries import as **unwatched, no hype vote** (neutral).
- Run as a background job with progress. Unmatched rows go to a review queue.

---

## 7. Screens

1. **Auth** — magic link
2. **Onboarding** — username, region, rate 10 popular movies
3. **My List** — filter by watched / unwatched / rating / hype
4. **Group List** — who added what
5. **Inbox** — pending shares, candidate picker
6. **Movie Night** — mode (home/theatre) → who's present (checklist or join link) → Top 3 with reasons → pick → logs night, prompts confirmations
7. **Movie Detail** — poster, overview, runtime, where to watch, vote control (rating if watched, hype if not)
8. **Profile** — public username, public lists, follow button
9. **Discover** — search users, browse public lists and groups
10. **Stats** — watch history, hype-vs-reality
11. **Settings** — groups, ingest token + shortcut install, visibility toggles, notification matrix, blocks, export, delete account

---

## 8. Notifications

Per-category, per-channel toggles:

| Category | Push default | Email default |
|---|---|---|
| Watch confirmation request | ✅ | — |
| Movie night invite | ✅ | — |
| New follower | ✅ | — |
| Friend added a movie | ❌ **digest only** | — |
| Weekly digest | — | ✅ |

"Friend added a movie" is fine at 5 follows and unusable at 200. Do not default it to push.

**Watch confirmation flow:** person A marks watched + rates → others in that `movie_nights.member_ids` get a confirmation prompt → each confirms and rates independently. Scoped to the night; a solo watch notifies nobody.

---

## 9. Build Order

**v1 — friends, core loop**
Auth · personal list · search + add · unified vote (rating/hype) · invite-code groups · group list · Top-3 picker (home mode) · Android share target · iOS shortcut · Inbox

**v2 — pre-launch hardening**
10-movie onboarding · IMDb import · Letterboxd import · **theatre mode** (same picker, release filter) · public profiles, follows, visibility toggles, blocks · notification matrix · moderation basics · analytics · account deletion + export · privacy policy + terms

**v3 — post-launch**
Hype-vs-reality stats · live ads · publicly joinable groups · subscription tier

---

## 10. Non-Goals

State these in agent prompts or they will get built unasked: no TV shows, no native app in v1, no comments or DMs, no LLM calls at runtime, no admin dashboard beyond a moderation view, no payments before v3.

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

- **Public repo:** any `NEXT_PUBLIC_` var ships to the browser. Agents will put the TMDB key there by default. All provider calls server-side. Add `gitleaks` as a pre-commit hook.
- **Never re-host posters.** Hotlink the provider CDN — keeps Supabase storage and egress near zero.
- **Tests:** shipping fast is fine, but write ~10 RLS tests. A non-member must not read a group's list; a user must not read another's private ratings. An RLS bug doesn't crash, it silently serves everyone's data to everyone.
- **Moderation before public launch:** report button, block user, username blocklist, admin delete view. Free-text list names and notes are where abuse appears. Under Indian IT rules you are responsible for what you host.
- **DPDP Act:** account deletion and data export are not optional at public launch.
- Rate-limit `/api/ingest` per token.
