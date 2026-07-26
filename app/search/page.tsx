import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { SearchForm } from "@/components/search-form";

export default function SearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle="Add something to the overlap"
        actions={
          <Link href="/" className={navLinkClass}>
            My list
          </Link>
        }
      />

      <SearchForm />
    </main>
  );
}
