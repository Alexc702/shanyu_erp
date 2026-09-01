#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
previous_file="$DEPLOY_ROOT/.release.previous.env"
require_file "$previous_file"

rollback_source="$DEPLOY_ROOT/.release.rollback-source.env"
cp "$RELEASE_ENV_FILE" "$rollback_source"
cp "$previous_file" "$RELEASE_ENV_FILE"
chmod 600 "$rollback_source" "$RELEASE_ENV_FILE"

compose up -d --wait --wait-timeout 180
public_origin="$(env_value WEB_ORIGIN)"
curl --fail --silent --show-error --max-time 10 \
  "$public_origin/api/health" >/dev/null
echo "Application images rolled back. Database migrations were not reversed."
