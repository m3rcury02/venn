# Venn

**Movie night, minus the argument.** Everyone keeps their own watchlist. When
it's time to choose, Venn picks three films the whole room will enjoy, and
says why.

- **Lists and votes.** Add movies and shows from search, a trailer feed, or your
  phone's share sheet. Rate what you've seen (hated / liked / loved), hype what
  you haven't.
- **Groups and movie nights.** Tap who's here, or send a lobby link for a remote
  night. The picker scores every film for every person and weights toward the
  least keen (`0.7 × lowest + 0.3 × average`), so nobody quietly resents the
  pick. Theatre mode does the same for what's in cinemas.
- **Imports.** Letterboxd and IMDb history in one go.
- **Installable.** A PWA with push notifications, an Android share target, and
  an iOS Shortcut.

The product spec is [`docs/SPEC.md`](docs/SPEC.md). Every decision made while
building it, and why, is in [`docs/DECISIONS.md`](docs/DECISIONS.md) -- read
the relevant section there before changing anything structural.

## Stack

Next.js 16 (App Router) on Vercel · Supabase (Postgres, RLS, auth) · TMDB
behind a swappable provider interface (`lib/providers/`) · Tailwind CSS 4 ·
Motion · PostHog · Web Push · Resend.

## Running it locally

Needs Node 22, pnpm, and Docker (for the local Supabase stack).

```bash
pnpm install
pnpm exec supabase start      # local Postgres, auth, PostgREST, Mailpit
cp .env.example .env.local    # then fill it in -- the file explains each value
pnpm dev                      # http://localhost:3000
```

`pnpm exec supabase status` prints the local URL and keys for `.env.local`.
Magic-link emails land in Mailpit at http://127.0.0.1:54324. Without a real
`TMDB_API_KEY` the app runs, but search, Explore and live availability come
back empty.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm exec supabase test db    # pgTAP: RLS, functions, rate limits
pnpm smoke:ingest             # no network or database needed
pnpm smoke:imports            # no network or database needed
```

CI (`.github/workflows/ci.yml`) runs all of these, plus migration-drift and
secret-scanning jobs. The other `smoke:*` scripts need a local stack and, for
some, a TMDB key; each says so at the top.

## Environment

`.env.example` documents the variables needed to run. Production also uses:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public origin for share cards and the sitemap. Optional on Vercel, which provides `VERCEL_PROJECT_PRODUCTION_URL`. |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics and error tracking. Set the host to your PostHog project's region (`https://us.i.posthog.com` or `https://eu.i.posthog.com`). |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. |
| `RESEND_API_KEY`, `CRON_SECRET` | Weekly email digest and the Vercel cron routes. |
| `INGEST_TOKEN_PEPPER` | Hashes share/Shortcut ingest tokens. Required: the build throws without it. |
| `ADMIN_USER_IDS` | Comma-separated user ids allowed into `/moderation`. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `RATE_LIMIT_IP_SECRET` | Captcha on the magic-link form, and the key for per-network rate limits. |
| `NEXT_PUBLIC_ADS_ENABLED` | Leave unset. Turning on revenue changes the TMDB and Vercel licence terms (SPEC §2). |

Never prefix a server secret with `NEXT_PUBLIC_` -- this repo is public, and
anything with that prefix ships to the browser.

## Database changes

Schema changes go in a new file under `supabase/migrations/`, with tests in
`supabase/tests/rls.test.sql`. Apply to production before deploying code that
depends on it; `docs/DECISIONS.md` records how each migration reached the
remote project.

## Credits

Film data and images from [TMDB](https://www.themoviedb.org). This product uses
the TMDB API but is not endorsed or certified by TMDB. Streaming availability
by JustWatch, via TMDB.
