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

const TAB_COUNT = 5;
const MORE_INDEX = 4;

// Which of the five slots the lens sits under. Discover, Stats, Inbox and
// Settings all live in the More drawer, so they light More. A movie page or
// a profile belongs to no tab, and the lens fades out rather than claiming
// one it isn't.
function tabIndexFor(pathname: string): number | null {
  if (pathname === "/") return 0;
  if (pathname.startsWith("/explore")) return 1;
  if (pathname.startsWith("/search")) return 2;
  if (pathname.startsWith("/groups")) return 3;
  if (["/inbox", "/settings", "/discover", "/stats"].some((path) => pathname.startsWith(path))) {
    return MORE_INDEX;
  }
  return null;
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

// Inactive tabs are white at 75%, not `--fg-faint`: the bar is lens-tier
// glass, which carries `--fg` and `--marquee` only (globals.css, GLASS).
// White at 75% measures 5.02:1 over that tier's worst-case ground.
const tabClass =
  "relative z-10 flex h-14 flex-col items-center justify-center gap-1 transition-colors motion-safe:active:scale-[0.92]";

function TabLink({
  href,
  label,
  active,
  onPress,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        // A modified click opens a new tab; this one isn't going anywhere.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        onPress();
      }}
      className={`${tabClass} ${active ? "text-fg" : "text-fg/75 hover:text-fg active:text-fg"}`}
    >
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

// The lens: a bright glass pill under the active tab. The outer element
// slides between slots on a slightly springy curve; the inner one is
// remounted on every move (`key`) so its stretch keyframe replays -- it
// smears sideways in flight and snaps back to shape when it lands, which is
// what makes it read as liquid rather than as a sliding box. Neither runs
// under reduced motion: the lens simply appears under the new tab.
function Lens({ index }: { index: number | null }) {
  const [lastIndex, setLastIndex] = useState(index ?? 0);
  const [moves, setMoves] = useState(0);
  // Storing the previous value in state, React's documented pattern for
  // reacting to a prop change during render, not in an effect.
  if (index !== null && index !== lastIndex) {
    setLastIndex(index);
    setMoves((count) => count + 1);
  }
  const shown = index ?? lastIndex;

  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-y-1 left-1 transition-opacity duration-300 motion-safe:transition-[transform,opacity] motion-safe:duration-[420ms] motion-safe:ease-[cubic-bezier(0.34,1.3,0.64,1)] ${
        index === null ? "opacity-0" : "opacity-100"
      }`}
      style={{
        width: `calc((100% - 0.5rem) / ${TAB_COUNT})`,
        transform: `translateX(${shown * 100}%)`,
      }}
    >
      <span
        key={moves}
        className={`glass-highlight block h-full w-full rounded-[0.95rem] ${
          moves > 0 ? "motion-safe:animate-lens-stretch" : ""
        }`}
      />
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
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [pendingFor, setPendingFor] = useState(pathname);
  if (pendingFor !== pathname) {
    setPendingFor(pathname);
    setPendingIndex(null);
  }

  const fetchInboxCount = useCallback(async () => {
    // "/" is also the signed-out landing page, where this component is
    // mounted (and hidden by CSS). Without a session the query is a
    // guaranteed 401 in every visitor's console. getSession() reads the
    // local cookie, no network -- fine for "is there anyone to ask for", and
    // RLS still decides what the count actually is.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
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

  const routeIndex = tabIndexFor(pathname);
  // The lens moves on the tap, not when the next route has finished
  // rendering -- otherwise it would sit on the old tab for as long as the
  // server takes, which reads as the tap not registering. `pendingIndex`
  // is dropped again as soon as the pathname actually changes (above).
  const lensIndex = moreOpen ? MORE_INDEX : (pendingIndex ?? routeIndex);
  const moreActive = moreOpen || routeIndex === MORE_INDEX;
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

  // Rows inside the drawer. The drawer is glass, but inside a modal: the
  // ::backdrop has already dimmed the page, so `--fg-dim` holds 5.42:1 there
  // (globals.css, GLASS). `--fg-faint` would not, and isn't used.
  const drawerRow =
    "flex min-h-14 items-center border-b border-white/10 px-1 text-fg-dim transition-colors hover:text-fg active:text-fg";

  return (
    <>
      {/* Same 4rem the docked bar used to take, so nothing measured against
          it moved: the floating bar is 3.5rem tall and sits 0.5rem above the
          safe area. components/explore-feed.tsx, the install prompt's
          --mobile-nav-offset and the group FAB's --group-fab-offset all
          still budget exactly this. */}
      <div aria-hidden data-mobile-nav-spacer className="h-16 shrink-0 sm:hidden" />
      <nav
        data-mobile-nav
        aria-label="Primary navigation"
        className="glass fixed inset-x-3 z-40 mx-auto max-w-md rounded-glass sm:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div className="relative grid grid-cols-5 px-1">
          <Lens index={lensIndex} />
          <TabLink href="/" label="My list" active={routeIndex === 0} onPress={() => setPendingIndex(0)}>
            <MyListIcon />
          </TabLink>
          <TabLink href="/explore" label="Explore" active={routeIndex === 1} onPress={() => setPendingIndex(1)}>
            <ExploreIcon />
          </TabLink>
          <TabLink href="/search" label="Search" active={routeIndex === 2} onPress={() => setPendingIndex(2)}>
            <SearchIcon />
          </TabLink>
          <TabLink href="/groups" label="Groups" active={routeIndex === 3} onPress={() => setPendingIndex(3)}>
            <GroupsIcon />
          </TabLink>
          <button
            type="button"
            aria-current={routeIndex === MORE_INDEX ? "page" : undefined}
            aria-expanded={moreOpen}
            aria-controls="mobile-more-menu"
            onClick={openMore}
            className={`${tabClass} ${moreActive ? "text-fg" : "text-fg/75 hover:text-fg active:text-fg"}`}
          >
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
        className="glass fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] left-auto m-0 h-auto max-h-none w-[min(84vw,320px)] max-w-none rounded-glass p-0 text-fg backdrop:bg-black/80 backdrop:backdrop-blur-sm open:block motion-safe:open:animate-drawer-in sm:hidden"
      >
        <div className="flex h-full flex-col px-5 pt-5 pb-5">
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
              className="flex h-11 w-11 items-center justify-center rounded-xl text-fg-dim transition-colors hover:bg-white/10 hover:text-fg active:bg-white/10 active:text-fg motion-safe:active:scale-[0.92]"
            >
              <CloseIcon />
            </button>
          </div>

          <nav aria-label="More navigation" className="mt-8 flex flex-col">
            <Link
              href="/discover"
              aria-current={pathname.startsWith("/discover") ? "page" : undefined}
              onClick={closeMore}
              className={drawerRow}
            >
              <span className="t-label">Discover</span>
            </Link>
            <Link
              href="/stats"
              aria-current={pathname.startsWith("/stats") ? "page" : undefined}
              onClick={closeMore}
              className={drawerRow}
            >
              <span className="t-label">Stats</span>
            </Link>
            <Link
              href="/inbox"
              aria-current={pathname.startsWith("/inbox") ? "page" : undefined}
              onClick={closeMore}
              className={`${drawerRow} justify-between`}
            >
              <span className="t-label">Inbox</span>
              <CountBadge count={inboxCount} />
            </Link>
            <Link
              href="/settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              onClick={closeMore}
              className={drawerRow}
            >
              <span className="t-label">Settings</span>
            </Link>
            {installVisible ? (
              canPrompt ? (
                <button type="button" onClick={install} className={`${drawerRow} text-left`}>
                  <span className="t-label">Install app</span>
                </button>
              ) : (
                <div className="flex min-h-14 flex-col justify-center border-b border-white/10 px-1 text-fg-dim">
                  <span className="t-label">Install app</span>
                  <span className="t-body mt-1 text-[13px] text-fg-dim">
                    Tap Share, then Add to Home Screen
                  </span>
                </div>
              )
            ) : null}
          </nav>

          <form action="/auth/signout" method="post" className="mt-auto">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center px-1 text-left text-fg-dim transition-colors hover:text-fg active:text-fg"
            >
              <span className="t-label">Sign out</span>
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
