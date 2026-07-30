import type { MediaType } from "@/lib/providers";

export type ImportSource = "imdb" | "letterboxd";
export type ImportedRating = "hate" | "like" | "love";

export type NormalizedImportRow = {
  rowNumber: number;
  imdbId: string | null;
  title: string;
  year: number | null;
  expectedMediaType: MediaType | null;
  watched: boolean;
  rating: ImportedRating | null;
};

export type ParsedImport = {
  rows: NormalizedImportRow[];
  skipped: number;
  warnings: string[];
};

export type ImportJobStatus =
  | "uploading"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed";
