"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isIos, isStandalone, useDeferredInstallPrompt } from "@/lib/pwa-install";
import { VennMark } from "@/components/venn-mark";

const APP_PATHS = ["/explore", "/search", "/groups", "/inbox", "/settings", "/movies", "/discover", "/u", "/stats"];

function isAppPath(pathname: string) {
  return pathname === "/" || APP_PATHS.some((path) => pathname.startsWith(path));
}

function MyListIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <path d="M6 5.5h12M6 12h12M6 18.5h8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ExploreIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <rect x="3.5" y="3.5" width="17" height="17" strokeWidth="1.8" />
      <path d="M10 9v6l5-3z" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <circle cx="10.5" cy="10.5" r="5.5" strokeWidth="1.8" />
      <path d="m15 15 4 4" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GroupsIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <circle cx="9" cy="9" r="3.25" strokeWidth="1.8" />
      <circle cx="15" cy="9" r="3.25" strokeWidth="1.8" />
      <path d="M3.75 19c.6-3.25 2.35-4.9 5.25-4.9s4.65 1.65 5.25 4.9" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13 14.3c.62-.14 1.29-.2 2-.2 2.9 0 4.65 1.65 5.25 4.9" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <path d="m6 6 12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ActiveLine({ active }: { active: boolean }) {
  return active ? (
    <span aria-hidden className="absolute inset-x-0 top-0 mx-auto h-0.5 w-6 bg-marquee" />
  ) : null;
}

function TabLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-1 transition-colors ${
        active ? "text-fg" : "text-fg-faint hover:text-fg"
      }`}
    >
      <ActiveLine active={active} />
      {children}
      <span className="t-label text-[9px] tracking-[0.12em]">{label}</span>
    </Link>
  );
}

function CountBadge({ count }: { count: number | null }) {
  if (!count || count < 1) return null;

  return (
    <span className="t-data rounded-ctl bg-marquee px-1.5 py-0.5 text-[10px] leading-none text-on-beam">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [supabase] = useState(createClient);
  const { canPrompt, promptInstall } = useDeferredInstallPrompt();
  const [showInstallRow, setShowInstallRow] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  const fetchInboxCount = useCallback(async () => {
    const { count, error } = await supabase
      .from("ingest_inbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return error ? null : (count ?? 0);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    if (dialogRef.current?.open) dialogRef.current.close();
    if (isAppPath(pathname)) {
      void fetchInboxCount().then((count) => {
        if (!cancelled && count !== null) setInboxCount(count);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [pathname, fetchInboxCount]);

  useEffect(() => {
    if (!moreOpen) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [moreOpen]);

  useEffect(() => {
    // matchMedia/navigator don't exist during SSR -- starting hidden and
    // revealing here once mounted, same pattern as install-prompt.tsx.
    if (isStandalone()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowInstallRow(true);
    setShowIosSteps(isIos());
  }, []);

  if (!isAppPath(pathname)) return null;

  const myListActive = pathname === "/";
  const exploreActive = pathname.startsWith("/explore");
  const searchActive = pathname.startsWith("/search");
  const groupsActive = pathname.startsWith("/groups");
  const moreActive =
    moreOpen || pathname.startsWith("/inbox") || pathname.startsWith("/settings");
  const installVisible = showInstallRow && (canPrompt || showIosSteps);

  function openMore() {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setMoreOpen(true);
    void fetchInboxCount().then((count) => {
      if (count !== null) setInboxCount(count);
    });
  }

  function closeMore() {
    dialogRef.current?.close();
  }

  async function install() {
    await promptInstall();
    closeMore();
  }

  return (
    <>
      <div aria-hidden className="h-16 shrink-0 sm:hidden" />
      <nav
        data-mobile-nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          <TabLink href="/" label="My list" active={myListActive}>
            <MyListIcon />
          </TabLink>
          <TabLink href="/explore" label="Explore" active={exploreActive}>
            <ExploreIcon />
          </TabLink>
          <TabLink href="/search" label="Search" active={searchActive}>
            <SearchIcon />
          </TabLink>
          <TabLink href="/groups" label="Groups" active={groupsActive}>
            <GroupsIcon />
          </TabLink>
          <button
            type="button"
            aria-current={
              pathname.startsWith("/inbox") || pathname.startsWith("/settings")
                ? "page"
                : undefined
            }
            aria-expanded={moreOpen}
            aria-controls="mobile-more-menu"
            onClick={openMore}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 transition-colors ${
              moreActive ? "text-fg" : "text-fg-faint hover:text-fg"
            }`}
          >
            <ActiveLine active={moreActive} />
            <span className="relative">
              <MoreIcon />
              {inboxCount && inboxCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute -right-2.5 -top-2 h-2 w-2 rounded-full bg-marquee"
                />
              ) : null}
            </span>
            <span className="t-label text-[9px] tracking-[0.12em]">More</span>
          </button>
        </div>
      </nav>

      <dialog
        ref={dialogRef}
        id="mobile-more-menu"
        aria-labelledby="mobile-more-title"
        onClose={() => setMoreOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMore();
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(84vw,320px)] max-w-none border-l border-hairline bg-surface p-0 text-fg backdrop:bg-black/80 backdrop:backdrop-blur-sm open:block motion-safe:open:animate-drawer-in sm:hidden"
      >
        <div className="flex h-full flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <VennMark size={24} />
              <h2 id="mobile-more-title" className="t-section text-2xl">
                More
              </h2>
            </div>
            <button
              type="button"
              autoFocus
              aria-label="Close menu"
              onClick={closeMore}
              className="flex h-11 w-11 items-center justify-center rounded-ctl text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <CloseIcon />
            </button>
          </div>

          <nav aria-label="More navigation" className="mt-8 flex flex-col">
            <Link
              href="/discover"
              aria-current={pathname.startsWith("/discover") ? "page" : undefined}
              onClick={closeMore}
              className="flex min-h-14 items-center border-b border-hairline px-1 text-fg-dim transition-colors hover:text-fg"
            >
              <span className="t-label">Discover</span>
            </Link>
            <Link
              href="/stats"
              aria-current={pathname.startsWith("/stats") ? "page" : undefined}
              onClick={closeMore}
              className="flex min-h-14 items-center border-b border-hairline px-1 text-fg-dim transition-colors hover:text-fg"
            >
              <span className="t-label">Stats</span>
            </Link>
            <Link
              href="/inbox"
              aria-current={pathname.startsWith("/inbox") ? "page" : undefined}
              onClick={closeMore}
              className="flex min-h-14 items-center justify-between border-b border-hairline px-1 text-fg-dim transition-colors hover:text-fg"
            >
              <span className="t-label">Inbox</span>
              <CountBadge count={inboxCount} />
            </Link>
            <Link
              href="/settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              onClick={closeMore}
              className="flex min-h-14 items-center border-b border-hairline px-1 text-fg-dim transition-colors hover:text-fg"
            >
              <span className="t-label">Settings</span>
            </Link>
            {installVisible ? (
              canPrompt ? (
                <button
                  type="button"
                  onClick={install}
                  className="flex min-h-14 items-center border-b border-hairline px-1 text-left text-fg-dim transition-colors hover:text-fg"
                >
                  <span className="t-label">Install app</span>
                </button>
              ) : (
                <div className="flex min-h-14 flex-col justify-center border-b border-hairline px-1 text-fg-dim">
                  <span className="t-label">Install app</span>
                  <span className="t-body mt-1 text-[13px] text-fg-faint">
                    Tap Share, then Add to Home Screen
                  </span>
                </div>
              )
            ) : null}
          </nav>

          <form action="/auth/signout" method="post" className="mt-auto">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center px-1 text-left text-fg-dim transition-colors hover:text-fg"
            >
              <span className="t-label">Sign out</span>
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
