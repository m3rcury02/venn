import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import {
  IngestTokenPanel,
  type TokenRow,
} from "@/components/ingest-token-panel";
import { ShortcutSetup } from "@/components/shortcut-setup";
import { createClient } from "@/lib/supabase/server";

// SPEC §7 screen 11. Built with the ingest-token section only -- §5 says the
// token is pasted "once, from Settings", so phase 5 owes the screen a home.
// Phase 6 adds the iOS Shortcut steps and an Android install note, both of
// which need the token or the endpoint already living here. Visibility
// toggles, the notification matrix, blocks, export and delete all belong to
// later phases and are not stubbed here.
export default async function SettingsPage() {
  const supabase = await createClient();

  // Derived from the request rather than a new env var: correct on localhost
  // and on Vercel with no config to keep in sync between them.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const ingestEndpoint = `${protocol}://${host}/api/ingest`;

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // token_hash is absent from this select because it is absent from the grant:
  // authenticated holds SELECT on the other columns only. Asking for it here
  // would fail rather than leak.
  const { data: tokens } = await supabase
    .from("ingest_tokens")
    .select("id, label, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle="Settings"
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/inbox" className={navLinkClass}>
              Inbox
            </Link>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
            Ingest tokens
          </h2>
          <p className="max-w-md text-sm text-fg-muted">
            A token lets one device send you movies without signing in — share a
            link or a title and it lands in your Inbox. Generate one per device
            so a lost phone costs you one token, not all of them.
          </p>
        </div>

        <IngestTokenPanel tokens={(tokens as TokenRow[] | null) ?? []} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
            Send from your phone
          </h2>
          <p className="max-w-md text-sm text-fg-muted">
            On Android, install Venn to your home screen (⋮ → Add to Home
            screen) and it appears in the share sheet directly. PWAs
            can&rsquo;t do that on iOS, so there it&rsquo;s a Shortcut instead —
            build it once with a token from above and the steps below.
          </p>
        </div>

        <ShortcutSetup endpoint={ingestEndpoint} />
      </section>
    </main>
  );
}
