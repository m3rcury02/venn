#!/usr/bin/env bash
# Fails when a migration in supabase/migrations/ has not been applied to the
# production database. Run by .github/workflows/migrations.yml.
#
# Why this exists: migrations reach production by hand (docs/DECISIONS.md,
# "How this reached the remote project"), but Vercel deploys `main` on every
# push. Four migrations sat on `main` unapplied from 2026-08-09 to 2026-09-24,
# and for those six weeks the deployed code called functions and a table that
# production didn't have. Nothing noticed. This is the thing that notices.
#
# MIGRATIONS_DATABASE_URL connects as ci_migration_reader, a role that can
# read supabase_migrations.schema_migrations.version and nothing else (see
# docs/DECISIONS.md, "CI"). Never point it at the postgres user.
#
#   MIGRATIONS_DATABASE_URL=postgres://... scripts/check-migrations.sh

set -euo pipefail

if [[ -z "${MIGRATIONS_DATABASE_URL:-}" ]]; then
  echo "::error::MIGRATIONS_DATABASE_URL is not set. Add it as a repository secret (see docs/DECISIONS.md, \"CI\")."
  exit 1
fi

# The 14-digit prefix is the version `supabase db push` and apply_migration
# record. Files are renamed to match production when the two disagree, so the
# prefix is the whole identity.
repo=$(find supabase/migrations -maxdepth 1 -name '*.sql' -printf '%f\n' \
  | sed -nE 's/^([0-9]{14})_.*\.sql$/\1/p' | sort)

prod=$(psql "$MIGRATIONS_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align \
  --command "select version from supabase_migrations.schema_migrations order by version" \
  | sort)

missing=$(comm -23 <(echo "$repo") <(echo "$prod"))
extra=$(comm -13 <(echo "$repo") <(echo "$prod"))

# Applied in production but absent from the repo: someone ran a migration from
# somewhere else. Worth knowing, but it doesn't break the deployed code the way
# a missing one does, so it warns rather than fails.
if [[ -n "$extra" ]]; then
  while read -r version; do
    echo "::warning::Production has migration $version, which is not in supabase/migrations/."
  done <<< "$extra"
fi

if [[ -n "$missing" ]]; then
  while read -r version; do
    file=$(find supabase/migrations -maxdepth 1 -name "${version}_*.sql" -printf '%f\n')
    echo "::error file=supabase/migrations/$file::Not applied to production: $file"
  done <<< "$missing"
  echo "Production is missing $(echo "$missing" | wc -l) migration(s). The code on this commit may call schema that doesn't exist yet."
  exit 1
fi

echo "All $(echo "$repo" | wc -l) migrations in supabase/migrations/ are applied to production."
