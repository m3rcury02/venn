import type { ReactNode } from "react";

// The page shell, previously copy-pasted verbatim across seven routes.
type ScreenProps = {
  children: ReactNode;
  /** `narrow` is for forms and settings; `wide` is for poster grids. */
  width?: "wide" | "narrow";
  className?: string;
};

export function Screen({ children, width = "wide", className }: ScreenProps) {
  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12 ${
        width === "narrow" ? "max-w-2xl" : "max-w-5xl"
      } ${className ?? ""}`}
    >
      {children}
    </main>
  );
}
