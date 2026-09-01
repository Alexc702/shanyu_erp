#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-common.sh
source "$SCRIPT_DIR/server-common.sh"

require_deployment_files
environment="$(deployment_environment)"
mode="$(backup_mode "$environment")"
if [ "$(id -u)" = "0" ]; then
  echo "Run this installer as the non-root deployment user, not root." >&2
  exit 1
fi
command -v systemctl >/dev/null 2>&1 || {
  echo "systemd is required to install the backup timer." >&2
  exit 1
}
sudo -n true >/dev/null 2>&1 || {
  echo "The deployment user needs non-interactive sudo before installing the timer." >&2
  exit 1
}

deploy_user="$(id -un)"
deploy_group="$(id -gn)"
service_file="/etc/systemd/system/shanyu-erp-backup.service"
timer_file="/etc/systemd/system/shanyu-erp-backup.timer"
service_pending="$(mktemp)"
timer_pending="$(mktemp)"
cleanup() {
  rm -f "$service_pending" "$timer_pending"
}
trap cleanup EXIT

cat >"$service_pending" <<EOF
[Unit]
Description=Shanyu ERP verified PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=$deploy_user
Group=$deploy_group
WorkingDirectory=$DEPLOY_ROOT
Environment=SHANYU_BACKUP_RETENTION_DAYS=30
ExecStart=$DEPLOY_ROOT/scripts/deployment/server-scheduled-backup.sh
EOF

cat >"$timer_pending" <<'EOF'
[Unit]
Description=Run Shanyu ERP backup daily at 02:30

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=5m
Unit=shanyu-erp-backup.service

[Install]
WantedBy=timers.target
EOF

sudo install -m 0644 "$service_pending" "$service_file"
sudo install -m 0644 "$timer_pending" "$timer_file"
sudo systemctl daemon-reload
sudo systemctl enable --now shanyu-erp-backup.timer
sudo systemctl --no-pager status shanyu-erp-backup.timer
echo "Installed backup timer for environment=$environment, mode=$mode."
