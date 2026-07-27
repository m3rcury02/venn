"use client";

import { useState } from "react";

// §5: "Ship a Shortcut -- receive text -> POST to /api/ingest -> notification.
// User pastes their ingest token once, from Settings." There is no Shortcut
// file to hand over -- an unsigned one requires the recipient to have already
// enabled untrusted shortcuts, which is a worse first-run than six manual taps
// -- so this is the setup steps, plus the one value that differs per
// deployment: the endpoint.
export function ShortcutSetup({ endpoint }: { endpoint: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable outside a secure context -- the url is on
      // screen either way, so there is nothing useful to report.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">
          {endpoint}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="t-label shrink-0 rounded-ctl px-3 py-2 text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <ol className="t-body list-decimal space-y-2 pl-5 text-[15px] text-fg-dim">
        <li>Open the Shortcuts app, tap + to add a new shortcut.</li>
        <li>
          Add <span className="text-fg">Receive [Text] from [Share Sheet]</span>.
        </li>
        <li>
          Add <span className="text-fg">Get Contents of URL</span>: paste the
          address above, method <span className="text-fg">POST</span>, body{" "}
          <span className="text-fg">JSON</span> with <code>text</code> set to
          the Shortcut Input, <code>token</code> set to the token you
          generated above, and <code>source</code> set to{" "}
          <span className="text-fg">ios_shortcut</span>.
        </li>
        <li>Optionally add Show Notification, so a send confirms itself.</li>
        <li>Rename the shortcut to something like &ldquo;Send to Venn&rdquo;.</li>
        <li>
          In its Details, turn on{" "}
          <span className="text-fg">Show in Share Sheet</span>.
        </li>
      </ol>
    </div>
  );
}
