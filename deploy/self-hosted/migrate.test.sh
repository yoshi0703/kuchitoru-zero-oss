#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
MIGRATOR="$ROOT/deploy/self-hosted/migrate.sh"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

FAKE_PSQL="$TEST_DIR/psql"
STATE_FILE="$TEST_DIR/applied"
LOG_FILE="$TEST_DIR/calls"
GOOD_DIR="$TEST_DIR/good"
BAD_DIR="$TEST_DIR/bad"
mkdir -p "$GOOD_DIR" "$BAD_DIR"

cat > "$FAKE_PSQL" <<'SH'
#!/bin/sh
set -eu

version=
migration=
single_transaction=false
history_insert=false
previous=
for argument in "$@"; do
  case "$argument" in
    --single-transaction) single_transaction=true ;;
    --set=community_version=*) version=${argument#--set=community_version=} ;;
    --file=*) migration=${argument#*=} ;;
    --file) previous=file ;;
    *schema_migrations*values*) history_insert=true ;;
    *)
      if [ "$previous" = file ]; then
        migration=$argument
        previous=
      fi
      ;;
  esac
done

case " $* " in
  *" select 1 from supabase_migrations.schema_migrations "*)
    if [ -f "$FAKE_PSQL_STATE" ] && grep -qx "$version" "$FAKE_PSQL_STATE"; then
      printf '1\n'
    fi
    exit 0
    ;;
esac

if [ -n "$migration" ]; then
  [ "$single_transaction" = true ] || {
    printf 'migration was not wrapped in one transaction\n' >&2
    exit 90
  }
  [ "$history_insert" = true ] || {
    printf 'history registration was not in the migration invocation\n' >&2
    exit 91
  }
  printf 'transaction:%s\n' "$version" >> "$FAKE_PSQL_LOG"
  if grep -q intentional_failure "$migration"; then
    exit 92
  fi
  printf '%s\n' "$version" >> "$FAKE_PSQL_STATE"
  exit 0
fi

cat >/dev/null
printf 'bootstrap\n' >> "$FAKE_PSQL_LOG"
SH
chmod +x "$FAKE_PSQL"

printf 'select 1;\n' > "$GOOD_DIR/20260829000000_good.sql"
printf 'select intentional_failure;\n' > "$BAD_DIR/20260830000000_bad.sql"

export FAKE_PSQL_STATE="$STATE_FILE"
export FAKE_PSQL_LOG="$LOG_FILE"

PSQL_BIN="$FAKE_PSQL" COMMUNITY_MIGRATIONS_DIR="$GOOD_DIR" sh "$MIGRATOR"
PSQL_BIN="$FAKE_PSQL" COMMUNITY_MIGRATIONS_DIR="$GOOD_DIR" sh "$MIGRATOR"

[ "$(grep -c '^transaction:20260829000000$' "$LOG_FILE")" -eq 1 ] || {
  printf 'a recorded migration must be skipped on the second run\n' >&2
  exit 1
}
[ "$(grep -c '^20260829000000$' "$STATE_FILE")" -eq 1 ] || {
  printf 'the successful migration must be registered exactly once\n' >&2
  exit 1
}

if PSQL_BIN="$FAKE_PSQL" COMMUNITY_MIGRATIONS_DIR="$BAD_DIR" sh "$MIGRATOR"; then
  printf 'the intentionally failing migration unexpectedly succeeded\n' >&2
  exit 1
fi
if grep -qx '20260830000000' "$STATE_FILE"; then
  printf 'a failed migration must not be registered\n' >&2
  exit 1
fi

printf 'self-hosted migration transaction tests passed\n'
