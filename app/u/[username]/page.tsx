import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { BlockButton } from "@/components/block-button";
import { FollowButton } from "@/components/follow-button";
import { MovieCard } from "@/components/movie-card";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { provider } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type ProfilePageProps = {
  params: Promise<{ username: string }>;
};

type ItemWithMovie = {
  list_id: string;
  movie_id: string;
  added_at: string;
  movies: {
    id: string;
    title: string;
    year: number | null;
    poster_path: string | null;
    media_type: "movie" | "tv";
  };
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    notFound();
  }

  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;
  const isSelf = me === profile.id;

  let isFollowing = false;
  let isBlocked = false;

  if (me && !isSelf) {
    const [{ data: followRow }, { data: blockRow }] = await Promise.all([
      supabase
        .from("follows")
        .select("followee_id")
        .eq("follower_id", me)
        .eq("followee_id", profile.id)
        .maybeSingle(),
      supabase
        .from("blocks")
        .select("blocked_id")
        .eq("blocker_id", me)
        .eq("blocked_id", profile.id)
        .maybeSingle(),
    ]);

    isFollowing = !!followRow;
    isBlocked = !!blockRow;
  }

  // RLS filters lists based on visibility / followers / blocks
  const { data: lists } = await supabase
    .from("lists")
    .select("id, name, visibility")
    .eq("owner_user_id", profile.id);

  const listIds = (lists ?? []).map((l) => l.id);

  const { data: rawItems } =
    listIds.length > 0
      ? await supabase
          .from("list_items")
          .select(
            "list_id, movie_id, added_at, movies(id, title, year, poster_path, media_type)",
          )
          .in("list_id", listIds)
          .order("added_at", { ascending: false })
      : { data: [] };

  const items = (rawItems ?? []) as unknown as ItemWithMovie[];
  const displayName = profile.display_name || profile.username || "User";
  const initial = displayName[0]?.toUpperCase() ?? "U";

  return (
    <Screen>
      <AppHeader
        subtitle={`@${profile.username}`}
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

      <header className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element -- plain img hotlinking as required by Phase 10 rules */
            <img
              src={profile.avatar_url}
              alt={displayName}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-beam-a/20 font-display text-[32px] font-bold text-beam-a">
              {initial}
            </div>
          )}
          <div className="flex flex-col">
            <h1 className="t-display text-[clamp(32px,8vw,56px)] text-fg">
              {displayName}
            </h1>
            <p className="t-body text-[16px] text-fg-dim">@{profile.username}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isSelf ? (
            <Link href="/settings" className={buttonClass("ghost")}>
              Settings
            </Link>
          ) : me ? (
            <>
              <FollowButton
                targetUserId={profile.id}
                isFollowingInitial={isFollowing}
              />
              <BlockButton
                targetUserId={profile.id}
                isBlockedInitial={isBlocked}
              />
            </>
          ) : null}
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <h2 className="t-label text-fg-faint">List</h2>

        {items.length === 0 ? (
          <Panel>
            <p className="t-body text-fg-dim">Nothing shared.</p>
          </Panel>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((item) => {
              const posterUrl = item.movies.poster_path
                ? provider.getImageUrl(item.movies.poster_path, "w342")
                : null;
              return (
                <MovieCard
                  key={`${item.list_id}-${item.movie_id}`}
                  title={item.movies.title}
                  year={item.movies.year}
                  posterUrl={posterUrl}
                  mediaType={item.movies.media_type}
                  href={`/movies/${item.movies.id}`}
                />
              );
            })}
          </div>
        )}
      </main>
    </Screen>
  );
}
