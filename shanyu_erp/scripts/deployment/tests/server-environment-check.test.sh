#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-environment-check-test.XXXXXX)"

cleanup() {
  case "$TEST_ROOT" in
    /tmp/shanyu-environment-check-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/backups"
cp "$PROJECT_ROOT/compose.prod.yaml" "$TEST_ROOT/compose.prod.yaml"
cat >"$TEST_ROOT/.env.production" <<'EOF'
CADDY_SITE_ADDRESS=:80
WEB_ORIGIN=http://127.0.0.1
SESSION_COOKIE_SECURE=false
SHANYU_DEPLOYMENT_ENVIRONMENT=test
SHANYU_BACKUP_MODE=local
POSTGRES_DB=shanyu_erp
POSTGRES_USER=shanyu
POSTGRES_PASSWORD=test-password
MINIO_ROOT_USER=test-minio
MINIO_ROOT_PASSWORD=test-minio-password
EOF
cat >"$TEST_ROOT/.release.env" <<'EOF'
API_IMAGE=shanyu-erp-api:test
WEB_IMAGE=shanyu-erp-web:test
RELEASE_VERSION=test
EOF
chmod 600 "$TEST_ROOT/.env.production" "$TEST_ROOT/.release.env"
printf 'not a database backup\n' >"$TEST_ROOT/backups/recent-note.txt"

output="$TEST_ROOT/output.log"
SHANYU_COMPOSE_FILE="$TEST_ROOT/compose.prod.yaml" \
SHANYU_ENV_FILE="$TEST_ROOT/.env.production" \
SHANYU_RELEASE_ENV_FILE="$TEST_ROOT/.release.env" \
SHANYU_BACKUP_DIR="$TEST_ROOT/backups" \
SHANYU_HEALTH_URL=http://127.0.0.1:9/api/health \
  bash "$PROJECT_ROOT/scripts/environment-check.sh" server-test \
  >"$output" 2>&1 || true

for key in ADMIN_ACCOUNT ADMIN_DISPLAY_NAME ADMIN_INITIAL_PASSWORD; do
  if ! grep -q "Missing or empty variable: $key" "$output"; then
    echo "Server self-check did not reject missing $key." >&2
    cat "$output" >&2
    exit 1
  fi
done
echo "PASS server self-check requires ADMIN bootstrap variables"

if ! grep -q '^\[FAIL\] Recent backup artifact$' "$output"; then
  echo "Server self-check accepted an unrelated recent file as a database backup." >&2
  exit 1
fi
echo "PASS unrelated recent files do not satisfy the backup check"

if ! grep -q '^\[FAIL\] Public health endpoint$' "$output"; then
  echo "Server self-check reported a failed public health request as passing." >&2
  exit 1
fi
echo "PASS failed public health request fails the server self-check"

backup="$TEST_ROOT/backups/shanyu-erp-20260901T000000-000000000Z.dump"
printf 'database backup\n' >"$backup"
printf 'users=1\n' >"$backup.meta"
printf 'checksum fixture\n' >"$backup.sha256"
SHANYU_COMPOSE_FILE="$TEST_ROOT/compose.prod.yaml" \
SHANYU_ENV_FILE="$TEST_ROOT/.env.production" \
SHANYU_RELEASE_ENV_FILE="$TEST_ROOT/.release.env" \
SHANYU_BACKUP_DIR="$TEST_ROOT/backups" \
SHANYU_HEALTH_URL=http://127.0.0.1:9/api/health \
  bash "$PROJECT_ROOT/scripts/environment-check.sh" server-test \
  >"$output" 2>&1 || true
if ! grep -q '^\[PASS\] Recent backup artifact$' "$output"; then
  echo "Server self-check rejected a complete recent local backup triplet." >&2
  exit 1
fi
echo "PASS complete recent local backup triplet satisfies the backup check"

cat >"$TEST_ROOT/.env.production" <<'EOF'
CADDY_SITE_ADDRESS=erp.example.com
WEB_ORIGIN=https://erp.example.com
SESSION_COOKIE_SECURE=true
SHANYU_DEPLOYMENT_ENVIRONMENT=production
SHANYU_BACKUP_MODE=cos
POSTGRES_DB=shanyu_erp
POSTGRES_USER=shanyu
POSTGRES_PASSWORD=test-password
ADMIN_ACCOUNT=admin
ADMIN_DISPLAY_NAME=系统管理员
ADMIN_INITIAL_PASSWORD=deployment-test-password
MINIO_ROOT_USER=test-minio
MINIO_ROOT_PASSWORD=test-minio-password
EOF
chmod 600 "$TEST_ROOT/.env.production"
SHANYU_COMPOSE_FILE="$TEST_ROOT/compose.prod.yaml" \
SHANYU_ENV_FILE="$TEST_ROOT/.env.production" \
SHANYU_RELEASE_ENV_FILE="$TEST_ROOT/.release.env" \
SHANYU_BACKUP_DIR="$TEST_ROOT/backups" \
SHANYU_HEALTH_URL=https://127.0.0.1:9/api/health \
  bash "$PROJECT_ROOT/scripts/environment-check.sh" server \
  >"$output" 2>&1 || true
if ! grep -q '^\[FAIL\] Recent backup artifact$' "$output"; then
  echo "Production self-check accepted a backup without COS verification." >&2
  exit 1
fi
echo "PASS production rejects a backup without a COS verification marker"

printf 'cos verification\n' >"$backup.cos"
SHANYU_COMPOSE_FILE="$TEST_ROOT/compose.prod.yaml" \
SHANYU_ENV_FILE="$TEST_ROOT/.env.production" \
SHANYU_RELEASE_ENV_FILE="$TEST_ROOT/.release.env" \
SHANYU_BACKUP_DIR="$TEST_ROOT/backups" \
SHANYU_HEALTH_URL=https://127.0.0.1:9/api/health \
  bash "$PROJECT_ROOT/scripts/environment-check.sh" server \
  >"$output" 2>&1 || true
if ! grep -q '^\[PASS\] Recent backup artifact$' "$output"; then
  echo "Production self-check rejected a complete COS-verified backup." >&2
  exit 1
fi
echo "PASS complete COS-verified backup satisfies the production check"
