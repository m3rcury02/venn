"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { loadExploreFeed } from "@/app/explore/actions";
import { ExploreCardView } from "@/components/explore-card";
import type { ExploreCard } from "@/lib/movies/explore";

export function ExploreFeed({ initialCards }: { initialCards: ExploreCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only one card can be 60% visible at once (each is the container's full
    // height), so the first intersecting entry is THE active card. Threshold
    // 0.6 rather than 0.5: a card becomes the active one only once it clearly
    // owns the screen, which is also the point where the outgoing card is far
    // enough gone that its iframe unmounts.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) setActiveIndex(index);
        }
      },
      { root: container, threshold: 0.6 },
    );

    container.querySelectorAll("[data-card]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [cards.length]);

  useEffect(() => {
    if (isPending) return;
    if (activeIndex < cards.length - 3) return;

    startTransition(async () => {
      const next = await loadExploreFeed(page + 1);
      const seen = new Set(cards.map((card) => card.movieId));
      const fresh = next.filter((card) => !seen.has(card.movieId));
      if (fresh.length === 0) return; // end of the feed -- no state change, so
      // this effect cannot re-fire on an empty page
      setCards((current) => [...current, ...fresh]);
      setPage((current) => current + 1);
    });
  }, [activeIndex, cards, page, isPending]);

  return (
    // 4rem must stay in sync with the tab bar spacer h-16 at
    // components/mobile-navigation.tsx:182. The --mobile-nav-offset variable
    // looks right but is scoped to [data-mobile-nav] ~ [data-install-prompt]
    // in app/globals.css:232-235 and does not reach here. On sm+ there is no
    // tab bar, but the AppHeader (components/app-header.tsx) sits above the
    // feed in normal flow at a rendered 52.7px, so the sm class subtracts
    // 3.3rem -- without it the feed is 52.7px taller than the viewport and
    // the bottom of every card clips.
    <div
      ref={containerRef}
      className="h-[calc(100dvh-4rem)] snap-y snap-mandatory overflow-y-scroll sm:h-[calc(100dvh_-_3.3rem)]"
    >
      {cards.map((card, index) => (
        <ExploreCardView
          key={card.movieId}
          card={card}
          index={index}
          active={index === activeIndex}
          muted={muted}
          onToggleMute={() => setMuted((current) => !current)}
        />
      ))}
    </div>
  );
}
