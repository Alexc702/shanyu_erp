#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-cos-backup-test.XXXXXX)"

cleanup() {
  case "$TEST_ROOT" in
    /tmp/shanyu-cos-backup-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

FAKE_BIN="$TEST_ROOT/bin"
FAKE_COS_ROOT="$TEST_ROOT/cos"
FAKE_COS_LOG="$TEST_ROOT/cos.log"
mkdir -p "$FAKE_BIN" "$FAKE_COS_ROOT"
export FAKE_COS_ROOT FAKE_COS_LOG
export PATH="$FAKE_BIN:$PATH"

cat >"$FAKE_BIN/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$FAKE_BIN/date" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "-u +%Y%m%dT%H%M%S-%NZ" ]; then
  printf '20260901T000000-000000001Z\n'
  exit 0
fi
exec /bin/date "$@"
EOF

cat >"$FAKE_BIN/realpath" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-e" ]; then
  shift
fi
target="${1:-}"
test -e "$target"
target_dir="$(cd "$(dirname "$target")" && pwd -P)"
printf '%s/%s\n' "$target_dir" "$(basename "$target")"
EOF

cat >"$FAKE_BIN/sha256sum" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ -x /usr/bin/sha256sum ]; then
  exec /usr/bin/sha256sum "$@"
fi
LC_ALL=C LANG=C exec /usr/bin/shasum -a 256 "$@"
EOF

cat >"$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-n" ]; then
  shift
fi
if [ "${1:-}" = "stat" ] && [ "${2:-}" = "-c" ] && [ "${3:-}" = "%U:%G %a" ]; then
  echo "root:root 600"
  exit 0
fi
if [ "${1:-}" = "chown" ]; then
  exit 0
fi
exec "$@"
EOF

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
arguments="$*"
if [ "${1:-}" = "inspect" ]; then
  echo "true"
elif [[ "$arguments" == *" ps -q postgres"* ]]; then
  echo "fake-postgres-container"
elif [[ "$arguments" == *"pg_dump"* ]]; then
  printf 'fake-postgresql-custom-backup\n'
elif [[ "$arguments" == *"psql -U"* ]]; then
  printf '%s\n' \
    'users=2' \
    'published_catalog_versions=1' \
    'published_catalog_items=161' \
    'projects=1' \
    'project_spaces=2' \
    'quotations=1' \
    'approval_decisions=0' \
    'exports=0' \
    'audit_events=3'
elif [[ "$arguments" == *"pg_restore --list"* ]]; then
  cat >/dev/null
else
  exit 0
fi
EOF

cat >"$FAKE_BIN/coscli" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

command_name="${1:-}"
shift || true
arguments=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-c" ]; then
    shift 2
    continue
  fi
  arguments+=("$1")
  shift
done

remote_path() {
  local uri="$1"
  printf '%s/%s\n' "$FAKE_COS_ROOT" "${uri#cos://*/}"
}

case "$command_name" in
  cp)
    source_path="${arguments[0]}"
    destination_path="${arguments[1]}"
    if [[ "$source_path" = cos://* ]]; then
      stored_path="$(remote_path "$source_path")"
      cp "$stored_path" "$destination_path"
      if [ "${FAKE_COS_CORRUPT_READBACK:-0}" = "1" ] && [[ "$source_path" = *.dump ]]; then
        printf 'corrupted\n' >>"$destination_path"
      fi
      printf 'download %s\n' "$(basename "$source_path")" >>"$FAKE_COS_LOG"
    else
      if [ "${FAKE_COS_FAIL_UPLOAD:-0}" = "1" ]; then
        echo "simulated COS upload failure" >&2
        exit 1
      fi
      stored_path="$(remote_path "$destination_path")"
      mkdir -p "$(dirname "$stored_path")"
      cp "$source_path" "$stored_path"
      printf 'upload %s\n' "$(basename "$source_path")" >>"$FAKE_COS_LOG"
    fi
    ;;
  stat)
    stored_path="$(remote_path "${arguments[0]}")"
    test -s "$stored_path"
    printf 'stat %s\n' "$(basename "${arguments[0]}")" >>"$FAKE_COS_LOG"
    ;;
  *)
    echo "unexpected fake coscli command: $command_name" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$FAKE_BIN/flock" "$FAKE_BIN/date" "$FAKE_BIN/realpath" \
  "$FAKE_BIN/sha256sum" "$FAKE_BIN/sudo" "$FAKE_BIN/docker" \
  "$FAKE_BIN/coscli"

