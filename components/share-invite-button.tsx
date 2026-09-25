"use client";

import { useState } from "react";

// The link form of the invite code beside it (lib/invite.ts). A code has to
// be read out and typed into the right screen after sign-up; a link carries
// the invite through sign-up and onboarding on its own.
//
// The system share sheet where there is one (every phone), since invites go
// out over WhatsApp and the like, and the clipboard everywhere else.
export function ShareInviteButton({ code, groupName }: { code: string; groupName: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = `${window.location.origin}/join/${code}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${groupName} on Venn`,
          text: `Join ${groupName} on Venn so we can pick a movie we're all up for.`,
          url,
        });
        return;
      } catch (error) {
        // The user closing the sheet is an AbortError and needs nothing.
        // Anything else (a desktop browser that exposes share() but has no
        // targets) falls through to the clipboard.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard outside a secure context. The code is still on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="t-label flex min-h-11 items-center rounded-ctl border border-hairline bg-surface px-4 text-fg transition-colors hover:border-marquee"
    >
      {copied ? "Link copied" : "Share invite link"}
    </button>
  );
}
