"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  appendImportRows,
  createImport,
  failImport,
  startImport,
} from "@/app/settings/imports/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { parseImdbFiles, parseLetterboxdZip } from "@/lib/imports/parse";
import type {
  ImportSource,
  ParsedImport,
} from "@/lib/imports/types";

const BATCH_SIZE = 200;

async function enqueue(source: ImportSource, parsed: ParsedImport) {
  const created = await createImport(source, parsed.rows.length);
  if (!created.ok) throw new Error(created.error);

  try {
    for (let index = 0; index < parsed.rows.length; index += BATCH_SIZE) {
      const batch = parsed.rows.slice(index, index + BATCH_SIZE);
      const appended = await appendImportRows(created.data, batch);
      if (!appended.ok) throw new Error(appended.error);
    }

    const started = await startImport(created.data);
    if (!started.ok) throw new Error(started.error);
    return created.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import upload failed.";
    await failImport(created.data, message);
    throw error;
  }
}

function UploadCard({
  source,
  title,
  description,
  accept,
  multiple,
  disabled,
  files,
  onFiles,
  onStart,
  pending,
}: {
  source: ImportSource;
  title: string;
  description: string;
  accept: string;
  multiple: boolean;
  disabled: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  onStart: () => void;
  pending: boolean;
}) {
  return (
    <Panel className="flex flex-col gap-4">
      <div>
        <p className="t-label text-marquee">{source}</p>
        <h3 className="mt-2 text-xl font-semibold text-fg">{title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-dim">{description}</p>
      </div>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled || pending}
        onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
        className={`${inputClass} h-auto py-3 file:mr-3 file:border-0 file:bg-transparent file:text-fg`}
      />
      <button
        type="button"
        disabled={disabled || pending || files.length === 0}
        onClick={onStart}
        className={buttonClass("ghost")}
      >
        {pending ? "Preparing…" : `Start ${source} import`}
      </button>
    </Panel>
  );
}

export function ImportUpload({ active }: { active: boolean }) {
  const router = useRouter();
  const [imdbFiles, setImdbFiles] = useState<File[]>([]);
  const [letterboxdFiles, setLetterboxdFiles] = useState<File[]>([]);
  const [pendingSource, setPendingSource] = useState<ImportSource | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function start(source: ImportSource) {
    setMessage(null);
    setPendingSource(source);
    startTransition(async () => {
      try {
        const parsed =
          source === "imdb"
            ? await parseImdbFiles(imdbFiles)
            : await parseLetterboxdZip(letterboxdFiles[0]);
        await enqueue(source, parsed);

        const details = [
          `${parsed.rows.length} titles queued.`,
          parsed.skipped ? `${parsed.skipped} unsupported rows skipped.` : "",
          ...parsed.warnings,
        ]
          .filter(Boolean)
          .join(" ");
        setMessage(details);
        window.dispatchEvent(new CustomEvent("venn:import-started"));
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Couldn't start the import.");
      }
      setPendingSource(null);
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="t-label text-fg-faint">Start an import</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fg-dim">
          Files are parsed on this device. Venn stores only the normalized title
          rows needed to resolve your library.
        </p>
      </div>

      {active ? (
        <p className="text-[14px] text-marquee">
          The current import must finish processing before another can start.
        </p>
      ) : null}
      {message ? (
        <p role="status" className={message.startsWith("Couldn't") ? errorClass : "text-[14px] text-fg"}>
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard
          source="imdb"
          title="Ratings and watchlist"
          description="Select ratings.csv, watchlist.csv, or both. Movies and TV series are supported; episodes are skipped."
          accept=".csv,text/csv"
          multiple
          disabled={active || isPending}
          files={imdbFiles}
          onFiles={setImdbFiles}
          onStart={() => start("imdb")}
          pending={pendingSource === "imdb"}
        />
        <UploadCard
          source="letterboxd"
          title="Account export"
          description="Select the ZIP from Letterboxd Settings. Ratings, watched films, watchlist, and liked films are merged automatically."
          accept=".zip,application/zip"
          multiple={false}
          disabled={active || isPending}
          files={letterboxdFiles}
          onFiles={setLetterboxdFiles}
          onStart={() => start("letterboxd")}
          pending={pendingSource === "letterboxd"}
        />
      </div>
    </section>
  );
}
