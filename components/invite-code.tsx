"use client";

import { useState } from "react";

export function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable outside a secure context -- the code is on
      // screen either way, so there is nothing useful to report.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy invite code"
      className="flex items-center gap-4 rounded-ctl border border-hairline bg-surface py-2.5 pr-3 pl-5 transition-colors hover:border-marquee"
    >
      {/* System monospace: a code that gets read out and retyped. */}
      <span className="font-mono text-[15px] tracking-[0.25em] text-fg">{code}</span>
      <span className="t-label text-fg-faint">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
