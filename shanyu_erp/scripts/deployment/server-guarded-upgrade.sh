#!/usr/bin/env bash
# Execute from a verified release bundle. Never builds, pulls, seeds or restores.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/server-common.sh"
umask 077
manifest="${1:-}"
if [ "$#" -ne 2 ] || [ ! -f "$manifest" ]; then
  echo "Usage: $0 <reviewed-release.json> <environment:release>" >&2
  exit 2
fi
fields="$(python3 "$SCRIPT_DIR/release-manifest.py" "$manifest")"
values=()
while IFS= read -r value; do values+=("$value"); done <<<"$fields"
environment="${values[0]}"; origin="${values[1]}"; release="${values[2]}"; revision="${values[3]}"
machine_id="${values[4]}"; previous="${values[5]}"
api="${values[6]}"; api_id="${values[7]}"; web="${values[8]}"; web_id="${values[9]}"
catalog="${values[10]}"; catalog_hash="${values[11]}"
postgres_volume="${values[12]}"; exports_volume="${values[13]}"
[ "$2" = "$environment:$release" ] || { echo 'Confirmation mismatch' >&2; exit 2; }
[ "$(cat /etc/machine-id)" = "$machine_id" ] || { echo 'Wrong server identity' >&2; exit 1; }
require_deployment_files
[ "$(deployment_environment)" = "$environment" ]
[ "$(env_value WEB_ORIGIN)" = "$origin" ]
backup_mode "$environment" >/dev/null
if [ "$environment" = production ]; then [ "$(env_value SESSION_COOKIE_SECURE)" = true ]; fi
case "$(stat -c '%a' "$ENV_FILE")" in 600|640) ;; *) exit 1 ;; esac
# Ignore inherited bypass flags at this public entry point. Children reuse this lock.
unset SHANYU_OPERATION_LOCK_HELD
acquire_operation_lock
export SHANYU_OPERATION_LOCK_HELD=1
marker="$DEPLOY_ROOT/.upgrade-maintenance"
[ ! -e "$marker" ] || { echo "Unresolved maintenance marker: $marker; manual review required" >&2; exit 1; }
current="$(sed -n 's/^RELEASE_VERSION=//p' "$RELEASE_ENV_FILE")"
[ "$current" = "$previous" ] || [ "$current" = "$release" ] || { echo 'Previous release mismatch' >&2; exit 1; }
require_postgres
check_image() {
  local actual
  actual="$(sudo docker image inspect --format '{{.Id}} {{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$1")"
  [ "$actual" = "$2 amd64 $revision" ] || { echo 'Image ID/architecture/revision mismatch' >&2; exit 1; }
}
check_image "$api" "$api_id"
check_image "$web" "$web_id"
sudo docker run --rm --pull never --network none --entrypoint sh "$api" -c \
  'test -r scripts/deployment-data-baseline.mjs && test -r scripts/reconcile-main-material-drafts.mjs && node -e '\''if (typeof require("./dist/main-material/main-material-safe-update.js").safeUpdateHash !== "function") process.exit(1)'\'''
