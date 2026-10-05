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
POSTGRES_VERSION=17.6.1.127   # stessa major del progetto remoto (17.6)
# Mirror ufficiali della stessa immagine; GHCR evita di dipendere solo da ECR in CI.
IMAGES=("ghcr.io/supabase/postgres:$POSTGRES_VERSION" "public.ecr.aws/supabase/postgres:$POSTGRES_VERSION")
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

admin() { docker exec -i "$NAME" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
app()   { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

ensure_image() {
  local candidate attempt

  # Anche una copia ECR già presente evita download e limiti del registry.
  for candidate in "${IMAGES[@]}"; do
    if docker image inspect "$candidate" >/dev/null 2>&1; then
      IMAGE="$candidate"
      return 0
    fi
  done

  for candidate in "${IMAGES[@]}"; do
    for attempt in 1 2 3; do
      echo "→ download $candidate (tentativo $attempt/3)"
      if docker pull "$candidate"; then
        IMAGE="$candidate"
        return 0
      fi
      if [ "$attempt" -lt 3 ]; then
        sleep "$((attempt * 5))"
      fi
    done
    echo "download non riuscito da $candidate" >&2
  done

  echo "errore: impossibile scaricare Postgres $POSTGRES_VERSION dai registry ufficiali" >&2
  return 1
}

case "${1:-}" in
  up)
    docker info >/dev/null
    if docker inspect "$NAME" >/dev/null 2>&1; then
      docker start "$NAME" >/dev/null
    else
      ensure_image
      docker run --pull=never -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 54422:5432 "$IMAGE" >/dev/null
    fi
    for _ in $(seq 1 30); do
      if docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1; then
        echo "ok: $NAME pronto"
        exit 0
      fi
      sleep 2
    done
    echo "errore: $NAME non pronto dopo 60 secondi" >&2
    docker logs --tail 100 "$NAME" >&2 || true
    exit 1
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
    if [ "$fail" -eq 0 ]; then
      for f in "$HERE"/concurrency/*.sql; do
        [ -e "$f" ] || break
        echo "== concurrency/$(basename "$f")"
        admin < "$f" || fail=1
      done
    fi
    exit $fail
    ;;
  sql)
    app -Atc "$2"
    ;;
  down)
    if docker inspect "$NAME" >/dev/null 2>&1; then
      docker rm -f "$NAME" >/dev/null
    fi
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1
    ;;
esac
