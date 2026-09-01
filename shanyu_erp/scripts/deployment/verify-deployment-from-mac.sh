#!/usr/bin/env bash

set -Eeuo pipefail

SSH_HOST="${1:-}"
PUBLIC_ORIGIN="${2:-}"
EXPECTED_RELEASE="${3:-}"
REMOTE_ROOT="${SHANYU_REMOTE_DEPLOY_ROOT:-/srv/shanyu-erp}"
ADMIN_ACCOUNT="${SHANYU_ADMIN_ACCOUNT:-admin}"
ADMIN_DISPLAY_NAME="${SHANYU_ADMIN_DISPLAY_NAME:-系统管理员}"
ADMIN_PASSWORD="${SHANYU_ADMIN_PASSWORD:-}"
EXPECT_FRESH_ADMIN_ONLY="${SHANYU_EXPECT_FRESH_ADMIN_ONLY:-0}"

if [ -z "$SSH_HOST" ] || [ -z "$PUBLIC_ORIGIN" ] || [ -z "$EXPECTED_RELEASE" ]; then
  echo "Usage: SHANYU_ADMIN_PASSWORD=... $0 <ssh-host> <public-origin> <expected-release>" >&2
  exit 2
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "SHANYU_ADMIN_PASSWORD is required for the ADMIN login acceptance check." >&2
  exit 2
fi
if [[ ! "$PUBLIC_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "Public origin must be an HTTP(S) origin without a path or trailing slash." >&2
  exit 2
fi
if [[ ! "$EXPECTED_RELEASE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Expected release may contain only letters, digits, dots, underscores, and hyphens." >&2
  exit 2
fi
case "$REMOTE_ROOT" in
  /*) ;;
  *) echo "SHANYU_REMOTE_DEPLOY_ROOT must be absolute." >&2; exit 2 ;;
esac
case "$REMOTE_ROOT" in
  *[!A-Za-z0-9._/-]*)
    echo "SHANYU_REMOTE_DEPLOY_ROOT contains unsupported characters." >&2
    exit 2
    ;;
esac
case "$EXPECT_FRESH_ADMIN_ONLY" in
  0|1) ;;
  *) echo "SHANYU_EXPECT_FRESH_ADMIN_ONLY must be 0 or 1." >&2; exit 2 ;;
esac

for command_name in curl node ssh; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required for deployment acceptance." >&2
    exit 1
  }
done

SSH_CONTROL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shanyu-acceptance-ssh.XXXXXX")"
SSH_CONTROL_PATH="$SSH_CONTROL_DIR/control"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shanyu-acceptance.XXXXXX")"
SSH_OPTIONS=(
  -o ControlMaster=auto
  -o ControlPersist=120
  -o ControlPath="$SSH_CONTROL_PATH"
)

cleanup() {
  ssh "${SSH_OPTIONS[@]}" -O exit "$SSH_HOST" >/dev/null 2>&1 || true
  case "$SSH_CONTROL_DIR" in
    "${TMPDIR:-/tmp}"/shanyu-acceptance-ssh.*) rm -rf -- "$SSH_CONTROL_DIR" ;;
  esac
  case "$WORK_DIR" in
    "${TMPDIR:-/tmp}"/shanyu-acceptance.*) rm -rf -- "$WORK_DIR" ;;
  esac
}
trap cleanup EXIT

remote() {
  ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" "$@"
}

profile=server
case "$PUBLIC_ORIGIN" in
  http://*) profile=server-test ;;
esac

remote true
remote \
  "cd '$REMOTE_ROOT' && sudo env SHANYU_HEALTH_URL='$PUBLIC_ORIGIN/api/health' SHANYU_BACKUP_DIR='$REMOTE_ROOT/backups' bash scripts/environment-check.sh '$profile'"
echo "PASS remote server self-check"

actual_release="$(
  remote "sed -n 's/^RELEASE_VERSION=//p' '$REMOTE_ROOT/.release.env' | tail -n 1"
)"
if [ "$actual_release" != "$EXPECTED_RELEASE" ]; then
  echo "Deployed release mismatch: expected $EXPECTED_RELEASE, actual ${actual_release:-<empty>}." >&2
  exit 1
fi
echo "PASS deployed release $EXPECTED_RELEASE"

curl --fail --silent --show-error --max-time 10 \
  "$PUBLIC_ORIGIN/api/health" >/dev/null
echo "PASS public health endpoint"

umask 077
login_request="$WORK_DIR/login-request.json"
login_response="$WORK_DIR/login-response.json"
session_response="$WORK_DIR/session-response.json"
users_response="$WORK_DIR/users-response.json"
cookie_jar="$WORK_DIR/cookies.txt"
ADMIN_ACCOUNT="$ADMIN_ACCOUNT" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node -e '
    process.stdout.write(JSON.stringify({
      identifier: process.env.ADMIN_ACCOUNT,
      password: process.env.ADMIN_PASSWORD,
      rememberMe: false,
    }));
  ' >"$login_request"

curl --fail --silent --show-error --max-time 10 \
  --header 'Content-Type: application/json' \
  --cookie-jar "$cookie_jar" \
  --data-binary "@$login_request" \
  --output "$login_response" \
  "$PUBLIC_ORIGIN/api/auth/login"
curl --fail --silent --show-error --max-time 10 \
  --cookie "$cookie_jar" \
  --output "$session_response" \
  "$PUBLIC_ORIGIN/api/auth/session"
EXPECTED_ACCOUNT="$ADMIN_ACCOUNT" EXPECTED_DISPLAY_NAME="$ADMIN_DISPLAY_NAME" \
  node - "$login_response" "$session_response" <<'NODE'
const fs = require("node:fs");
for (const path of process.argv.slice(2)) {
  const payload = JSON.parse(fs.readFileSync(path, "utf8"));
  if (
    payload.user?.account !== process.env.EXPECTED_ACCOUNT ||
    payload.user?.displayName !== process.env.EXPECTED_DISPLAY_NAME ||
    payload.user?.role !== "ADMIN"
  ) {
    throw new Error(`Unexpected ADMIN response in ${path}`);
  }
}
NODE
echo "PASS ADMIN login and session"

curl --fail --silent --show-error --max-time 10 \
  --cookie "$cookie_jar" \
  --output "$users_response" \
  "$PUBLIC_ORIGIN/api/users"
if [ "$EXPECT_FRESH_ADMIN_ONLY" = "1" ]; then
  EXPECTED_ACCOUNT="$ADMIN_ACCOUNT" node - "$users_response" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  !Array.isArray(payload.users) ||
  payload.users.length !== 1 ||
  payload.users[0]?.account !== process.env.EXPECTED_ACCOUNT ||
  payload.users[0]?.role !== "ADMIN"
) {
  throw new Error("Fresh environment must contain exactly the initialized ADMIN");
}
NODE
  echo "PASS fresh environment contains only the initialized ADMIN"
else
  EXPECTED_ACCOUNT="$ADMIN_ACCOUNT" node - "$users_response" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!payload.users?.some((user) =>
  user.account === process.env.EXPECTED_ACCOUNT && user.role === "ADMIN")) {
  throw new Error("Expected active ADMIN was not returned by the users API");
}
NODE
  echo "PASS ADMIN is present in the users API"
fi

curl --fail --silent --show-error --max-time 10 \
  --request POST \
  --cookie "$cookie_jar" \
  "$PUBLIC_ORIGIN/api/auth/logout" >/dev/null
echo "PASS ADMIN logout"
echo "Deployment acceptance passed for $PUBLIC_ORIGIN ($EXPECTED_RELEASE)."
