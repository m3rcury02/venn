import { Screen } from "@/components/ui/screen";
import { VennLoader } from "@/components/venn-loader";

const block =
  "rounded-card bg-surface-2 motion-safe:animate-breathe";

export default function MovieDetailLoading() {
  return (
    <Screen>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className={`${block} h-7 w-32`} />
          <div className={`${block} h-2.5 w-24`} />
        </div>
        <VennLoader size={30} label="Loading movie details" />
      </div>

      <div className="grid gap-7 rounded-card border border-hairline p-5 sm:grid-cols-[minmax(180px,260px)_1fr] sm:items-end sm:p-8">
        <div className={`${block} aspect-[2/3] w-full max-w-[260px]`} />
        <div className="flex flex-col gap-4">
          <div className={`${block} h-20 w-4/5`} />
          <div className={`${block} h-3 w-44`} />
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="flex flex-col gap-3">
          <div className={`${block} h-4 w-24`} />
          <div className={`${block} h-5 w-full`} />
          <div className={`${block} h-5 w-5/6`} />
          <div className={`${block} h-5 w-2/3`} />
        </div>
        <div className={`${block} h-64`} />
      </div>
    </Screen>
  );
}
