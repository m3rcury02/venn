import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component, which can't export metadata.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Venn with Google or an email link.",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
