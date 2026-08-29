#!/bin/sh
set -eu

MIGRATIONS_DIR=${COMMUNITY_MIGRATIONS_DIR:-/community/migrations}
PSQL_BIN=${PSQL_BIN:-psql}

"$PSQL_BIN" --set ON_ERROR_STOP=1 <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

for migration in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$migration" ] || continue
  filename=$(basename "$migration")
  version=${filename%%_*}
  name=${filename#*_}
  name=${name%.sql}
  case "$version" in
    ''|*[!0-9]*)
      printf 'Invalid migration version: %s\n' "$filename" >&2
      exit 1
      ;;
  esac
  case "$name" in
    ''|*[!A-Za-z0-9_-]*)
      printf 'Invalid migration name: %s\n' "$filename" >&2
      exit 1
      ;;
  esac
  applied=$("$PSQL_BIN" --tuples-only --no-align \
    --set=community_version="$version" \
    --command "select 1 from supabase_migrations.schema_migrations where version = '$version'")
  [ "$applied" = "1" ] && continue
  printf 'Applying %s\n' "$filename"
  "$PSQL_BIN" --set ON_ERROR_STOP=1 --single-transaction \
    --set=community_version="$version" \
    --set=community_name="$name" \
    --file "$migration" \
    --command "insert into supabase_migrations.schema_migrations(version, statements, name) values ('$version', array[]::text[], '$name')"
done
