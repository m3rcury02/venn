import type { ReactNode } from "react";

// Unlike layout.tsx, a template remounts on every navigation between routes,
// so this wrapper's CSS animation replays each time a new screen arrives. It
// does NOT remount for a same-route searchParams change (filter chips, the
// present picker), which is right: those already show `LinkPending` on the
// chip that was tapped, and fading the whole page there would hide it.
//
// CSS, not Framer: it runs from the first paint with no JavaScript, so a
// slow or failed hydration can never leave a page stuck invisible. Opacity
// only -- see `page-in` in globals.css for why a transform here would break
// every fixed-position element inside a page.
//
// `flex-1 flex-col` keeps the layout what it was before this wrapper existed:
// pages' <main> elements are `flex-1` children of the layout's column.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col motion-safe:animate-page-in">{children}</div>;
}
