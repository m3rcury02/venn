import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import { strToU8, zipSync } from "fflate";
import {
  parseImdbFiles,
  parseLetterboxdZip,
} from "../lib/imports/parse";

function browserFile(
  sources: ConstructorParameters<typeof NodeFile>[0],
  name: string,
  options?: ConstructorParameters<typeof NodeFile>[2],
): File {
  return new NodeFile(sources, name, options) as unknown as File;
}

async function main() {
  const ratings = browserFile(
    [
      [
        "Const,Your Rating,Title,Title Type,Year",
        'tt1375666,9,"Inception",Movie,2010',
        'tt0903747,3,"Breaking Bad",TV Series,2008',
        'tt9999999,8,"Pilot, Part One",TV Episode,2020',
      ].join("\n"),
    ],
    "ratings.csv",
    { type: "text/csv" },
  );
  const watchlist = browserFile(
    [
      [
        "Const,Title,Title Type,Year",
        'tt1375666,"Inception",Movie,2010',
        'tt1160419,"Dune",Movie,2021',
      ].join("\n"),
    ],
    "watchlist.csv",
    { type: "text/csv" },
  );

  const imdb = await parseImdbFiles([ratings, watchlist]);
  assert.equal(imdb.rows.length, 3);
  assert.equal(imdb.skipped, 1);
  assert.deepEqual(
    imdb.rows.map((row) => [row.imdbId, row.watched, row.rating, row.expectedMediaType]),
    [
      ["tt1375666", true, "love", "movie"],
      ["tt0903747", true, "hate", "tv"],
      ["tt1160419", false, null, "movie"],
    ],
  );

  const zip = zipSync({
    "letterboxd-export/ratings.csv": strToU8(
      'Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,"Paris, Texas",1984,https://boxd.it/29qU,2.5',
    ),
    "letterboxd-export/watched.csv": strToU8(
      "Date,Name,Year,Letterboxd URI\n2024-01-02,Arrival,2016,https://boxd.it/arrival",
    ),
    "letterboxd-export/watchlist.csv": strToU8(
      "Date,Name,Year,Letterboxd URI\n2024-01-03,Arrival,2016,https://boxd.it/arrival\n2024-01-04,Dune,2021,https://boxd.it/dune",
    ),
    "letterboxd-export/likes/films.csv": strToU8(
      'Date,Name,Year,Letterboxd URI\n2024-01-05,"Paris, Texas",1984,https://boxd.it/29qU',
    ),
    "letterboxd-export/reviews.csv": strToU8("Date,Name,Year\n2024-01-01,Ignored,2020"),
  });
  const letterboxd = await parseLetterboxdZip(
    browserFile([zip], "letterboxd-export.zip", { type: "application/zip" }),
  );

  assert.equal(letterboxd.rows.length, 3);
  assert.deepEqual(
    letterboxd.rows.map((row) => [row.title, row.watched, row.rating]),
    [
      ["Paris, Texas", true, "love"],
      ["Arrival", true, null],
      ["Dune", false, null],
    ],
  );

  console.log("import smoke: 13 assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
