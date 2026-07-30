import { parse } from "csv-parse/browser/esm/sync";
import { unzip } from "fflate";
import { normalizeImportTitle } from "@/lib/imports/normalize";
import type {
  ImportedRating,
  NormalizedImportRow,
  ParsedImport,
} from "@/lib/imports/types";
import type { MediaType } from "@/lib/providers";

type CsvRow = Record<string, string>;
type DraftRow = Omit<NormalizedImportRow, "rowNumber"> & { precedence: number };

function parseCsv(text: string): CsvRow[] {
  return parse(text, {
    bom: true,
    columns: (headers: string[]) => headers.map((header) => header.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];
}

function toYear(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1800 && parsed <= 2200
    ? parsed
    : null;
}

function imdbRating(value: string | undefined): ImportedRating | null {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) return null;
  if (rating <= 4) return "hate";
  if (rating <= 7) return "like";
  return "love";
}

function letterboxdRating(value: string | undefined): ImportedRating | null {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5) return null;
  if (rating <= 2) return "hate";
  if (rating <= 3.5) return "like";
  return "love";
}

function expectedImdbMediaType(value: string | undefined): MediaType | null {
  const normalized = (value ?? "").toLocaleLowerCase("en");
  if (normalized.includes("tv series") || normalized.includes("tv mini")) {
    return "tv";
  }
  if (normalized) return "movie";
  return null;
}

function unsupportedImdbType(value: string | undefined) {
  const normalized = (value ?? "").toLocaleLowerCase("en");
  return (
    normalized.includes("episode") ||
    normalized.includes("video game") ||
    normalized.includes("podcast")
  );
}

function finalize(rows: Map<string, DraftRow>, skipped: number, warnings: string[]) {
  return {
    rows: [...rows.values()].map((row, index) => ({
      rowNumber: index + 1,
      imdbId: row.imdbId,
      title: row.title,
      year: row.year,
      expectedMediaType: row.expectedMediaType,
      watched: row.watched,
      rating: row.rating,
    })),
    skipped,
    warnings,
  } satisfies ParsedImport;
}

export async function parseImdbFiles(files: File[]): Promise<ParsedImport> {
  if (files.length === 0) throw new Error("Choose at least one IMDb CSV file.");

  const deduped = new Map<string, DraftRow>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const file of files) {
    const records = parseCsv(await file.text());
    if (records.length === 0) continue;

    const headers = Object.keys(records[0]);
    if (!headers.includes("Const") || !headers.includes("Title")) {
      throw new Error(`${file.name} is not an IMDb export.`);
    }

    const isWatchlist = file.name.toLocaleLowerCase("en").includes("watchlist");
    const hasRatings = headers.includes("Your Rating");
    if (!isWatchlist && !hasRatings) {
      warnings.push(`${file.name} had no ratings and was skipped.`);
      skipped += records.length;
      continue;
    }

    for (const record of records) {
      const imdbId = (record.Const ?? "").trim().toLocaleLowerCase("en");
      const title = (record.Title ?? "").trim();
      if (!/^tt\d+$/.test(imdbId) || !title || unsupportedImdbType(record["Title Type"])) {
        skipped += 1;
        continue;
      }

      const rating = isWatchlist ? null : imdbRating(record["Your Rating"]);
      if (!isWatchlist && !rating) {
        skipped += 1;
        continue;
      }

      const next: DraftRow = {
        imdbId,
        title,
        year: toYear(record.Year),
        expectedMediaType: expectedImdbMediaType(record["Title Type"]),
        watched: !isWatchlist,
        rating,
        precedence: isWatchlist ? 1 : 3,
      };
      const current = deduped.get(imdbId);
      if (!current || next.precedence > current.precedence) deduped.set(imdbId, next);
    }
  }

  if (deduped.size === 0) throw new Error("No supported IMDb rows were found.");
  return finalize(deduped, skipped, warnings);
}

function unzipArchive(data: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

type LetterboxdKind = "ratings" | "watched" | "watchlist" | "liked";

function letterboxdKind(path: string): LetterboxdKind | null {
  const normalized = path.replaceAll("\\", "/").toLocaleLowerCase("en");
  if (normalized.endsWith("/likes/films.csv") || normalized === "likes/films.csv") {
    return "liked";
  }
  if (normalized.endsWith("/ratings.csv") || normalized === "ratings.csv") {
    return "ratings";
  }
  if (normalized.endsWith("/watched.csv") || normalized === "watched.csv") {
    return "watched";
  }
  if (normalized.endsWith("/watchlist.csv") || normalized === "watchlist.csv") {
    return "watchlist";
  }
  return null;
}

const LETTERBOXD_PRECEDENCE: Record<LetterboxdKind, number> = {
  watchlist: 1,
  watched: 2,
  ratings: 3,
  liked: 4,
};

export async function parseLetterboxdZip(file: File): Promise<ParsedImport> {
  if (!file.name.toLocaleLowerCase("en").endsWith(".zip")) {
    throw new Error("Choose the ZIP downloaded from Letterboxd.");
  }

  const archive = await unzipArchive(new Uint8Array(await file.arrayBuffer()));
  const relevant = Object.entries(archive).flatMap(([path, bytes]) => {
    const kind = letterboxdKind(path);
    return kind ? [{ kind, path, bytes }] : [];
  });
  if (relevant.length === 0) {
    throw new Error("That ZIP does not contain a Letterboxd account export.");
  }

  const decoder = new TextDecoder();
  const deduped = new Map<string, DraftRow>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const fileEntry of relevant) {
    const records = parseCsv(decoder.decode(fileEntry.bytes));
    if (records.length === 0) continue;
    const headers = Object.keys(records[0]);
    if (!headers.includes("Name") && !headers.includes("Title")) {
      warnings.push(`${fileEntry.path} had no title column and was skipped.`);
      skipped += records.length;
      continue;
    }

    for (const record of records) {
      const title = (record.Name ?? record.Title ?? "").trim();
      const year = toYear(record.Year);
      if (!title) {
        skipped += 1;
        continue;
      }

      const kind = fileEntry.kind;
      const rating =
        kind === "liked"
          ? "love"
          : kind === "ratings"
            ? letterboxdRating(record.Rating)
            : null;
      const watched = kind !== "watchlist";
      if (kind === "ratings" && !rating) {
        skipped += 1;
        continue;
      }

      const key = `${normalizeImportTitle(title)}\u0000${year ?? ""}`;
      const next: DraftRow = {
        imdbId: null,
        title,
        year,
        expectedMediaType: "movie",
        watched,
        rating,
        precedence: LETTERBOXD_PRECEDENCE[kind],
      };
      const current = deduped.get(key);
      if (!current || next.precedence > current.precedence) deduped.set(key, next);
    }
  }

  if (deduped.size === 0) throw new Error("No supported Letterboxd rows were found.");
  return finalize(deduped, skipped, warnings);
}
