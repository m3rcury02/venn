"use client";

import { useEffect, useRef, useState } from "react";
import { CreateGroupForm } from "@/components/create-group-form";
import { JoinGroupForm } from "@/components/join-group-form";
import { buttonClass } from "@/components/ui/button";

type Step = "menu" | "create" | "join";

function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <path d="m6 6 12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
      <path d="m14 6-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The one modal precedent in the app is the native <dialog> in
// mobile-navigation.tsx -- this reuses that recipe (showModal/close,
// backdrop-click-to-close, overflow lock) rather than adding a dependency.
export function GroupActionsFab() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [open]);

  function openSheet() {
    dialogRef.current?.showModal();
    setOpen(true);
  }

  function closeSheet() {
    dialogRef.current?.close();
  }

  return (
    <>
      {/* Aligned to the `max-w-2xl` content column (Screen's own measurements),
          not the viewport edge -- a bare `fixed right-*` would strand the
          button far from the list on a wide window. The wrapper is
          pointer-events-none and only the button opts back in, so the empty
          space either side of it still hits the group list underneath.
          `--group-fab-offset` clears the fixed bottom nav below `sm:` (see
          globals.css, same pattern as `--mobile-nav-offset`); above `sm:`
          there's no nav to clear so the fallback is a plain gap. */}
      <div
        data-group-fab
        className="pointer-events-none fixed inset-x-0 z-30 mx-auto flex max-w-2xl justify-end px-5 sm:px-8"
        style={{
          bottom: "calc(env(safe-area-inset-bottom) + var(--group-fab-offset, 1.5rem))",
        }}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="group-actions-sheet"
          onClick={openSheet}
          className={`${buttonClass("marquee")} pointer-events-auto`}
        >
          <span aria-hidden className="text-lg leading-none">
            +
          </span>
          New group
        </button>
      </div>

      <dialog
        ref={dialogRef}
        id="group-actions-sheet"
        aria-labelledby="group-actions-title"
        onClose={() => {
          setOpen(false);
          setStep("menu");
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeSheet();
        }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto w-full max-w-md max-h-none border-t border-hairline bg-surface p-0 text-fg backdrop:bg-black/80 backdrop:backdrop-blur-sm open:block motion-safe:open:animate-sheet-in"
      >
        <div className="flex flex-col px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {step === "menu" ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <h2 id="group-actions-title" className="t-section text-2xl">
                  New group
                </h2>
                <button
                  type="button"
                  autoFocus
                  aria-label="Close"
                  onClick={closeSheet}
                  className="flex h-11 w-11 items-center justify-center rounded-ctl text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <CloseIcon />
                </button>
              </div>
              <nav className="mt-4 flex flex-col">
                <button
                  type="button"
                  onClick={() => setStep("create")}
                  className="flex min-h-14 items-center justify-between border-b border-hairline px-1 text-left text-fg-dim transition-colors hover:text-fg"
                >
                  <span className="t-label">Start a group</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("join")}
                  className="flex min-h-14 items-center justify-between border-b border-hairline px-1 text-left text-fg-dim transition-colors hover:text-fg"
                >
                  <span className="t-label">Join with a code</span>
                </button>
              </nav>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  autoFocus
                  aria-label="Back"
                  onClick={() => setStep("menu")}
                  className="flex h-11 w-11 items-center justify-center rounded-ctl text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <BackIcon />
                </button>
                <h2 id="group-actions-title" className="t-section flex-1 text-2xl">
                  {step === "create" ? "Start a group" : "Join with a code"}
                </h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeSheet}
                  className="flex h-11 w-11 items-center justify-center rounded-ctl text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="mt-4 pb-2">
                {step === "create" ? <CreateGroupForm /> : <JoinGroupForm />}
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
