# Launch and revenue readiness

Written 2026-09-25. Vendor terms move, so re-check the sourced facts before
acting on them.

## The short answer

**Marketing it to the public for free:** close. The code is ready, and this
branch closes the signed-out gaps (below). What's left is a handful of
dashboard settings and one email, listed in order under "Before you market it".

**Earning money from it:** no, and trying now would cost money and breach two
licences. There are three separate reasons:

1. **Licences.** Any revenue, including ads, needs a TMDB commercial licence
   and Vercel Pro, from the first rupee. TMDB's terms forbid "deriving
   revenues from the use or provision of TMDB" without a separate written
   agreement. Vercel's fair-use page lists "the inclusion of advertisements,
   including but not limited to online advertising platforms like Google
   AdSense" as commercial use, which Hobby doesn't allow. Turning on
   `NEXT_PUBLIC_ADS_ENABLED` today would break both.
2. **The math.** Once revenue is on, the fixed costs are about **$194 a month**:
   TMDB commercial (reported at $149/month under $1M annual revenue; TMDB's
   FAQ says to contact sales), Vercel Pro (about $20/month per member) and
   Supabase Pro ($25/month, which you want at launch anyway, see below).
   Production had 7 profiles, 3 of them onboarded, on 2026-09-24.
3. **Ad inventory is small by design.** SPEC §1 allows ads on list views only,
   never in the picker, and phase 12 put four slots on My List and group
   lists. The screens people spend the most time on (Explore, movie pages,
   the picker) carry none.

Break-even pageviews on ad-bearing screens, per month, for $194. The RPM
figures are assumptions for illustration, not measured rates. Get real ones
from an ad network before deciding anything.

| Assumed page RPM | Ad-bearing pageviews needed per month |
|---|---|
| $0.50 | 388,000 |
| $1.00 | 194,000 |
| $2.00 | 97,000 |

So the bottleneck is users, not a way to charge them. Adding revenue costs
money and licences. Adding users costs nothing, and it's what this branch
works on.

## What this branch changed

- **Landing page.** A signed-out visit to `/` now lands on `/welcome`, which
  explains the product before asking for an account. Before, it went straight
  to a sign-in form.
- **Invite links.** Groups are the product, and an invite used to be a code
  to read out and type in after sign-up. Now "Share invite link" on a group
  page sends `/join/<code>`, and the invite survives sign-up, the age step
  and onboarding, then asks the new member to join. Tracked in PostHog as
  `group_joined` with `via: "invite_link"`.
- **Link previews.** Pasting a Venn link into WhatsApp, iMessage or Slack now
  shows a title, description and image. It showed the word "Venn" before.
- **Fixes.** `/accessibility` is readable signed out (the footer links to
  it). `robots.txt` and `sitemap.xml` exist. An expired magic link now says
  so instead of showing a blank login form.

Details and verification are in `docs/DECISIONS.md`, under "Public-launch
growth surface".

## Before you market it, in this order

1. **Pick a custom domain, before any link goes out.** Every invite link,
   QR code and post carries the domain for as long as it exists. Moving later
   means updating all of these, so do it once, now:
   - Vercel: add the domain. Keep `venn-roan.vercel.app` attached so old
     links still resolve.
   - Vercel env: `NEXT_PUBLIC_SITE_URL=https://<domain>` (link previews and
     the sitemap read it), then redeploy.
   - Supabase → Authentication → URL Configuration: the Site URL, plus
     `https://<domain>/**` in Redirect URLs.
   - Cloudflare Turnstile: add the hostname to the widget.
   - Google Cloud → OAuth consent screen: add the domain to authorized
     domains.
   - Android: `android/twa-manifest.json` `host`, then rebuild and re-sign
     the TWA. `public/.well-known/assetlinks.json` is served from the web app,
     so it follows the domain automatically.
2. **Check magic-link email reaches strangers.** Send a magic link to an
   address that is *not* a member of your Supabase organization. Supabase's
   built-in sender only delivers to organization members, at 2 messages an
   hour (Supabase docs, "Custom SMTP"). If it doesn't arrive, set up custom
   SMTP in the Supabase dashboard's Auth email settings. Resend is
   already the digest vendor (`RESEND_API_KEY`). Without this, Google is the
   only way in.
