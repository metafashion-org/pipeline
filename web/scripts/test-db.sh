#!/usr/bin/env bash
# Throwaway Postgres for e2e tests. `up` brings the container up, waits for its healthcheck, then runs
# migrations and every seed in order; `down` destroys the container and its volume. Never reads or
# writes web/.env.local — DATABASE_URL is hardcoded here to a localhost container, and the guard below
# refuses to run against anything else. Usage: scripts/test-db.sh [up|down]
set -euo pipefail
cd "$(dirname "$0")/.."

# Port is overridable because 5433 is a popular choice and another project may already hold it.
# Set METAFASHION_TEST_DB_PORT to move both the container binding and this URL together.
TEST_DB_PORT="${METAFASHION_TEST_DB_PORT:-5433}"
export METAFASHION_TEST_DB_PORT="$TEST_DB_PORT"
export DATABASE_URL="postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/metafashion_test"
COMPOSE=(docker compose -f docker-compose.test.yml -p metafashion-test)

node scripts/assert-local-db.mjs

case "${1:-up}" in
  up)
    "${COMPOSE[@]}" up -d --wait
    pnpm run db:migrate
    pnpm run db:seed
    pnpm run db:seed:marketing
    pnpm run db:seed:knowledge
    pnpm run db:seed:e2e
    ;;
  down)
    "${COMPOSE[@]}" down -v
    ;;
  *)
    echo "usage: $0 [up|down]" >&2
    exit 1
    ;;
esac
