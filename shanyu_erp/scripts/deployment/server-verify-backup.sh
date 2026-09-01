#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
backup_file="${1:-}"
if [ -z "$backup_file" ]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 2
fi

verified_file="$(verify_backup_file "$backup_file")"
echo "Backup verified: $verified_file"
