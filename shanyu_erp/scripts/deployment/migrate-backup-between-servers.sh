#!/usr/bin/env bash

set -Eeuo pipefail

source_host="${1:-}"
source_backup="${2:-}"
destination_host="${3:-}"
remote_root="${SHANYU_REMOTE_DEPLOY_ROOT:-/srv/shanyu-erp}"
if [ -z "$source_host" ] || [ -z "$source_backup" ] || [ -z "$destination_host" ]; then
  echo "Usage: $0 <source-ssh-host> <source-backup.dump> <destination-ssh-host>" >&2
  exit 2
fi
case "$source_backup" in
  /*.dump) ;;
  *)
    echo "Source backup must be an absolute .dump path." >&2
    exit 2
    ;;
esac
case "$source_backup" in
  *[!A-Za-z0-9._/-]*)
    echo "Source backup path contains unsupported characters." >&2
    exit 2
    ;;
esac
case "$remote_root" in
  /*) ;;
  *) echo "SHANYU_REMOTE_DEPLOY_ROOT must be absolute." >&2; exit 2 ;;
esac
case "$remote_root" in
  *[!A-Za-z0-9._/-]*)
    echo "SHANYU_REMOTE_DEPLOY_ROOT contains unsupported characters." >&2
    exit 2
    ;;
esac

control_dir="$(mktemp -d "${TMPDIR:-/tmp}/shanyu-migrate.XXXXXX")"
source_control="$control_dir/source"
destination_control="$control_dir/destination"
source_options=(-o ControlMaster=auto -o ControlPersist=120 -o ControlPath="$source_control")
destination_options=(-o ControlMaster=auto -o ControlPersist=120 -o ControlPath="$destination_control")
cleanup() {
  ssh "${source_options[@]}" -O exit "$source_host" >/dev/null 2>&1 || true
  ssh "${destination_options[@]}" -O exit "$destination_host" >/dev/null 2>&1 || true
  rmdir "$control_dir" 2>/dev/null || true
}
trap cleanup EXIT

source_remote() {
  ssh "${source_options[@]}" "$source_host" "$@"
}
destination_remote() {
  ssh "${destination_options[@]}" "$destination_host" "$@"
}

source_remote true
destination_remote true
source_remote "$remote_root/scripts/deployment/server-verify-backup.sh '$source_backup'"
expected_checksum="$(source_remote "awk 'NR == 1 { print \$1 }' '$source_backup.sha256'")"
if [ "${#expected_checksum}" -ne 64 ]; then
  echo "Could not read a 64-character source checksum." >&2
  exit 1
fi
case "$expected_checksum" in
  *[!0-9a-fA-F]*) echo "Source checksum is not hexadecimal." >&2; exit 1 ;;
esac
metadata_exists=0
expected_metadata_checksum=""
if source_remote "test -f '$source_backup.meta'"; then
  metadata_exists=1
  expected_metadata_checksum="$(source_remote "awk 'NR == 2 { print \$1 }' '$source_backup.sha256'")"
  if [ "${#expected_metadata_checksum}" -ne 64 ]; then
    echo "Could not read a 64-character source metadata checksum." >&2
    exit 1
  fi
  case "$expected_metadata_checksum" in
    *[!0-9a-fA-F]*) echo "Source metadata checksum is not hexadecimal." >&2; exit 1 ;;
  esac
fi

backup_name="$(basename "$source_backup")"
destination_dir="$remote_root/backups/imported"
destination_backup="$destination_dir/$backup_name"
destination_pending="$destination_backup.pending"
destination_remote "install -d -m 0750 '$destination_dir'; test ! -e '$destination_backup'; test ! -e '$destination_backup.sha256'; test ! -e '$destination_backup.meta'"

source_remote "cat '$source_backup'" |
  destination_remote "umask 077; cat > '$destination_pending'"
destination_remote "test -s '$destination_pending'; test \"\$(sha256sum '$destination_pending' | awk '{ print \$1 }')\" = '$expected_checksum'; chmod 600 '$destination_pending'"

if [ "$metadata_exists" = "1" ]; then
  source_remote "cat '$source_backup.meta'" |
    destination_remote "umask 077; cat > '$destination_backup.meta.pending'"
  destination_remote "test \"\$(sha256sum '$destination_backup.meta.pending' | awk '{ print \$1 }')\" = '$expected_metadata_checksum'; chmod 600 '$destination_backup.meta.pending'; printf '%s  %s\n%s  %s\n' '$expected_checksum' '$destination_backup' '$expected_metadata_checksum' '$destination_backup.meta' > '$destination_backup.sha256.pending'; chmod 600 '$destination_backup.sha256.pending'; mv '$destination_backup.meta.pending' '$destination_backup.meta'; mv '$destination_backup.sha256.pending' '$destination_backup.sha256'; mv '$destination_pending' '$destination_backup'"
else
  destination_remote "printf '%s  %s\n' '$expected_checksum' '$destination_backup' > '$destination_backup.sha256.pending'; chmod 600 '$destination_backup.sha256.pending'; mv '$destination_backup.sha256.pending' '$destination_backup.sha256'; mv '$destination_pending' '$destination_backup'"
fi

destination_remote "$remote_root/scripts/deployment/server-verify-backup.sh '$destination_backup'"
echo "Backup migrated and verified on destination: $destination_host:$destination_backup"
