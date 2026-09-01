#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-admin-bootstrap-test.XXXXXX)"
TEST_PROJECT="shanyu-admin-test-$$"
POSTGRES_PORT="$(node -e '
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')"

cleanup() {
  docker compose \
    --project-name "$TEST_PROJECT" \
    --project-directory "$TEST_ROOT" \
    --env-file "$TEST_ROOT/.env.production" \
    --env-file "$TEST_ROOT/.release.env" \
    -f "$TEST_ROOT/compose.prod.yaml" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  case "$TEST_ROOT" in
    /tmp/shanyu-admin-bootstrap-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/backups"
cat >"$TEST_ROOT/bin/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat >"$TEST_ROOT/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TEST_ROOT/bin/sudo" "$TEST_ROOT/bin/flock"
export PATH="$TEST_ROOT/bin:$PATH"

cat >"$TEST_ROOT/compose.prod.yaml" <<EOF
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: \${POSTGRES_DB}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_USER: \${POSTGRES_USER}
    ports:
      - "127.0.0.1:$POSTGRES_PORT:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \$\${POSTGRES_USER} -d \$\${POSTGRES_DB}"]
      interval: 1s
      timeout: 3s
      retries: 30
EOF
cat >"$TEST_ROOT/.env.production" <<EOF
POSTGRES_DB=shanyu_admin_test
POSTGRES_USER=shanyu
POSTGRES_PASSWORD=deployment-test-password
WEB_ORIGIN=http://127.0.0.1
EOF
: >"$TEST_ROOT/.release.env"
: >"$TEST_ROOT/Caddyfile"
chmod 600 "$TEST_ROOT/.env.production" "$TEST_ROOT/.release.env"

docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  up -d --wait --wait-timeout 60 postgres >/dev/null

POSTGRES_DB=shanyu_admin_test \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PASSWORD=deployment-test-password \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_USER=shanyu \
  node "$PROJECT_ROOT/scripts/run-migrations.mjs" up >/dev/null

docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' >/dev/null
INSERT INTO users (id, account, display_name, role, status)
VALUES ('10000000-0000-4000-8000-000000000001', 'admin', '系统管理员', 'ADMIN', 'ACTIVE');
SQL

clear_output="$TEST_ROOT/clear.out"
if COMPOSE_PROJECT_NAME="$TEST_PROJECT" \
   SHANYU_DEPLOY_ROOT="$TEST_ROOT" \
   SHANYU_COMPOSE_FILE="$TEST_ROOT/compose.prod.yaml" \
   SHANYU_ENV_FILE="$TEST_ROOT/.env.production" \
   SHANYU_RELEASE_ENV_FILE="$TEST_ROOT/.release.env" \
   SHANYU_BACKUP_DIR="$TEST_ROOT/backups" \
   SHANYU_OPERATION_LOCK_FILE="$TEST_ROOT/operation.lock" \
   "$PROJECT_ROOT/scripts/deployment/server-backup-and-clear-user-data.sh" \
   >"$clear_output" 2>&1; then
  echo "Clear unexpectedly passed without the required V3 catalog." >&2
  exit 1
fi
if ! grep -q 'published V3 catalog must contain exactly 161 items' "$clear_output"; then
  echo "Clear did not reach the V3 catalog guard:" >&2
  cat "$clear_output" >&2
  exit 1
fi
if grep -q 'OWNER account named owner is required' "$clear_output"; then
  echo "Clear still requires the legacy OWNER account." >&2
  exit 1
fi
echo "PASS clear preflight accepts an active ADMIN without requiring OWNER"

docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' >/dev/null
TRUNCATE TABLE audit_events, auth_sessions, user_credentials, users CASCADE;
SQL

(cd "$PROJECT_ROOT" && pnpm --filter @shanyu/api build >/dev/null)
(cd "$PROJECT_ROOT" && \
  pnpm --filter @shanyu/api deploy --prod --legacy "$TEST_ROOT/api-package" \
    >/dev/null)
if [ ! -f "$TEST_ROOT/api-package/scripts/bootstrap-admin.mjs" ]; then
  echo "Production API package is missing scripts/bootstrap-admin.mjs." >&2
  exit 1
fi
BOOTSTRAP_SCRIPT="$TEST_ROOT/api-package/scripts/bootstrap-admin.mjs"

POSTGRES_DB=shanyu_admin_test \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PASSWORD=deployment-test-password \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_USER=shanyu \
ADMIN_ACCOUNT=admin \
ADMIN_DISPLAY_NAME=系统管理员 \
ADMIN_PASSWORD='Shanyu123!' \
  node "$BOOTSTRAP_SCRIPT" \
  >"$TEST_ROOT/bootstrap-first.out"

