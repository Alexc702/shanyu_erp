#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
acquire_operation_lock
compose up -d postgres --wait --wait-timeout 120
require_postgres

preflight="$(postgres_sql -AtF '|' <<'SQL'
WITH active_admin_accounts AS (
  SELECT id
  FROM users
  WHERE role = 'ADMIN' AND status = 'ACTIVE'
), users_to_delete AS (
  SELECT id FROM users WHERE role <> 'ADMIN'
), preserved_references AS (
  SELECT created_by_user_id AS id FROM catalog_import_batches
  UNION ALL
  SELECT published_by_user_id AS id FROM half_package_template_versions
), v3 AS (
  SELECT v.id
  FROM half_package_template_versions v
  JOIN catalog_import_batches b ON b.published_version_id = v.id
  WHERE b.status = 'PUBLISHED'
    AND b.file_hash = 'ede2e24df4d912c78d5d1e91d206b289129fddfb5a59a34678c8929a6c8572fa'
)
SELECT
  (SELECT count(*) FROM active_admin_accounts),
  (SELECT count(*) FROM users WHERE role = 'ADMIN'),
  (SELECT count(*) FROM users_to_delete),
  (SELECT count(*) FROM preserved_references r JOIN users_to_delete u ON u.id = r.id),
  (SELECT count(*) FROM v3),
  (SELECT count(*) FROM half_package_version_items i JOIN v3 ON v3.id = i.template_version_id);
SQL
)"
IFS='|' read -r active_admin_count admin_account_count delete_user_count catalog_reference_count v3_count v3_item_count <<EOF
$preflight
EOF

if [ "$active_admin_count" -lt 1 ] || [ "$admin_account_count" -lt 1 ]; then
  echo "Clear refused: at least one active ADMIN account is required." >&2
  exit 1
fi
if [ "$catalog_reference_count" != "0" ]; then
  echo "Clear refused: $catalog_reference_count preserved catalog records reference a non-ADMIN user." >&2
  exit 1
fi
if [ "$v3_count" != "1" ] || [ "$v3_item_count" != "161" ]; then
  echo "Clear refused: the published V3 catalog must contain exactly 161 items (found versions=$v3_count, items=$v3_item_count)." >&2
  exit 1
fi

catalog_fingerprint_before="$(postgres_sql -At <<'SQL'
SELECT md5(string_agg(
  concat_ws('|', v.version_number, i.id, i.item_name, i.unit, i.remarks,
    p.sale_unit_price, p.cost_unit_price), E'\n' ORDER BY v.version_number, i.id
))
FROM half_package_version_items i
JOIN half_package_template_versions v ON v.id = i.template_version_id
JOIN half_package_item_price_versions p ON p.version_item_id = i.id;
SQL
)"

backup_result="$(mktemp)"
cleanup() {
  rm -f "$backup_result"
}
trap cleanup EXIT
SHANYU_OPERATION_LOCK_HELD=1 SHANYU_BACKUP_RESULT_FILE="$backup_result" \
  "$SCRIPT_DIR/server-backup.sh"
backup_file="$(sed -n '1p' "$backup_result")"
verified_backup="$(verify_backup_file "$backup_file")"
backup_name="$(basename "$verified_backup")"

cat <<EOF

Scope A is ready to clear after a verified backup.
Backup: $verified_backup
Will delete:
  - all projects and project spaces
  - all quotation drafts/snapshots, approvals, versions, and exports
  - all users except ADMIN accounts
  - related project/quotation/user audit records
Will preserve:
  - ADMIN accounts and credentials
  - the database schema and migration history
  - all catalog data, including published V3 with 161 items
Ordinary users to delete: $delete_user_count
EOF

require_tty_confirmation 'First confirmation: type CLEAR' 'CLEAR'
require_tty_confirmation "Second confirmation: type CLEAR $backup_name" "CLEAR $backup_name"

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

