#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
environment="$(deployment_environment)"
mode="$(backup_mode "$environment")"
if [ "$environment" != "production" ] || [ "$mode" != "cos" ]; then
  echo "COS backup is available only when production uses SHANYU_BACKUP_MODE=cos." >&2
  exit 1
fi

backup_file="${1:-}"
if [ -z "$backup_file" ]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 2
fi

acquire_operation_lock
backup_file="$(backup_canonical_path "$backup_file")"
require_file "$backup_file.meta"
require_file "$backup_file.sha256"
backup_file="$(verify_backup_file "$backup_file")"
backup_name="$(basename "$backup_file")"
if [[ ! "$backup_name" =~ ^shanyu-erp-([0-9]{4})([0-9]{2})[0-9]{2}T[0-9]{6}-[0-9]+Z\.dump$ ]]; then
  echo "Backup filename does not contain the expected UTC timestamp: $backup_name" >&2
  exit 1
fi
backup_year="${BASH_REMATCH[1]}"
backup_month="${BASH_REMATCH[2]}"
backup_id="${backup_name%.dump}"

coscli_bin="$(env_value SHANYU_COSCLI_PATH)"
coscli_bin="${coscli_bin:-/usr/local/bin/coscli}"
cos_config="$(env_value SHANYU_COS_CONFIG_PATH)"
cos_config="${cos_config:-/etc/shanyu-erp/cos.yaml}"
cos_alias="$(env_value SHANYU_COS_BUCKET_ALIAS)"
cos_alias="${cos_alias:-shanyu-backup}"
cos_prefix="$(env_value SHANYU_COS_BACKUP_PREFIX)"
cos_prefix="${cos_prefix:-shanyu-erp/production/postgresql}"

case "$cos_alias" in
  ''|*[!A-Za-z0-9._-]*)
    echo "SHANYU_COS_BUCKET_ALIAS contains unsupported characters." >&2
    exit 1
    ;;
esac
case "$cos_prefix" in
  ''|/*|*/|*..*|*[!A-Za-z0-9._/-]*)
    echo "SHANYU_COS_BACKUP_PREFIX must be a safe relative object prefix." >&2
    exit 1
    ;;
esac

sudo -n test -x "$coscli_bin" || {
  echo "COSCLI is not executable: $coscli_bin" >&2
  exit 1
}
sudo -n test -r "$cos_config" || {
  echo "COSCLI configuration is not readable by root: $cos_config" >&2
  exit 1
}
config_identity="$(sudo -n stat -c '%U:%G %a' "$cos_config")"
if [ "$config_identity" != "root:root 600" ]; then
  echo "$cos_config must be owned by root:root with mode 600; actual: $config_identity" >&2
  exit 1
fi

remote_base="cos://$cos_alias/$cos_prefix/$backup_year/$backup_month/$backup_id"
marker_file="$backup_file.cos"
marker_pending="$marker_file.pending"
if [ -e "$marker_file" ]; then
  echo "COS success marker already exists; refusing to overwrite this backup ID: $marker_file" >&2
  exit 1
fi
readback_dir="$(mktemp -d "$BACKUP_DIR/.cos-readback.XXXXXX")"

cleanup() {
  rm -f -- "$marker_pending"
  case "$readback_dir" in
    "$BACKUP_DIR"/.cos-readback.*) rm -rf -- "$readback_dir" ;;
  esac
}
trap cleanup EXIT

run_coscli() {
  sudo -n "$coscli_bin" "$@" -c "$cos_config"
}

run_coscli cp "$backup_file" "$remote_base/$backup_name"
run_coscli cp "$backup_file.meta" "$remote_base/$backup_name.meta"
run_coscli cp "$backup_file.sha256" "$remote_base/$backup_name.sha256"

run_coscli stat "$remote_base/$backup_name"
run_coscli stat "$remote_base/$backup_name.meta"
run_coscli stat "$remote_base/$backup_name.sha256"

readback_backup="$readback_dir/$backup_name"
run_coscli cp "$remote_base/$backup_name" "$readback_backup"
run_coscli cp "$remote_base/$backup_name.meta" "$readback_backup.meta"
run_coscli cp "$remote_base/$backup_name.sha256" "$readback_backup.sha256"
sudo -n chown "$(id -u):$(id -g)" \
  "$readback_backup" "$readback_backup.meta" "$readback_backup.sha256"
chmod 600 "$readback_backup" "$readback_backup.meta" "$readback_backup.sha256"
verify_backup_file "$readback_backup" >/dev/null

umask 077
{
  printf 'format=shanyu-cos-backup-v1\n'
  printf 'environment=production\n'
  printf 'verified_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'remote_uri=%s\n' "$remote_base/$backup_name"
} >"$marker_pending"
mv "$marker_pending" "$marker_file"
chmod 600 "$marker_file"

trap - EXIT
cleanup
echo "COS backup uploaded and read-back verified: $remote_base/$backup_name"
