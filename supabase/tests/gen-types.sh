#!/usr/bin/env bash
# Genera src/types/database.ts dal Postgres LOCALE (quello di run.sh), con
# postgres-meta — lo stesso generatore della CLI Supabase. Serve finché lo schema
# nuovo non è sul progetto remoto; dopo basta `yarn db:types`.
#
#   supabase/tests/run.sh up && supabase/tests/run.sh reset
#   supabase/tests/gen-types.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
META=klokshift-meta

docker inspect klokshift-pg >/dev/null 2>&1 || { echo "avvia prima: supabase/tests/run.sh up"; exit 1; }
docker rm -f "$META" >/dev/null 2>&1 || true
docker run -d --name "$META" --network container:klokshift-pg \
  -e PG_META_DB_HOST=localhost -e PG_META_DB_PORT=5432 -e PG_META_DB_NAME=postgres \
  -e PG_META_DB_USER=supabase_admin -e PG_META_DB_PASSWORD=postgres -e PG_META_PORT=8089 \
  supabase/postgres-meta:v0.95.2 >/dev/null
trap 'docker rm -f "$META" >/dev/null 2>&1 || true' EXIT
sleep 4
docker exec "$META" node -e 'fetch("http://localhost:8089/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true").then(r=>r.text()).then(t=>process.stdout.write(t))' \
  > "$ROOT/src/types/database.ts"
echo "ok: src/types/database.ts ($(wc -l < "$ROOT/src/types/database.ts") righe)"