make_fixture() {
  local name="$1"
  local environment="$2"
  local mode="$3"
  local root="$TEST_ROOT/$name"
  local public_origin
  mkdir -p "$root/backups"
  : >"$root/compose.prod.yaml"
  : >"$root/Caddyfile"
  cat >"$root/.release.env" <<EOF
API_IMAGE=fake-api:test
WEB_IMAGE=fake-web:test
RELEASE_VERSION=test-release
EOF
  if [ "$environment" = "production" ]; then
    public_origin="https://erp.example.com"
  else
    public_origin="http://203.0.113.10"
  fi
  cat >"$root/.env.production" <<EOF
WEB_ORIGIN=$public_origin
SHANYU_COSCLI_PATH=$FAKE_BIN/coscli
SHANYU_COS_CONFIG_PATH=$root/cos.yaml
SHANYU_COS_BUCKET_ALIAS=shanyu-backup
SHANYU_COS_BACKUP_PREFIX=shanyu-erp/production/postgresql
EOF
  if [ "$environment" != "omit" ]; then
    printf 'SHANYU_DEPLOYMENT_ENVIRONMENT=%s\n' "$environment" \
      >>"$root/.env.production"
  fi
  if [ "$mode" != "omit" ]; then
    printf 'SHANYU_BACKUP_MODE=%s\n' "$mode" >>"$root/.env.production"
  fi
  : >"$root/cos.yaml"
  chmod 600 "$root/.env.production" "$root/.release.env" "$root/cos.yaml"
  printf '%s\n' "$root"
}

run_script() {
  local root="$1"
  local script="$2"
  shift 2
  SHANYU_DEPLOY_ROOT="$root" \
  SHANYU_COMPOSE_FILE="$root/compose.prod.yaml" \
  SHANYU_ENV_FILE="$root/.env.production" \
  SHANYU_RELEASE_ENV_FILE="$root/.release.env" \
  SHANYU_BACKUP_DIR="$root/backups" \
  SHANYU_OPERATION_LOCK_FILE="$root/backup.lock" \
    "$script" "$@"
}

assert_file_count() {
  local expected="$1"
  local pattern="$2"
  local actual directory filename
  directory="$(dirname "$pattern")"
  filename="$(basename "$pattern")"
  actual="$(find "$directory" -maxdepth 1 -type f -name "$filename" | wc -l | tr -d ' ')"
  if [ "$actual" != "$expected" ]; then
    echo "Expected $expected files for $pattern, found $actual" >&2
    exit 1
  fi
}

test_root="$(make_fixture test-local omit omit)"
: >"$FAKE_COS_LOG"
run_script "$test_root" "$PROJECT_ROOT/scripts/deployment/server-backup.sh" \
  >"$TEST_ROOT/test-local.out"
grep -q 'Test environment: local backup verified; COS is not configured or used.' \
  "$TEST_ROOT/test-local.out"
test ! -s "$FAKE_COS_LOG"
assert_file_count 1 "$test_root/backups/shanyu-erp-*.dump"
assert_file_count 0 "$test_root/backups/shanyu-erp-*.dump.cos"
echo "PASS existing HTTP test environment remains local-only without COS settings"

production_root="$(make_fixture production-success production cos)"
: >"$FAKE_COS_LOG"
run_script "$production_root" "$PROJECT_ROOT/scripts/deployment/server-backup.sh" \
  >"$TEST_ROOT/production-success.out"
