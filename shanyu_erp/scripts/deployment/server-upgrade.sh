#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

new_api_image="${1:-}"
new_web_image="${2:-}"
release_version="${3:-}"
if [ -z "$new_api_image" ] || [ -z "$new_web_image" ] || [ -z "$release_version" ]; then
  echo "Usage: $0 <api-image> <web-image> <release-version>" >&2
  exit 2
fi

require_deployment_files
previous_file="$DEPLOY_ROOT/.release.previous.env"
cp "$RELEASE_ENV_FILE" "$previous_file"
chmod 600 "$previous_file"

temporary_file="$DEPLOY_ROOT/.release.env.pending"
umask 077
cat >"$temporary_file" <<EOF
API_IMAGE=$new_api_image
WEB_IMAGE=$new_web_image
RELEASE_VERSION=$release_version
EOF
mv "$temporary_file" "$RELEASE_ENV_FILE"
chmod 600 "$RELEASE_ENV_FILE"

if ! "$SCRIPT_DIR/server-deploy.sh"; then
  echo "Upgrade failed; restoring the previous image selection." >&2
  cp "$previous_file" "$RELEASE_ENV_FILE"
  compose up -d --wait --wait-timeout 180
  exit 1
fi
echo "Upgrade completed: $release_version"