3. **Check the Google OAuth consent screen is "In production".** In
   "Testing", only listed test users can sign in with Google.
4. **Move Supabase to Pro ($25/month).** The free plan has no automatic
   backups, and it pauses a project after a week without activity (Supabase
   pricing page). Once strangers' data is in it, a lost database is the one
   failure you can't apologise your way out of.
5. **Send the TMDB email.** SPEC §2 asks for it before public launch, and it
   hasn't been sent. There's a draft below.
6. **PostHog → Error Tracking: add an alert** (the last step of the
   public-launch follow-ups). I couldn't check this from here.
7. **Have someone qualified read the Privacy Policy, Terms and the 18+ age
   step.** `docs/DECISIONS.md` already says the self-declared 18+ gate "isn't
   legal advice". A public launch is when that starts to matter.

Checked on 2026-09-25 and fine: the live login page carries the Turnstile
site key and loads the widget, and Supabase's captcha is on.

## When revenue makes sense, in order

1. **Grow first, and decide the threshold now.** Watch `group_joined`
   (`invite_link` against `invite_code`), `onboarding_completed` and logged
   nights. Pick the number (ad-bearing pageviews × a real RPM) at which
   revenue covers $194 a month with margin. Until then, stay on the free
   tiers.
2. **Donations are the only revenue that doesn't trigger Vercel Pro.** Vercel
   says donations aren't commercial use. TMDB's FAQ calls a project
   commercial when "the primary purpose is to create revenue for the benefit
   of the owner", which arguably excludes cost-covering donations, but that's
   their call. The email below asks. Don't build a tip jar until they answer.
3. **Ads, when the numbers work.** The scaffold is there
   (`NEXT_PUBLIC_ADS_ENABLED`, four slots), and phase 12's pre-revenue
   checklist in `docs/DECISIONS.md` still applies. Two things to add to it:
   ask TMDB whether its commercial licence covers the watch-provider data,
   which comes from JustWatch (JustWatch's own API reportedly forbids
   commercial use without a partnership). And have the legal review cover
   personalised-ad consent under the DPDP Act.
4. **A paid tier: not yet, in my view.** A group product dies when half the
   group hits a paywall. If you ever charge, charge for something one person
   uses alone (bigger imports, stats) and keep the picker free.

## Draft: email to TMDB

To: sales@themoviedb.org (the address TMDB's developer FAQ gives for
licensing)

> Subject: Licensing questions for a free, public movie-night app
>
> Hi,
>
> I run Venn (https://venn-roan.vercel.app), a free web app that helps a group
> of friends pick a film to watch together. It uses the TMDB API with a
> developer key. All calls are server-side, the TMDB notice is on every page,
> and cached data is refreshed or deleted before it's six months old.
>
> Before we open it to the public, I'd like to check four things:
>
> 1. Is a developer key acceptable for a free app that anyone can sign up to?
>    It earns nothing, but it isn't only for personal use.
> 2. Would voluntary donations that only cover hosting costs count as
>    commercial use?
> 3. If we later add ads, we understand we'll need a commercial licence. Is it
>    still $149 a month under $1M in annual revenue, and does it cover the
>    watch-provider data from JustWatch, or would we need a separate agreement
>    with JustWatch?
> 4. Our recommender is plain arithmetic: weighted sums over genres, keywords,
>    cast and crew. There's no machine-learning model and nothing is trained
>    on TMDB data. Can you confirm that's outside the ML/AI restriction in the
>    API terms?
>
> Thanks,
> [your name]

## Sources

- TMDB API Terms of Use: https://www.themoviedb.org/api-terms-of-use
- TMDB developer FAQ: https://developer.themoviedb.org/docs/faq
- TMDB watch providers (JustWatch attribution): https://developer.themoviedb.org/reference/movie-watch-providers
- Vercel fair use guidelines (commercial usage): https://vercel.com/docs/limits/fair-use-guidelines
- Supabase pricing (free plan pausing, backups, Pro price): https://supabase.com/pricing
- Supabase custom SMTP (default sender limits): https://supabase.com/docs/guides/auth/auth-smtp
- TMDB commercial price, as reported: https://apis.io/plans/tmdb/tmdb-plans-pricing/ and TMDB forum threads, for example https://www.themoviedb.org/talk/68ffac0758f46bb30e9fb860
