#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-export-worker-runtime-test.XXXXXX)"
TEST_PROJECT="shanyu-export-worker-runtime-test-$$"

compose() {
  docker compose \
    --project-name "$TEST_PROJECT" \
    --project-directory "$TEST_ROOT" \
    --env-file "$TEST_ROOT/.env.production" \
    --env-file "$TEST_ROOT/.release.env" \
    -f "$TEST_ROOT/compose.prod.yaml" \
    "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  case "$TEST_ROOT" in
    /tmp/shanyu-export-worker-runtime-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

cp "$PROJECT_ROOT/compose.prod.yaml" "$TEST_ROOT/compose.prod.yaml"
cat >"$TEST_ROOT/.env.production" <<'EOF'
CADDY_SITE_ADDRESS=:80
WEB_ORIGIN=http://127.0.0.1
SESSION_COOKIE_SECURE=false
SHANYU_DEPLOYMENT_ENVIRONMENT=test
SHANYU_BACKUP_MODE=local
POSTGRES_DB=shanyu_erp
POSTGRES_USER=shanyu
POSTGRES_PASSWORD=deployment-test-password
ADMIN_ACCOUNT=admin
ADMIN_DISPLAY_NAME=系统管理员
ADMIN_INITIAL_PASSWORD=deployment-test-password
MINIO_ROOT_USER=test-minio
MINIO_ROOT_PASSWORD=test-minio-password
EOF
cat >"$TEST_ROOT/.release.env" <<'EOF'
API_IMAGE=node:24.20.0-bookworm-slim
WEB_IMAGE=node:24.20.0-bookworm-slim
RELEASE_VERSION=export-worker-runtime-test
EOF
chmod 600 "$TEST_ROOT/.env.production" "$TEST_ROOT/.release.env"

compose config --format json >"$TEST_ROOT/compose.json"
node - "$TEST_ROOT/compose.json" <<'NODE'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const init = config.services["export-storage-init"];
const worker = config.services["export-worker"];
if (!init) throw new Error("export-storage-init service is missing");
if (init.user !== "0:0") throw new Error("export-storage-init must run as 0:0");
if (init.restart !== "no") throw new Error("export-storage-init must not restart");
const initVolume = init.volumes.find(
  (volume) => volume.target === "/app/export-files",
);
if (!initVolume || initVolume.read_only) {
  throw new Error("export-storage-init must mount quotation_exports read-write");
}
if (
  worker.depends_on?.["export-storage-init"]?.condition !==
  "service_completed_successfully"
) {
  throw new Error("export-worker must wait for export-storage-init");
}
const healthTest = worker.healthcheck?.test ?? [];
if (!healthTest.join(" ").includes("scripts/export-worker-healthcheck.mjs")) {
  throw new Error("export-worker healthcheck script is not configured");
}
NODE
echo "PASS Compose requires export storage initialization before the worker"

(cd "$PROJECT_ROOT" && \
  pnpm --filter @shanyu/api deploy --prod --legacy "$TEST_ROOT/api-package" \
    >/dev/null)
test -f "$TEST_ROOT/api-package/scripts/export-worker-healthcheck.mjs"
node --check "$TEST_ROOT/api-package/scripts/export-worker-healthcheck.mjs"
echo "PASS production API package contains a valid worker healthcheck script"

compose up \
  --no-deps \
  --abort-on-container-exit \
  --exit-code-from export-storage-init \
  export-storage-init >/dev/null
compose run --rm --no-deps \
  --user 1000:1000 \
  --entrypoint node \
  export-worker \
  -e 'const fs = require("node:fs"); const path = "/app/export-files/.permission-probe"; fs.writeFileSync(path, "ok"); fs.unlinkSync(path);'
echo "PASS a fresh quotation_exports volume is writable by the worker user"
