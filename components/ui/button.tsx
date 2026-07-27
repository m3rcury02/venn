import type { ButtonHTMLAttributes } from "react";

// Buttons in this app are marquee bulbs: a flat saturated fill that spills its
// own light onto the black around it (`.bulb` / `.bulb-beam` in globals.css).
//
// Every variant puts BLACK on the fill, never white -- white on `--beam-a` is
// 3.59:1 and fails AA, black is 5.86:1. That is why `--on-beam` exists.
//
// Exported as a class function as well as a component because roughly half the
// call sites are `<Link>`, not `<button>` -- same reason `navLinkClass` is
// exported from app-header.tsx.

export type ButtonVariant = "marquee" | "beam" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl px-5 py-3 font-display uppercase text-[15px] leading-none tracking-[0.06em] transition duration-200 disabled:opacity-45 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  marquee: "bulb bg-marquee text-on-beam hover:brightness-110",
  beam: "bulb-beam bg-beam-a text-on-beam hover:brightness-110",
  ghost:
    "border border-hairline text-fg hover:border-fg-dim hover:bg-surface-2",
};

export function buttonClass(variant: ButtonVariant = "marquee", extra?: string) {
  return `${base} ${variants[variant]} ${extra ?? ""}`;
}

// The small square control that sits on top of a poster. Shared by add,
// remove and watched so the three agree on size and weight.
export const overlayButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-ctl border border-hairline bg-ink/70 text-fg backdrop-blur-sm transition duration-200 disabled:opacity-50";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "marquee", className, ...props }: ButtonProps) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
