import { VennMark } from "@/components/venn-mark";

// Served by public/sw.js when a navigation fails with no network. Static and
// data-free on purpose -- there is nothing here that can go stale or leak
// between accounts.
export default function OfflinePage() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
      <div aria-hidden className="absolute inset-x-0 top-0 h-6 bg-ink sm:h-9" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-6 bg-ink sm:h-9" />

      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <VennMark size={56} />
        </div>
        <h1 className="t-display mt-6 text-[clamp(40px,12vw,72px)] text-fg">
          No signal
        </h1>
        <p className="t-body mt-5 text-[15px] text-fg-dim">
          You&rsquo;re offline. Reconnect to keep browsing your lists.
        </p>
      </div>
    </main>
  );
}