admin_row="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT account, display_name, role, status FROM users"')"
if [ "$admin_row" != "admin|系统管理员|ADMIN|ACTIVE" ]; then
  echo "Unexpected bootstrapped ADMIN row: $admin_row" >&2
  exit 1
fi

role_counts="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT count(*) FILTER (WHERE role = '\''ADMIN'\''),
            count(*) FILTER (WHERE role = '\''OWNER'\'')
       FROM users"')"
if [ "$role_counts" != "1|0" ]; then
  echo "Expected one ADMIN and no OWNER, found: $role_counts" >&2
  exit 1
fi

password_hash="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT password_hash FROM user_credentials"')"
(cd "$PROJECT_ROOT" && \
  PASSWORD_HASH="$password_hash" TEST_PASSWORD='Shanyu123!' \
  node --input-type=module -e '
    const { verifyPassword } = await import("./apps/api/dist/access/password.js");
    if (!(await verifyPassword(process.env.TEST_PASSWORD, process.env.PASSWORD_HASH))) {
      process.exit(1);
    }
  ')
echo "PASS empty database bootstraps the specified ADMIN without OWNER"

admin_snapshot="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT u.id, u.account, u.display_name, c.password_hash
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
      WHERE u.role = '\''ADMIN'\''"')"
POSTGRES_DB=shanyu_admin_test \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PASSWORD=deployment-test-password \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_USER=shanyu \
ADMIN_ACCOUNT=changed-admin \
ADMIN_DISPLAY_NAME=不应覆盖 \
ADMIN_PASSWORD='Changed456!' \
  node "$BOOTSTRAP_SCRIPT" \
  >"$TEST_ROOT/bootstrap-changed-input.out"
admin_after_changed_input="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT u.id, u.account, u.display_name, c.password_hash
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
      WHERE u.role = '\''ADMIN'\''"')"
if [ "$admin_after_changed_input" != "$admin_snapshot" ]; then
  echo "Existing ADMIN account, display name, or password hash was modified." >&2
  exit 1
fi
echo "PASS changed bootstrap inputs never overwrite an existing ADMIN"

env -u ADMIN_ACCOUNT -u ADMIN_DISPLAY_NAME -u ADMIN_PASSWORD \
  POSTGRES_DB=shanyu_admin_test \
  POSTGRES_HOST=127.0.0.1 \
  POSTGRES_PASSWORD=deployment-test-password \
  POSTGRES_PORT="$POSTGRES_PORT" \
  POSTGRES_USER=shanyu \
  node "$BOOTSTRAP_SCRIPT" \
  >"$TEST_ROOT/bootstrap-existing.out"
grep -q '已存在 ADMIN 账号，未修改账号或密码' \
  "$TEST_ROOT/bootstrap-existing.out"
echo "PASS existing ADMIN needs no bootstrap credentials and remains unchanged"

docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' >/dev/null
TRUNCATE TABLE audit_events, auth_sessions, user_credentials, users CASCADE;
CREATE OR REPLACE FUNCTION delay_admin_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_sleep(0.5);
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_delay_admin_insert
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION delay_admin_insert();
SQL

bootstrap_pids=()
for index in 1 2 3 4; do
  POSTGRES_DB=shanyu_admin_test \
  POSTGRES_HOST=127.0.0.1 \
  POSTGRES_PASSWORD=deployment-test-password \
  POSTGRES_PORT="$POSTGRES_PORT" \
  POSTGRES_USER=shanyu \
  ADMIN_ACCOUNT="admin-$index" \
  ADMIN_DISPLAY_NAME=系统管理员 \
  ADMIN_PASSWORD='Shanyu123!' \
    node "$BOOTSTRAP_SCRIPT" \
    >"$TEST_ROOT/bootstrap-concurrent-$index.out" 2>&1 &
  bootstrap_pids+=("$!")
done
for bootstrap_pid in "${bootstrap_pids[@]}"; do
  if ! wait "$bootstrap_pid"; then
    echo "Concurrent ADMIN bootstrap command failed." >&2
    cat "$TEST_ROOT"/bootstrap-concurrent-*.out >&2
    exit 1
  fi
done

concurrent_counts="$(docker compose \
  --project-name "$TEST_PROJECT" \
  --project-directory "$TEST_ROOT" \
  --env-file "$TEST_ROOT/.env.production" \
  --env-file "$TEST_ROOT/.release.env" \
  -f "$TEST_ROOT/compose.prod.yaml" \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
    "SELECT (SELECT count(*) FROM users WHERE role = '\''ADMIN'\''),
            (SELECT count(*) FROM audit_events WHERE action = '\''USER_BOOTSTRAPPED'\'')"')"
if [ "$concurrent_counts" != "1|1" ]; then
  echo "Concurrent bootstrap must create one ADMIN and one audit event; found: $concurrent_counts" >&2
  exit 1
fi
echo "PASS concurrent bootstrap commands create exactly one ADMIN"

deploy_fixture="$TEST_ROOT/deploy-fixture"
deploy_bin="$TEST_ROOT/deploy-bin"
deploy_log="$TEST_ROOT/deploy-docker.log"
backup_log="$TEST_ROOT/deploy-backup.log"
mkdir -p "$deploy_fixture/scripts/deployment" "$deploy_fixture/backups" "$deploy_bin"
cp "$PROJECT_ROOT/scripts/deployment/server-deploy.sh" \
  "$PROJECT_ROOT/scripts/deployment/server-common.sh" \
  "$deploy_fixture/scripts/deployment/"
cat >"$deploy_fixture/scripts/deployment/server-backup.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${SHANYU_REQUIRE_RUNNING_POSTGRES:-0}" >>"$FAKE_DEPLOY_BACKUP_LOG"
exit 0
EOF
chmod +x "$deploy_fixture/scripts/deployment/"*.sh
: >"$deploy_fixture/compose.prod.yaml"
: >"$deploy_fixture/Caddyfile"
cat >"$deploy_fixture/.env.production" <<'EOF'
ADMIN_ACCOUNT=admin
ADMIN_DISPLAY_NAME=系统管理员
ADMIN_INITIAL_PASSWORD=Shanyu123!
WEB_ORIGIN=http://127.0.0.1
EOF
: >"$deploy_fixture/.release.env"
chmod 600 "$deploy_fixture/.env.production" "$deploy_fixture/.release.env"

cat >"$deploy_bin/stat" <<'EOF'
#!/usr/bin/env bash
printf '600\n'
EOF
cat >"$deploy_bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$deploy_bin/sudo" <<'EOF'
#!/usr/bin/env bash
unset ADMIN_PASSWORD
exec "$@"
EOF
cat >"$deploy_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_DEPLOY_DOCKER_LOG"
if [[ "$*" == *"exec -T postgres"* ]]; then
  printf '1\n'
fi
if [[ "$*" == *"bootstrap-admin.mjs"* ]]; then
  IFS= read -r bootstrap_password
  if [ "$bootstrap_password" != 'Shanyu123!' ]; then
    echo "Deployment did not pass the configured ADMIN password over stdin." >&2
    exit 1
  fi
fi
EOF
chmod +x \
  "$deploy_bin/stat" \
  "$deploy_bin/curl" \
  "$deploy_bin/sudo" \
  "$deploy_bin/docker"

FAKE_DEPLOY_DOCKER_LOG="$deploy_log" \
FAKE_DEPLOY_BACKUP_LOG="$backup_log" \
PATH="$deploy_bin:$TEST_ROOT/bin:$PATH" \
SHANYU_DEPLOY_ROOT="$deploy_fixture" \
SHANYU_COMPOSE_FILE="$deploy_fixture/compose.prod.yaml" \
SHANYU_ENV_FILE="$deploy_fixture/.env.production" \
SHANYU_RELEASE_ENV_FILE="$deploy_fixture/.release.env" \
SHANYU_BACKUP_DIR="$deploy_fixture/backups" \
  "$deploy_fixture/scripts/deployment/server-deploy.sh" \
  >"$TEST_ROOT/deploy.out"

if ! grep -q 'bootstrap-admin.mjs' "$deploy_log"; then
  echo "Deployment did not delegate ADMIN detection to bootstrap-admin.mjs." >&2
  exit 1
fi
if grep -q "role = 'ADMIN'" "$deploy_log"; then
  echo "Deployment still duplicates the ADMIN existence query." >&2
  exit 1
fi
echo "PASS deployment always delegates idempotent ADMIN initialization"
echo "PASS deployment passes the ADMIN password through sudo over stdin"

if [ "$(sed -n '1p' "$backup_log")" != "1" ]; then
  echo "Deployment did not require a successful backup before migrating an existing database." >&2
  exit 1
fi
echo "PASS existing database requires a successful pre-migration backup"
