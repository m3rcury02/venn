import { VennLoader } from "@/components/venn-loader";

export default function ExploreLoading() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <VennLoader size={40} label="Loading explore" />
    </div>
  );
}
