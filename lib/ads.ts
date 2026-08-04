// SPEC §1: "Ads -- Deferred ... If ever added: list views only, never in the
// picker." Where <AdSlot/> is imported is what enforces "never in the picker";
// this flag is what enforces "not until we can pay for it".
//
// SPEC §2: revenue triggers TMDB's commercial key and Vercel Pro on the SAME
// DAY, both owed from the first rupee. The flag stays unset until both are in
// place -- the checklist is in docs/DECISIONS.md, phase 12.
export const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