grep -q 'COS backup uploaded and read-back verified' "$TEST_ROOT/production-success.out"
assert_file_count 1 "$production_root/backups/shanyu-erp-*.dump.cos"
test "$(grep -c '^upload ' "$FAKE_COS_LOG")" = "3"
grep '^upload ' "$FAKE_COS_LOG" | sed -n '1p' | grep -q '\.dump$'
grep '^upload ' "$FAKE_COS_LOG" | sed -n '2p' | grep -q '\.dump\.meta$'
grep '^upload ' "$FAKE_COS_LOG" | sed -n '3p' | grep -q '\.dump\.sha256$'
grep -q '^environment=production$' "$production_root"/backups/*.dump.cos
grep -q '^remote_uri=cos://shanyu-backup/shanyu-erp/production/postgresql/' \
  "$production_root"/backups/*.dump.cos
echo "PASS production uploads dump, metadata, checksum last and verifies read-back"

production_backup="$(find "$production_root/backups" -maxdepth 1 -type f -name '*.dump' | head -n 1)"
if run_script "$production_root" "$PROJECT_ROOT/scripts/deployment/server-backup-to-cos.sh" \
  "$production_backup" >"$TEST_ROOT/production-repeat.out" 2>&1; then
  echo "Existing COS success marker unexpectedly allowed an overwrite." >&2
  exit 1
fi
grep -q 'COS success marker already exists' "$TEST_ROOT/production-repeat.out"
test "$(grep -c '^upload ' "$FAKE_COS_LOG")" = "3"
echo "PASS completed COS backup ID cannot be overwritten"

corrupt_root="$(make_fixture production-corrupt production cos)"
: >"$FAKE_COS_LOG"
if FAKE_COS_CORRUPT_READBACK=1 \
  run_script "$corrupt_root" "$PROJECT_ROOT/scripts/deployment/server-backup.sh" \
    >"$TEST_ROOT/production-corrupt.out" 2>&1; then
  echo "Corrupted COS read-back unexpectedly passed." >&2
  exit 1
fi
assert_file_count 0 "$corrupt_root/backups/shanyu-erp-*.dump.cos"
echo "PASS corrupted COS read-back fails without success marker"

failure_root="$(make_fixture production-upload-failure production cos)"
old_backup="$failure_root/backups/shanyu-erp-20200101T000000-000000000Z.dump"
printf 'old backup\n' >"$old_backup"
: >"$FAKE_COS_LOG"
if FAKE_COS_FAIL_UPLOAD=1 SHANYU_BACKUP_RETENTION_DAYS=1 \
  run_script "$failure_root" "$PROJECT_ROOT/scripts/deployment/server-scheduled-backup.sh" \
    >"$TEST_ROOT/production-upload-failure.out" 2>&1; then
  echo "Failed COS upload unexpectedly passed." >&2
  exit 1
fi
test -f "$old_backup"
echo "PASS COS failure prevents scheduled retention cleanup"

invalid_test_root="$(make_fixture test-cos test cos)"
if run_script "$invalid_test_root" "$PROJECT_ROOT/scripts/deployment/server-backup.sh" \
  >"$TEST_ROOT/test-cos.out" 2>&1; then
  echo "Test environment unexpectedly accepted COS mode." >&2
  exit 1
fi
grep -q 'Test environment must use local backups' "$TEST_ROOT/test-cos.out"
echo "PASS test environment rejects COS mode"

invalid_production_root="$(make_fixture production-local production local)"
if run_script "$invalid_production_root" "$PROJECT_ROOT/scripts/deployment/server-backup.sh" \
  >"$TEST_ROOT/production-local.out" 2>&1; then
  echo "Production environment unexpectedly accepted local-only mode." >&2
  exit 1
fi
grep -q 'Production environment requires SHANYU_BACKUP_MODE=cos' \
  "$TEST_ROOT/production-local.out"
echo "PASS production rejects local-only mode"
