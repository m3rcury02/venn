import { VennMark } from "@/components/venn-mark";

// Served by public/sw.js when a navigation fails with no network. Static and
// data-free on purpose -- there is nothing here that can go stale or leak
// between accounts.
export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-2">
          <VennMark size={26} />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Venn
          </h1>
        </div>
        <p className="mt-4 text-sm text-fg-muted">
          You&rsquo;re offline. Reconnect to keep browsing your lists.
        </p>
      </div>
    </main>
  );
}
