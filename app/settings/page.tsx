import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { BlockButton } from "@/components/block-button";
import { DisplayNameForm } from "@/components/display-name-form";
import {
  IngestTokenPanel,
  type TokenRow,
} from "@/components/ingest-token-panel";
import { ShortcutSetup } from "@/components/shortcut-setup";
import { VisibilityForm } from "@/components/visibility-form";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import type { ListVisibility } from "@/app/settings/actions";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type SettingsPageProps = {
  searchParams: Promise<{ tileSetup?: string }>;
};

type BlockRow = {
  blocked_id: string;
  profiles: {
    username: string | null;
    display_name: string | null;
  } | null;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const supabase = await createClient();

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const ingestEndpoint = `${protocol}://${host}/api/ingest`;
  const isAndroid = /android/i.test(requestHeaders.get("user-agent") ?? "");
  const fallbackUrl = `${protocol}://${host}/settings?tileSetup=requires-app`;
  const tileSetupIntent =
    "intent://quick-settings#Intent;" +
    "scheme=venn;" +
    "package=com.m3rcury02.venn;" +
    "action=android.intent.action.VIEW;" +
    "category=android.intent.category.BROWSABLE;" +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
  const tileSetup = (await searchParams).tileSetup;

  const { data } = await getClaims(supabase);
  if (!data?.claims) redirect("/login");

  const [{ data: profile }, { data: defaultList }, { data: tokens }, { data: rawBlocks }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", data.claims.sub)
        .single(),
      supabase
        .from("lists")
        .select("visibility")
        .eq("owner_user_id", data.claims.sub)
        .eq("is_default", true)
        .maybeSingle(),
      supabase
        .from("ingest_tokens")
        .select("id, label, created_at, last_used_at, revoked_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("blocks")
        .select("blocked_id, profiles!blocks_blocked_id_fkey(username, display_name)")
        .order("created_at", { ascending: false }),
    ]);

  const currentVisibility = (defaultList?.visibility as ListVisibility) ?? "public";
  const blocks = (rawBlocks ?? []) as unknown as BlockRow[];

  return (
    <Screen width="narrow">
      <AppHeader
        subtitle="Settings"
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/discover" className={navLinkClass}>
              Discover
            </Link>
          </>
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">Settings</h1>

      <section>
        <DisplayNameForm current={profile?.display_name ?? null} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Who can see your list</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            Control who can view your default movie list and discover your profile.
          </p>
        </div>

        <VisibilityForm current={currentVisibility} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Blocked users</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            Blocked users cannot see your profile or lists, and you cannot see theirs.
          </p>
        </div>

        {blocks.length === 0 ? (
          <p className="t-body text-[15px] text-fg-dim">No blocked users.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {blocks.map((b) => {
              const username = b.profiles?.username;
              const displayName = b.profiles?.display_name || username || "User";

              return (
                <Panel key={b.blocked_id} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-display text-[16px] font-medium text-fg">
                      {displayName}
                    </span>
                    {username ? (
                      <span className="t-body text-[14px] text-fg-dim">
                        @{username}
                      </span>
                    ) : null}
                  </div>
                  <BlockButton
                    targetUserId={b.blocked_id}
                    isBlockedInitial={true}
                  />
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col items-start gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Library imports</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            Bring ratings, watched titles, likes, and watchlists from IMDb or
            Letterboxd into your personal list.
          </p>
        </div>
        <Link href="/settings/imports" className={buttonClass("ghost")}>
          Import a library
        </Link>
      </section>

      {isAndroid ? (
        <section className="flex flex-col items-start gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="t-label text-fg-faint">Quick access</h2>
            <p className="t-body max-w-md text-[15px] text-fg-dim">
              Add Search Venn to Quick Settings to jump straight into search
              from anywhere on your phone.
            </p>
          </div>

          <a href={tileSetupIntent} className={buttonClass("ghost")}>
            Add Quick Settings tile
          </a>

          {tileSetup === "requires-app" ? (
            <p className="t-body max-w-md text-[15px] text-beam-a" role="status">
              Install or update to Venn Android v1.0.1 to use this button.
            </p>
          ) : null}

          <p className="t-body max-w-md text-[14px] text-fg-faint">
            If Android doesn&rsquo;t show a prompt, swipe down twice, tap Edit,
            then drag Search Venn into your active tiles.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Ingest tokens</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            A token lets one device send you movies without signing in — share a
            link or a title and it lands in your Inbox. Generate one per device
            so a lost phone costs you one token, not all of them.
          </p>
        </div>

        <IngestTokenPanel tokens={(tokens as TokenRow[] | null) ?? []} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Send from your phone</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            On Android, install Venn to your home screen (⋮ → Add to Home
            screen) and it appears in the share sheet directly. PWAs
            can&rsquo;t do that on iOS, so there it&rsquo;s a Shortcut instead —
            build it once with a token from above and the steps below.
          </p>
        </div>

        <ShortcutSetup endpoint={ingestEndpoint} />
      </section>
    </Screen>
  );
}
