#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
env_mode="$(stat -c '%a' "$ENV_FILE")"
case "$env_mode" in
  600|640) ;;
  *)
    echo "$ENV_FILE must have mode 600 or 640; actual mode is $env_mode" >&2
    exit 1
    ;;
esac

compose config --quiet

if [ "${SHANYU_PULL_IMAGES:-0}" = "1" ]; then
  compose pull caddy postgres api web
fi

compose up -d postgres --wait --wait-timeout 120
database_table_count="$(postgres_sql -Atqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")"
case "$database_table_count" in
  ''|*[!0-9]*)
    echo "Could not determine whether the database already contains application tables." >&2
    exit 1
    ;;
esac
if [ "$database_table_count" -gt 0 ]; then
  SHANYU_REQUIRE_RUNNING_POSTGRES=1 "$SCRIPT_DIR/server-backup.sh"
else
  echo "Empty database detected; no pre-migration backup is required."
fi
compose run --rm --no-deps api node scripts/run-migrations.mjs up

ADMIN_PASSWORD="$(env_value ADMIN_INITIAL_PASSWORD)"
export ADMIN_PASSWORD
compose run --rm --no-deps \
  -e ADMIN_PASSWORD \
  api node scripts/bootstrap-admin.mjs
unset ADMIN_PASSWORD

compose up -d --wait --wait-timeout 180
public_origin="$(env_value WEB_ORIGIN)"
curl --fail --silent --show-error --max-time 10 \
  "$public_origin/api/health" >/dev/null
"$SCRIPT_DIR/server-backup.sh"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$DEPLOY_ROOT/last-successful-deploy"
echo "Deployment healthy at $public_origin"
