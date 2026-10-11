#!/usr/bin/env bash
# Applies the migrations to a throwaway Postgres + pgvector and runs the RLS tests.
# Usage: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; create schema public;'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/10_rls.sql
