// SPEC §4.4: explanations generated from the scoring components, no LLM.
//
// recommend_movies does the set math and returns counts; this turns them into
// prose. The split is deliberate: the weights that drive *scoring* are in the
// migration (see its header for why), but the thresholds that decide what is
// worth saying are here, where tuning them costs no migration.

export type Recommendation = {
  movie_id: string;
  title: string;
  year: number | null;
  poster_path: string | null;
  score: number;
  present_count: number;
  hyped_count: number;
  seen_count: number;
  top_person: string | null;
  top_person_count: number | null;
  match_tags: string[];
};

// A single member liking a person is noise, not a reason -- "1 of 4 love
// Christopher Nolan" says nothing about the group. It is also the phrasing that
// most directly identifies whose vote it was.
const MIN_PERSON_COUNT = 2;

/**
 * Theatre mode's release-status line, passed in by the night page rather than
 * carried on `Recommendation` -- it's a property of the candidate's
 * movie_releases row, not of the scoring this type otherwise describes.
 *
 * When present it replaces "Nobody here has seen it" (phase 9): every theatre
 * candidate is unwatched by construction, so that line is trivially true and
 * identical on all three picks. Release status is the thing actually worth
 * saying instead.
 */
export function explain(pick: Recommendation, releaseLabel?: string): string[] {
  const reasons: string[] = [];
  const present = pick.present_count;
  const solo = present === 1;

  // Hype leads when it is there: an explicit vote is stronger evidence than an
  // inferred one, which is the same reason §4.3 lets it override taste.
  if (pick.hyped_count > 0) {
    if (solo) {
      reasons.push("You're hyped for this");
    } else if (pick.hyped_count === present) {
      reasons.push(`All ${present} of you are hyped for this`);
    } else {
      reasons.push(`${pick.hyped_count} of ${present} are hyped for this`);
    }
  }

  if (pick.top_person && (pick.top_person_count ?? 0) >= (solo ? 1 : MIN_PERSON_COUNT)) {
    reasons.push(
      solo
        ? `You love ${pick.top_person}`
        : `${pick.top_person_count} of ${present} love ${pick.top_person}`,
    );
  }

  if (pick.match_tags.length > 0) {
    reasons.push(`Matches: ${pick.match_tags.join(", ")}`);
  }

  if (releaseLabel) {
    reasons.push(releaseLabel);
  } else if (pick.seen_count === 0) {
    reasons.push("Nobody here has seen it");
  }

  return reasons;
}

/** Renders a movie_releases row into explain()'s releaseLabel. */
export function releaseLabel(releaseType: "theatrical" | "upcoming", releaseDate: string | null) {
  if (releaseType === "theatrical") return "In cinemas";
  if (!releaseDate) return "Coming soon";
  const date = new Date(`${releaseDate}T00:00:00Z`);
  return `Out ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}
