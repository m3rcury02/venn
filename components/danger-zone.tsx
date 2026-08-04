"use client";

import { useState, useTransition } from "react";
import { deleteAccount } from "@/app/settings/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";

export function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await deleteAccount(confirmationInput);
      if (res?.error) {
        setError(res.error);
      }
    });
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-fg-faint">Export your data</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            Download a machine-readable JSON archive of all your personal data, ratings, lists, and activity under the DPDP Act.
          </p>
        </div>
        <div>
          <a
            href="/api/export"
            download="venn-export.json"
            className={buttonClass("ghost")}
          >
            Download data export
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-card border border-hairline p-4 bg-surface/30">
        <div className="flex flex-col gap-2">
          <h2 className="t-label text-beam-a">Delete account</h2>
          <p className="t-body max-w-md text-[15px] text-fg-dim">
            Account deletion is permanent. It removes your ratings, personal lists, and removes the titles you added from group lists.
          </p>
        </div>

        {confirming ? (
          <form onSubmit={handleDelete} className="flex flex-col gap-3 max-w-md">
            <p className="t-body text-sm text-fg">
              Type <strong className="text-beam-a">DELETE</strong> to confirm permanent account deletion.
            </p>
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder="DELETE"
              required
              className={inputClass}
            />
            {error ? <p className={errorClass}>{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending || confirmationInput !== "DELETE"}
                className={buttonClass("beam", "h-10 py-0 px-4")}
              >
                {isPending ? "Deleting..." : "Permanently Delete Account"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setConfirming(false);
                  setConfirmationInput("");
                  setError(null);
                }}
                className={buttonClass("ghost", "h-10 py-0 px-4")}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={buttonClass("beam", "h-10 py-0 px-4")}
            >
              Delete account
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
