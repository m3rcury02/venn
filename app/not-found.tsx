import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { VennMark } from "@/components/venn-mark";

// Also what a non-member sees for a group they are not in: both
// `/groups/[id]` and `/groups/[id]/night` call `notFound()` rather than 403,
// so the group's existence is never confirmed. Keep this copy vague for that
// reason -- it must read the same whether the group is real or not.
export default function NotFound() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
      <div aria-hidden className="absolute inset-x-0 top-0 h-6 bg-ink sm:h-9" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-6 bg-ink sm:h-9" />

      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <VennMark size={52} />
        </div>
        <h1 className="t-display mt-6 text-[clamp(40px,12vw,72px)] text-fg">
          No such reel
        </h1>
        <p className="t-body mt-5 text-[15px] text-fg-dim">
          This page doesn&rsquo;t exist, or it isn&rsquo;t yours to see.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className={buttonClass("marquee")}>
            My list
          </Link>
          <Link href="/groups" className={buttonClass("ghost")}>
            Groups
          </Link>
        </div>
      </div>
    </main>
  );
}
