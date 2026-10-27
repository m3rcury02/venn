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

// `relative` so a <LinkPending> child can cover the button while its
// navigation is in flight.
const base =
  "relative inline-flex items-center justify-center gap-2 rounded-ctl px-5 py-3 font-display uppercase text-[15px] leading-none tracking-[0.06em] transition duration-200 active:brightness-[0.85] motion-safe:active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  marquee: "bulb bg-marquee text-on-beam hover:brightness-110",
  beam: "bulb-beam bg-beam-a text-on-beam hover:brightness-110",
  // Glass without a backdrop filter: ghost buttons sit on the black ground,
  // where there is nothing to blur (globals.css, `.glass-flat`).
  ghost: "glass-flat text-fg hover:bg-white/[0.09]",
};

export function buttonClass(variant: ButtonVariant = "marquee", extra?: string) {
  return `${base} ${variants[variant]} ${extra ?? ""}`;
}

// The small control that sits on top of a poster. Shared by add, remove and
// watched so the three agree on size and weight. 44px is the platform
// tap-target minimum (Apple HIG), not a size the poster composition asked
// for.
//
// Lens-tier glass, so poster art shows through it -- and therefore white
// icons only (globals.css, GLASS rule 1). Soft-cornered because it is glass:
// a lens sitting on the (square) screen. The transparent border is there so
// a state class can colour it (`border-fg` when watched) without a layout
// shift.
export const overlayButtonClass =
  "glass flex h-11 w-11 items-center justify-center rounded-xl border border-transparent text-fg transition duration-200 active:brightness-[0.85] motion-safe:active:scale-[0.94] disabled:opacity-50";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "marquee", className, ...props }: ButtonProps) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
