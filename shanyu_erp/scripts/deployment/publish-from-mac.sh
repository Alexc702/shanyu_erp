#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_HOST="${1:-}"
PUBLIC_ORIGIN="${2:-}"
RELEASE_VERSION="${3:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}"
TARGET_PLATFORM="${SHANYU_TARGET_PLATFORM:-linux/amd64}"

if [ -z "$SSH_HOST" ] || [ -z "$PUBLIC_ORIGIN" ]; then
  echo "Usage: $0 <ssh-host> <public-origin> [release-version]" >&2
  exit 2
fi
if [[ ! "$PUBLIC_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "public origin must be an HTTP(S) origin without a path or trailing slash" >&2
  exit 2
fi
if [[ ! "$RELEASE_VERSION" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "release version may contain only letters, digits, dots, underscores, and hyphens" >&2
  exit 2
fi

SSH_CONTROL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shanyu-ssh.XXXXXX")"
SSH_CONTROL_PATH="$SSH_CONTROL_DIR/control"
SSH_OPTIONS=(
  -o ControlMaster=auto
  -o ControlPersist=120
  -o ControlPath="$SSH_CONTROL_PATH"
)

cleanup() {
  ssh "${SSH_OPTIONS[@]}" -O exit "$SSH_HOST" >/dev/null 2>&1 || true
  rmdir "$SSH_CONTROL_DIR" 2>/dev/null || true
}

remote() {
  ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" "$@"
}

trap cleanup EXIT

API_IMAGE="shanyu-erp-api:$RELEASE_VERSION"
WEB_IMAGE="shanyu-erp-web:$RELEASE_VERSION"

docker info >/dev/null
docker build --platform "$TARGET_PLATFORM" --target api -t "$API_IMAGE" "$ROOT_DIR"
docker build \
  --platform "$TARGET_PLATFORM" \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --target web \
  -t "$WEB_IMAGE" \
  "$ROOT_DIR"

remote true
remote_user="$(remote id -un)"
remote \
  "sudo install -d -m 0750 -o '$remote_user' -g '$remote_user' /srv/shanyu-erp /srv/shanyu-erp/backups"

tar -C "$ROOT_DIR" -czf - \
  Caddyfile \
  compose.prod.yaml \
  .env.production.example \
  package.json \
  pnpm-lock.yaml \
  scripts/deployment \
  scripts/environment-check.sh \
  | remote "tar -xzf - -C /srv/shanyu-erp"

remote "chmod +x /srv/shanyu-erp/scripts/deployment/*.sh"
if ! remote "test -f /srv/shanyu-erp/.env.production"; then
  remote \
    "/srv/shanyu-erp/scripts/deployment/server-initialize-env.sh '$PUBLIC_ORIGIN'"
fi

docker save "$API_IMAGE" "$WEB_IMAGE" \
  | gzip -1 \
  | remote "gzip -d | sudo docker load"

printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nRELEASE_VERSION=%s\n' \
  "$API_IMAGE" "$WEB_IMAGE" "$RELEASE_VERSION" \
  | remote \
    "umask 077; cat > /srv/shanyu-erp/.release.env"

remote "/srv/shanyu-erp/scripts/deployment/server-deploy.sh"
echo "Published $RELEASE_VERSION to $PUBLIC_ORIGIN"
