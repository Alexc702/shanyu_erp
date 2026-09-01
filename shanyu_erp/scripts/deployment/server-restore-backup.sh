#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
selected_backup="${1:-}"
if [ -z "$selected_backup" ]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 2
fi

acquire_operation_lock
compose up -d postgres --wait --wait-timeout 120
selected_backup="$(verify_backup_file "$selected_backup")"
selected_name="$(basename "$selected_backup")"

safety_result="$(mktemp)"
cleanup() {
  rm -f "$safety_result"
}
trap cleanup EXIT
SHANYU_OPERATION_LOCK_HELD=1 SHANYU_BACKUP_RESULT_FILE="$safety_result" \
  "$SCRIPT_DIR/server-backup.sh"
safety_backup="$(sed -n '1p' "$safety_result")"
safety_backup="$(verify_backup_file "$safety_backup")"

cat <<EOF

Selected backup: $selected_backup
Automatic pre-restore safety backup: $safety_backup
Restoring replaces the entire current PostgreSQL database, including users,
projects, quotations, approvals, exports, audit records, and catalog data.
EOF
require_tty_confirmation "First confirmation: type RESTORE $selected_name" "RESTORE $selected_name"
require_tty_confirmation 'Second confirmation: type REPLACE CURRENT DATA' 'REPLACE CURRENT DATA'

services_stopped=0
recover_services() {
  if [ "$services_stopped" = "1" ]; then
    compose up -d --wait --wait-timeout 180 >/dev/null 2>&1 || true
  fi
  cleanup
}
trap recover_services EXIT
compose stop caddy web api
services_stopped=1

restore_dump() {
  local dump_file="$1"
  compose exec -T postgres sh -lc \
    'dropdb --if-exists --force --maintenance-db=postgres -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -T template0 -U "$POSTGRES_USER" "$POSTGRES_DB"'
  compose exec -T postgres sh -lc \
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' \
    <"$dump_file"
}

run_migrations() {
  compose run --rm --no-deps api node scripts/run-migrations.mjs up
}

metadata_matches() {
  local metadata_file="$selected_backup.meta"
  local expected actual key
  if [ ! -f "$metadata_file" ]; then
    echo "No metadata sidecar was present; checksum and pg_restore validation were used."
    return 0
  fi
  actual="$(postgres_sql -AtF '=' <<'SQL'
SELECT 'users', count(*) FROM users;
SELECT 'published_catalog_versions', count(*) FROM catalog_import_batches WHERE status = 'PUBLISHED';
SELECT 'published_catalog_items', count(*)
FROM half_package_version_items i
JOIN catalog_import_batches b ON b.published_version_id = i.template_version_id
WHERE b.status = 'PUBLISHED';
SELECT 'projects', count(*) FROM projects;
SELECT 'project_spaces', count(*) FROM project_spaces;
SELECT 'quotations', count(*) FROM half_package_quotations;
SELECT 'approval_decisions', count(*) FROM half_package_approval_decisions;
SELECT 'exports', count(*) FROM half_package_exports;
SELECT 'audit_events', count(*) FROM audit_events;
SQL
)"
  for key in users published_catalog_versions published_catalog_items projects project_spaces quotations approval_decisions exports audit_events; do
    expected="$(sed -n "s/^${key}=//p" "$metadata_file" | tail -n 1)"
    if [ -z "$expected" ]; then
      echo "Backup metadata is missing count: $key" >&2
      return 1
    fi
    if ! printf '%s\n' "$actual" | grep -qx "${key}=${expected}"; then
      echo "Restored count differs from metadata for $key (expected $expected)." >&2
      return 1
    fi
  done
}

rollback_to_safety() {
  echo "Restore validation failed; automatically restoring the safety backup." >&2
  compose stop caddy web api >/dev/null 2>&1 || true
  if restore_dump "$safety_backup" && run_migrations; then
    compose up -d --wait --wait-timeout 180
    echo "Current data was recovered from: $safety_backup" >&2
  else
    echo "CRITICAL: automatic recovery also failed. Keep PostgreSQL isolated and use: $safety_backup" >&2
  fi
  exit 1
}

if ! restore_dump "$selected_backup"; then
  rollback_to_safety
fi
if ! run_migrations; then
  rollback_to_safety
fi
if ! metadata_matches; then
  rollback_to_safety
fi

compose up -d --wait --wait-timeout 180
public_origin="$(env_value WEB_ORIGIN)"
if ! curl --fail --silent --show-error --max-time 10 "$public_origin/api/health" >/dev/null; then
  rollback_to_safety
fi

services_stopped=0
trap cleanup EXIT
echo "Restore completed, counts verified, and application healthy: $selected_backup"
echo "Pre-restore safety backup retained at: $safety_backup"
