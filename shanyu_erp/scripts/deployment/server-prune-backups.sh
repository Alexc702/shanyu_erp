#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

retention_days="${SHANYU_BACKUP_RETENTION_DAYS:-30}"
case "$retention_days" in
  ''|*[!0-9]*)
    echo "SHANYU_BACKUP_RETENTION_DAYS must be a positive integer." >&2
    exit 2
    ;;
esac
if [ "$retention_days" -lt 1 ]; then
  echo "SHANYU_BACKUP_RETENTION_DAYS must be at least 1." >&2
  exit 2
fi

install -d -m 0750 "$BACKUP_DIR"
acquire_operation_lock
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'shanyu-erp-*.dump' -o -name 'shanyu-erp-*.dump.sha256' -o -name 'shanyu-erp-*.dump.meta' -o -name 'shanyu-erp-*.dump.cos' \) \
  -mtime "+$retention_days" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.pending' -mtime +1 -print -delete
echo "Backup retention completed: keeping files for $retention_days days."
