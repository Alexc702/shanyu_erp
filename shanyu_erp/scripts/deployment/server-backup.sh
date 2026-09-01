#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
environment="$(deployment_environment)"
mode="$(backup_mode "$environment")"
acquire_operation_lock
if ! postgres_is_running; then
  if [ "${SHANYU_REQUIRE_RUNNING_POSTGRES:-0}" = "1" ]; then
    echo "PostgreSQL is not running; required backup failed." >&2
    exit 1
  fi
  echo "PostgreSQL is not running; no pre-deployment backup was needed."
  exit 0
fi

install -d -m 0750 "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%S-%NZ)"
backup_file="$BACKUP_DIR/shanyu-erp-$timestamp.dump"
temporary_file="$backup_file.pending"
checksum_file="$backup_file.sha256"
metadata_file="$backup_file.meta"
umask 077

cleanup() {
  rm -f "$temporary_file" "$checksum_file.pending" "$metadata_file.pending"
}
trap cleanup EXIT

compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$temporary_file"
test -s "$temporary_file"
mv "$temporary_file" "$backup_file"

release_version="$(sed -n 's/^RELEASE_VERSION=//p' "$RELEASE_ENV_FILE" | tail -n 1)"
counts="$({
  compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "=" <<'\''SQL'\''
SELECT '\''users'\'', count(*) FROM users;
SELECT '\''published_catalog_versions'\'', count(*) FROM catalog_import_batches WHERE status = '\''PUBLISHED'\'';
SELECT '\''published_catalog_items'\'', count(*)
FROM half_package_version_items i
JOIN catalog_import_batches b ON b.published_version_id = i.template_version_id
WHERE b.status = '\''PUBLISHED'\'';
SELECT '\''projects'\'', count(*) FROM projects;
SELECT '\''project_spaces'\'', count(*) FROM project_spaces;
SELECT '\''quotations'\'', count(*) FROM half_package_quotations;
SELECT '\''approval_decisions'\'', count(*) FROM half_package_approval_decisions;
SELECT '\''exports'\'', count(*) FROM half_package_exports;
SELECT '\''audit_events'\'', count(*) FROM audit_events;
SQL'
} 2>/dev/null)"
{
  printf 'format=shanyu-postgresql-custom-v1\n'
  printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'release_version=%s\n' "$release_version"
  printf '%s\n' "$counts"
} >"$metadata_file.pending"
mv "$metadata_file.pending" "$metadata_file"
sha256sum "$backup_file" "$metadata_file" >"$checksum_file.pending"
mv "$checksum_file.pending" "$checksum_file"
chmod 600 "$backup_file" "$checksum_file" "$metadata_file"

verify_backup_file "$backup_file" >/dev/null
if [ "$mode" = "cos" ]; then
  SHANYU_OPERATION_LOCK_HELD=1 \
    "$SCRIPT_DIR/server-backup-to-cos.sh" "$backup_file"
else
  echo "Test environment: local backup verified; COS is not configured or used."
fi
write_backup_result "$backup_file"
trap - EXIT
echo "Created PostgreSQL backup: $backup_file"
