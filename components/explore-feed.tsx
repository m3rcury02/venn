"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { loadExploreFeed, registerExploreDisinterest } from "@/app/explore/actions";
import { ExploreCardView } from "@/components/explore-card";
import type { ExploreCard } from "@/lib/movies/explore";

export function ExploreFeed({ initialCards }: { initialCards: ExploreCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredDisinterests = useRef<Set<string>>(new Set());

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
    // When activeIndex advances, any cards prior to activeIndex have been scrolled past.
    for (let i = 0; i < activeIndex; i++) {
      const card = cards[i];
      if (!card) continue;
      if (
        !registeredDisinterests.current.has(card.movieId) &&
        !card.watched &&
        card.rating === null &&
        card.hype === null
      ) {
        registeredDisinterests.current.add(card.movieId);
        registerExploreDisinterest(card.movieId).catch(() => {
          // Background tracking failure is ignored silently
        });
      }
    }
  }, [activeIndex, cards]);


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
    // Two things sit above the feed on every breakpoint, not one: the
    // AppHeader (components/app-header.tsx) renders at all widths -- it has
    // no `sm:` visibility guard -- and app/explore/page.tsx wraps it in a
    // padded band (pt-5 pb-3 sm:pt-6, px unrelated to height). That band
    // measures 5.3rem on mobile and 5.55rem on sm+ (3.3rem intrinsic header
    // + the band's own padding). The tab bar spacer, h-16 at
    // components/mobile-navigation.tsx:192, only exists below sm (it renders
    // `sm:hidden`), which is why it only appears in the mobile term below.
    // The --mobile-nav-offset variable looks like it would help here but is
    // scoped to [data-mobile-nav] ~ [data-install-prompt] in
    // app/globals.css:232-235 and does not reach this element. Omitting
    // either term for its breakpoint parks that much of every card behind
    // the header or the tab bar.
    <div
      ref={containerRef}
      className="h-[calc(100dvh_-_9.3rem)] snap-y snap-mandatory overflow-y-scroll sm:h-[calc(100dvh_-_5.55rem)]"
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