volume_at() {
  sudo docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}" "$(compose ps -a -q "$1")"
}
[ "$(volume_at postgres /var/lib/postgresql)" = "$postgres_volume" ]
[ "$(volume_at api /app/export-files)" = "$exports_volume" ]
[ "$(df -Pm "$DEPLOY_ROOT" | awk 'NR==2 {print $4}')" -ge 2048 ] || { echo 'Less than 2 GiB free; refused' >&2; exit 1; }
bundle="$(cd "$SCRIPT_DIR/../.." && pwd)"
require_file "$bundle/compose.prod.yaml"
require_file "$bundle/Caddyfile"
install -d -m 0700 "$DEPLOY_ROOT/deployment-reports"
report="$(mktemp -d "$DEPLOY_ROOT/deployment-reports/$release.XXXXXXXX")"
cp "$manifest" "$report/manifest.json"
cp "$COMPOSE_FILE" "$report/compose.previous.yaml"
cp "$DEPLOY_ROOT/Caddyfile" "$report/Caddyfile.previous"
cp "$RELEASE_ENV_FILE" "$report/release.previous.env"
env_fingerprint="$(sha256sum "$ENV_FILE") $(stat -c '%a:%u:%g' "$ENV_FILE")"
phase=preflight
maintenance=0
finished=0
finish() {
  local code=$?
  trap - EXIT
  if [ "$finished" != 1 ]; then
    printf 'FAILED phase=%s exit=%s\n' "$phase" "$code" >"$report/status"
    if [ "$maintenance" = 1 ]; then
      # Never reopen traffic or start old writers after a possibly committed migration.
      compose stop -t 60 caddy web api export-worker >>"$report/failure-stop.log" 2>&1 || true
      echo "Upgrade stopped at $phase; maintenance retained. Evidence: $report" >&2
    fi
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nRELEASE_VERSION=%s\n' "$api" "$web" "$release" >"$report/release.next.env"
SHANYU_RELEASE_ENV_FILE="$report/release.next.env" SHANYU_COMPOSE_FILE="$bundle/compose.prod.yaml" \
  bash -c 'source "$1/server-common.sh"; compose config --quiet' sh "$SCRIPT_DIR"
SHANYU_RELEASE_ENV_FILE="$report/release.next.env" SHANYU_COMPOSE_FILE="$bundle/compose.prod.yaml" \
  bash -c 'source "$1/server-common.sh"; compose config --format json' sh "$SCRIPT_DIR" | \
  python3 "$SCRIPT_DIR/upgrade-evidence.py" volumes "$postgres_volume" "$exports_volume"
# Planned downtime, not a 503 page. No firewall, DNS, volume or env file changes.
phase=maintenance
printf '%s\n' "$report" >"$marker"
maintenance=1
compose stop -t 120 caddy web api export-worker >"$report/maintenance.log" 2>&1
for service in caddy web api export-worker; do
  container="$(compose ps -a -q "$service")"
  [ -z "$container" ] || [ "$(sudo docker inspect -f '{{.State.Running}}' "$container")" = false ]
done
# Refuse unknown external writers / unfinished exports; do not kill sessions or jobs.
[ "$(postgres_sql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")" = 0 ]
[ "$(postgres_sql -Atqc "SELECT count(*) FROM quotation_export_jobs WHERE status IN ('PENDING','RUNNING')")" = 0 ]
backup() {
  local name="$1" path
  : >"$report/$name.path"
  SHANYU_REQUIRE_RUNNING_POSTGRES=1 SHANYU_BACKUP_RESULT_FILE="$report/$name.path" \
    bash "$SCRIPT_DIR/server-backup.sh" >"$report/$name.log" 2>&1
  path="$(cat "$report/$name.path")"
  test -s "$path.meta"
  verify_backup_file "$path" >/dev/null
  if [ "$environment" = production ]; then test -s "$path.cos"; fi
}
phase=pre-backup
backup before
# Candidate's read-only inspector runs before migration without starting the API.
api_run() { RELEASE_ENV_FILE="$report/release.next.env" compose run --rm -T --no-deps --pull never api node "$@"; }
phase=baseline
api_run scripts/deployment-data-baseline.mjs snapshot >"$report/before.json" 2>"$report/baseline.log"
phase=select-release
if [ "$current" != "$release" ]; then cp "$RELEASE_ENV_FILE" "$DEPLOY_ROOT/.release.previous.env"; fi
cp "$report/release.next.env" "$RELEASE_ENV_FILE.pending"
mv "$RELEASE_ENV_FILE.pending" "$RELEASE_ENV_FILE"
if [ "$bundle/compose.prod.yaml" != "$COMPOSE_FILE" ]; then cp "$bundle/compose.prod.yaml" "$COMPOSE_FILE"; fi
if [ "$bundle/Caddyfile" != "$DEPLOY_ROOT/Caddyfile" ]; then cp "$bundle/Caddyfile" "$DEPLOY_ROOT/Caddyfile"; fi
compose config --quiet
check_image "$api" "$api_id"
check_image "$web" "$web_id"
phase=migration
api_run scripts/run-migrations.mjs up >"$report/migration.log" 2>&1
phase=migration-baseline
python3 "$SCRIPT_DIR/upgrade-evidence.py" input "$report/before.json" | \
  api_run scripts/deployment-data-baseline.mjs verify >"$report/after-migration.json" 2>"$report/after-migration.log"
phase=preview
api_run scripts/reconcile-main-material-drafts.mjs --dry-run "--environment=$environment" \
  "--target=$catalog" "--catalog-hash=$catalog_hash" "--release=$release" >"$report/preview.pending" 2>"$report/preview.log"
plan="$(python3 "$SCRIPT_DIR/upgrade-evidence.py" plan "$report/preview.pending" "$catalog" "$catalog_hash")"
mv "$report/preview.pending" "$report/preview.json"
phase=apply
api_run scripts/reconcile-main-material-drafts.mjs --apply "--environment=$environment" \
  "--target=$catalog" "--catalog-hash=$catalog_hash" "--release=$release" "--plan-hash=$plan" >"$report/apply.pending" 2>"$report/apply.log"
python3 "$SCRIPT_DIR/upgrade-evidence.py" plan "$report/apply.pending" "$catalog" "$catalog_hash" >/dev/null
mv "$report/apply.pending" "$report/apply.json"
phase=post-baseline
python3 "$SCRIPT_DIR/upgrade-evidence.py" input "$report/before.json" "$report/apply.json" | \
  api_run scripts/deployment-data-baseline.mjs verify >"$report/after.json" 2>"$report/after.log"
phase=post-backup
backup after
[ "$env_fingerprint" = "$(sha256sum "$ENV_FILE") $(stat -c '%a:%u:%g' "$ENV_FILE")" ]
phase=internal-health
compose up -d --no-deps --pull never --wait --wait-timeout 180 api web >"$report/start.log" 2>&1
compose up -d --no-deps --pull never export-storage-init >>"$report/start.log" 2>&1
init_id="$(compose ps -a -q export-storage-init)"
[ "$(sudo docker wait "$init_id")" = 0 ]
compose up -d --no-deps --pull never --wait --wait-timeout 180 export-worker >>"$report/start.log" 2>&1
compose exec -T --user 1000 export-worker sh -c 'test -w /app/export-files'
[ "$(volume_at postgres /var/lib/postgresql)" = "$postgres_volume" ]
[ "$(volume_at api /app/export-files)" = "$exports_volume" ]
phase=public-health
compose up -d --no-deps --pull never --wait --wait-timeout 180 caddy >>"$report/start.log" 2>&1
curl --fail --silent --show-error --max-time 15 "$origin/api/health" >"$report/health.json"
for service in postgres api web export-worker caddy; do
  container="$(compose ps -q "$service")"
  state="$(sudo docker inspect -f '{{.State.Health.Status}} {{.State.OOMKilled}} {{.RestartCount}}' "$container")"
  printf '%s %s\n' "$service" "$state" >>"$report/containers.txt"
  case "$state" in 'healthy false '*) ;; *) exit 1 ;; esac
  if [ "$service" = export-worker ]; then [ "$state" = 'healthy false 0' ]; fi
  case "$service" in
    api|export-worker) [ "$(sudo docker inspect -f '{{.Image}}' "$container")" = "$api_id" ] ;;
    web) [ "$(sudo docker inspect -f '{{.Image}}' "$container")" = "$web_id" ] ;;
  esac
done
phase=install-operations
install -d -m 0750 "$DEPLOY_ROOT/scripts/deployment"
for script in "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/*.py; do
  destination="$DEPLOY_ROOT/scripts/deployment/$(basename "$script")"
  if [ "$script" != "$destination" ]; then
    install -m 0750 "$script" "$destination.pending"
    mv "$destination.pending" "$destination"
  fi
done
printf 'SUCCESS release=%s environment=%s\n' "$release" "$environment" >"$report/status"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$DEPLOY_ROOT/last-successful-deploy"
# Keep every backup/report; only our own maintenance marker is removed after success.
rm -- "$marker"
finished=1
echo "Upgrade completed: $release; private evidence: $report"
