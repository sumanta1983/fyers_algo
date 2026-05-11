#!/usr/bin/env bash
# Initialise the local Postgres database for fyers_algo.
#
# - Reads POSTGRES_* + REDIS_* from .env at the project root.
# - Creates the database if missing (using POSTGRES_USER as owner).
# - Applies every *.sql under node_backend/migrations/ in lexical order.
# - Safe to re-run: the migrations use CREATE TABLE IF NOT EXISTS and
#   INSERT ... ON CONFLICT DO NOTHING, so a second run is a no-op.
#
# Usage (from anywhere):
#   ./scripts/init_db.sh           # apply migrations
#   ./scripts/init_db.sh --reset   # DROP DATABASE first, then recreate + apply
#   ./scripts/init_db.sh --verify  # only print \dt + strategy_state row

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
MIGRATIONS_DIR="$PROJECT_ROOT/node_backend/migrations"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Load .env without leaking unrelated vars into the user's shell.
# `set -a` exports every variable assigned while it's active.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${POSTGRES_HOST:?POSTGRES_HOST missing in .env}"
: "${POSTGRES_PORT:?POSTGRES_PORT missing in .env}"
: "${POSTGRES_USER:?POSTGRES_USER missing in .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing in .env}"
: "${POSTGRES_DB:?POSTGRES_DB missing in .env}"

export PGPASSWORD="$POSTGRES_PASSWORD"

psql_base=(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -X)

db_exists() {
  "${psql_base[@]}" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1
}

create_db() {
  echo ">> creating database $POSTGRES_DB (owner=$POSTGRES_USER)"
  "${psql_base[@]}" -d postgres -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
}

drop_db() {
  echo ">> dropping database $POSTGRES_DB"
  # Kick existing connections so DROP doesn't fail with "database is being accessed".
  "${psql_base[@]}" -d postgres -c \
    "SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" >/dev/null || true
  "${psql_base[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";"
}

apply_migrations() {
  shopt -s nullglob
  local files=("$MIGRATIONS_DIR"/*.sql)
  shopt -u nullglob
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "error: no .sql files found in $MIGRATIONS_DIR" >&2
    exit 1
  fi
  for f in "${files[@]}"; do
    echo ">> applying $(basename "$f")"
    "${psql_base[@]}" -d "$POSTGRES_DB" -f "$f"
  done
}

verify() {
  echo ">> tables in $POSTGRES_DB:"
  "${psql_base[@]}" -d "$POSTGRES_DB" -c "\dt"
  echo ">> seed row:"
  "${psql_base[@]}" -d "$POSTGRES_DB" -c "SELECT * FROM strategy_state;"
}

case "${1:-}" in
  --reset)
    drop_db
    create_db
    apply_migrations
    verify
    ;;
  --verify)
    verify
    ;;
  ""|--apply)
    if ! db_exists; then
      create_db
    else
      echo ">> database $POSTGRES_DB already exists; skipping CREATE"
    fi
    apply_migrations
    verify
    ;;
  -h|--help)
    sed -n '2,12p' "$0"
    ;;
  *)
    echo "unknown arg: $1 (try --apply | --reset | --verify | --help)" >&2
    exit 2
    ;;
esac
