#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SHANYU_REQUIRE_RUNNING_POSTGRES=1 "$SCRIPT_DIR/server-backup.sh"
"$SCRIPT_DIR/server-prune-backups.sh"
