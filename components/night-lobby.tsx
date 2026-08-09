"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { joinRemoteNight, startRemoteNight } from "@/app/groups/[id]/night/actions";
import { buttonClass } from "@/components/ui/button";
import type { NightMode } from "@/components/present-picker";

// SPEC §4.5: "Remote nights -- a lobby with a join link; movie_night_attendees
// fills as people join." Polling, not Realtime -- import-progress-refresh.tsx
// is the repo's only precedent for a live-updating screen and it polls;
// Realtime here would mean publication config + RLS-on-realtime for a 4-6
// person roster.
//
// These are the one place besides a present chip that stand for people, so
// they're round -- same convention components/present-picker.tsx documents.
const attendeeChip = "t-label rounded-full bg-marquee px-4 py-2 text-on-beam";

function lobbyHref(groupId: string, mode: NightMode, nightId: string) {
  const params = new URLSearchParams();
  if (mode === "theatre") params.set("mode", mode);
  params.set("night", nightId);
  return `/groups/${groupId}/night?${params.toString()}`;
}

// Lobby-mode view: replaces PresentPicker when ?night= points at an open
// night. Joining is always this explicit "I'm in" tap, never automatic on
// page load -- see components/night-lobby.tsx's server-action counterpart in
// app/groups/[id]/night/actions.ts for why (attendance is a watch claim).
export function NightLobby({
  attendees,
  isAttendee,
  nightId,
}: {
  attendees: { id: string; name: string }[];
  isAttendee: boolean;
  nightId: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [joinPending, startJoin] = useTransition();
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [router]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable outside a secure context -- the link is
      // already on screen in the address bar either way.
    }
  }

  function handleJoin() {
    setJoinError(null);
    startJoin(async () => {
      const res = await joinRemoteNight(nightId);
      if (res.ok) {
        router.refresh();
      } else {
        setJoinError(res.error ?? "Couldn't join.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="t-label text-fg-faint">Remote night</h2>
      <div className="flex flex-wrap items-center gap-2">
        {attendees.map((member) => (
          <span key={member.id} className={attendeeChip}>
            {member.name}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className={buttonClass("ghost", "py-2.5 px-5 text-sm")}
        >
          {copied ? "Copied" : "Copy join link"}
        </button>
        {!isAttendee ? (
          <button
            type="button"
            disabled={joinPending}
            onClick={handleJoin}
            className={buttonClass("marquee", "py-2.5 px-5 text-sm")}
          >
            {joinPending ? "Joining…" : "I'm in"}
          </button>
        ) : null}
      </div>
      {joinError ? <p className="t-body text-xs text-beam-a">{joinError}</p> : null}
    </div>
  );
}

// Non-lobby view: one control on the plain night page, either an offer to
// start a remote night or, if the group already has one open, a link into it.
export function StartRemoteNight({
  groupId,
  mode,
  openLobby,
}: {
  groupId: string;
  mode: NightMode;
  openLobby: { id: string; starterName: string; attendeeCount: number } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (openLobby) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="t-label text-fg-faint">
          {openLobby.starterName} started a remote night · {openLobby.attendeeCount} here
        </p>
        <Link
          href={lobbyHref(groupId, mode, openLobby.id)}
          className={buttonClass("marquee", "py-2.5 px-5 text-sm")}
        >
          Join the lobby
        </Link>
      </div>
    );
  }

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const res = await startRemoteNight(groupId, mode);
      if (res.ok && res.nightId) {
        router.push(lobbyHref(groupId, mode, res.nightId));
      } else {
        setError(res.error ?? "Couldn't start a remote night.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <button
        type="button"
        disabled={isPending}
        onClick={handleStart}
        className={buttonClass("ghost", "py-2.5 px-5 text-sm")}
      >
        {isPending ? "Starting…" : "Start a remote night"}
      </button>
      {error ? <p className="t-body text-xs text-beam-a">{error}</p> : null}
    </div>
  );
}
