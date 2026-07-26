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
      className="group flex items-center gap-3 rounded-full bg-surface py-2 pr-3 pl-5 transition-colors hover:bg-surface-strong"
    >
      <span className="font-mono text-sm tracking-[0.25em] text-fg">{code}</span>
      <span className="font-mono text-[10px] tracking-wider text-fg-faint uppercase">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
