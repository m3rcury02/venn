import { NightPickHeroFrame } from "@/components/night-pick-hero-frame";

// SPEC §7 screen 6's reveal. Picks #2 and #3 stay ordinary MovieCards below;
// the hierarchy of "one winner, two runners-up" is carried by the treatment,
// not by a number in a badge.
//
// The frame is letterboxed on purpose -- black bars top and bottom, so the
// reveal reads as something being screened rather than a card in a grid.
//
// This file itself stays a plain data shell -- no client hooks, no state --
// so the client boundary the orchestrated reveal needs is scoped to
// night-pick-hero-frame.tsx alone rather than pulled up into whatever server
// page renders this.

type NightPickHeroProps = {
  title: string;
  year: number | null;
  href: string;
  /** Large art for the blurred backdrop. */
  backdropUrl: string | null;
  /** Sharp art for the foreground poster. */
  posterUrl: string | null;
  reasons: string[];
};

export function NightPickHero(props: NightPickHeroProps) {
  return <NightPickHeroFrame {...props} />;
}
