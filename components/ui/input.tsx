// Shared field styling. Was five near-identical `h-11 rounded-full bg-surface`
// declarations that had already drifted apart on height and focus behaviour.
//
// Deliberately carries no `flex-1`: in a column-direction form (login) that
// sets flex-basis on the VERTICAL axis and collapses the field to a sliver,
// which is exactly what it did the first time. Row layouts add `flex-1`
// themselves.
export const inputClass =
  "h-12 w-full min-w-0 rounded-ctl border border-hairline bg-surface px-4 text-[15px] text-fg transition-colors placeholder:text-fg-faint focus:border-fg-dim focus:outline-none";

// Inline validation text. `--beam-a` is 5.86:1 on the ground, so it is legible
// as text and not just as a warning color.
export const errorClass = "t-body text-[13px] text-beam-a";
