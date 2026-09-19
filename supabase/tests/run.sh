#!/usr/bin/env bash
# Banco di prova locale per lo schema: Postgres 17 di Supabase in Docker.
#
#   supabase/tests/run.sh up       avvia il container (una volta)
#   supabase/tests/run.sh reset    azzera public/private e riapplica bootstrap + migration
#   supabase/tests/run.sh test     lancia supabase/tests/rls/*.sql (impersonando i ruoli)
#   supabase/tests/run.sh sql "…"  esegue una query come postgres
#   supabase/tests/run.sh down     ferma e rimuove il container
#
# Non c'è la CLI Supabase in questa repo: questo script fa da `db reset`.
set -euo pipefail

NAME=klokshift-pg
IMAGE=public.ecr.aws/supabase/postgres:17.6.1.127   # stessa major del progetto remoto (17.6)
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

admin() { docker exec -i "$NAME" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
app()   { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

case "${1:-}" in
  up)
    docker inspect "$NAME" >/dev/null 2>&1 || docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 54422:5432 "$IMAGE" >/dev/null
    docker start "$NAME" >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
    echo "ok: $NAME pronto"
    ;;
  reset)
    admin -c "drop schema if exists public cascade; drop schema if exists private cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; alter schema public owner to postgres; grant all on schema public to postgres;" >/dev/null
    admin -c "truncate auth.users cascade;" >/dev/null
    admin < "$HERE/bootstrap.sql" >/dev/null
    for f in "${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"/*.sql; do
      echo "→ $(basename "$f")"
      app < "$f" >/dev/null
    done
    [ -e "$HERE/seed.sql" ] && { echo "→ seed.sql"; app < "$HERE/seed.sql" >/dev/null; }
    echo "ok: schema ricostruito"
    ;;
  test)
    fail=0
    for f in "$HERE"/rls/*.sql; do
      [ -e "$f" ] || { echo "nessun test in $HERE/rls"; exit 0; }
      echo "== $(basename "$f")"
      app < "$f" || fail=1
    done
    exit $fail
    ;;
  sql)
    app -Atc "$2"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1
    ;;
esac