postgres_sql <<'SQL'
BEGIN;
CREATE TEMP TABLE users_to_delete ON COMMIT DROP AS
  SELECT id FROM users WHERE role <> 'ADMIN';

DELETE FROM audit_events
WHERE actor_user_id IN (SELECT id FROM users_to_delete)
   OR target_type IN (
     'PROJECT', 'SPACE', 'PROJECT_SPACE', 'HALF_PACKAGE_QUOTATION',
     'HALF_PACKAGE_QUOTATION_LINE', 'QUOTATION', 'APPROVAL', 'EXPORT'
   )
   OR (
     target_type = 'USER'
     AND target_id IN (SELECT id::text FROM users_to_delete)
   );

TRUNCATE TABLE
  half_package_exports,
  half_package_approval_decisions,
  half_package_quotation_lines,
  half_package_quotation_spaces,
  half_package_quotations,
  project_spaces,
  projects;

DELETE FROM users WHERE id IN (SELECT id FROM users_to_delete);

INSERT INTO audit_events (
  id, action, actor_user_id, occurred_at, result, target_type, target_id,
  before_value, after_value, reason, metadata
)
SELECT
  gen_random_uuid(), 'USER_DATA_CLEARED', id, current_timestamp, 'SUCCESS',
  'SYSTEM', 'scope-a', NULL, NULL,
  'Verified backup followed by an operator-confirmed Scope A data clear',
  jsonb_build_object('scope', 'A', 'catalogV3ItemsPreserved', 161)
FROM users
WHERE role = 'ADMIN' AND status = 'ACTIVE'
ORDER BY created_at
LIMIT 1;
COMMIT;
SQL

postflight="$(postgres_sql -AtF '|' <<'SQL'
SELECT
  (SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'),
  (SELECT count(*) FROM users WHERE role <> 'ADMIN'),
  (SELECT count(*) FROM projects),
  (SELECT count(*) FROM project_spaces),
  (SELECT count(*) FROM half_package_quotations),
  (SELECT count(*) FROM half_package_approval_decisions),
  (SELECT count(*) FROM half_package_exports),
  (SELECT count(*)
     FROM half_package_version_items i
     JOIN half_package_template_versions v ON v.id = i.template_version_id
     JOIN catalog_import_batches b ON b.published_version_id = v.id
    WHERE b.status = 'PUBLISHED'
      AND b.file_hash = 'ede2e24df4d912c78d5d1e91d206b289129fddfb5a59a34678c8929a6c8572fa');
SQL
)"
IFS='|' read -r admin_after users_after projects_after spaces_after quotations_after approvals_after exports_after v3_items_after <<EOF
$postflight
EOF
catalog_fingerprint_after="$(postgres_sql -At <<'SQL'
SELECT md5(string_agg(
  concat_ws('|', v.version_number, i.id, i.item_name, i.unit, i.remarks,
    p.sale_unit_price, p.cost_unit_price), E'\n' ORDER BY v.version_number, i.id
))
FROM half_package_version_items i
JOIN half_package_template_versions v ON v.id = i.template_version_id
JOIN half_package_item_price_versions p ON p.version_item_id = i.id;
SQL
)"

if [ "$admin_after" -lt 1 ] || [ "$users_after" != "0" ] ||
   [ "$projects_after" != "0" ] || [ "$spaces_after" != "0" ] ||
   [ "$quotations_after" != "0" ] || [ "$approvals_after" != "0" ] ||
   [ "$exports_after" != "0" ] || [ "$v3_items_after" != "161" ] ||
   [ "$catalog_fingerprint_before" != "$catalog_fingerprint_after" ]; then
  echo "Post-clear verification failed. Restore from $verified_backup before use." >&2
  exit 1
fi

compose up -d --wait --wait-timeout 180
public_origin="$(env_value WEB_ORIGIN)"
curl --fail --silent --show-error --max-time 10 "$public_origin/api/health" >/dev/null
services_stopped=0
trap cleanup EXIT
echo "Scope A clear completed and verified. Recovery backup: $verified_backup"
