#!/usr/bin/env bash

set -Eeuo pipefail

DEPLOY_ROOT="${SHANYU_DEPLOY_ROOT:-/srv/shanyu-erp}"
ENV_FILE="${SHANYU_ENV_FILE:-$DEPLOY_ROOT/.env.production}"
PUBLIC_ORIGIN="${1:-}"

case "$PUBLIC_ORIGIN" in
  http://*)
    CADDY_SITE_ADDRESS=":80"
    SESSION_COOKIE_SECURE=false
    SHANYU_DEPLOYMENT_ENVIRONMENT=test
    SHANYU_BACKUP_MODE=local
    ;;
  https://*)
    CADDY_SITE_ADDRESS="${PUBLIC_ORIGIN#https://}"
    CADDY_SITE_ADDRESS="${CADDY_SITE_ADDRESS%%/*}"
    SESSION_COOKIE_SECURE=true
    SHANYU_DEPLOYMENT_ENVIRONMENT=production
    SHANYU_BACKUP_MODE=cos
    ;;
  *)
    echo "Usage: $0 <http://test-ip|https://production-domain>" >&2
    exit 2
    ;;
esac

if [ -e "$ENV_FILE" ]; then
  echo "Refusing to overwrite existing environment file: $ENV_FILE" >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required to generate deployment secrets" >&2
  exit 1
}

sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" "$DEPLOY_ROOT"
umask 077
POSTGRES_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
MINIO_ROOT_USER="minio-$(openssl rand -hex 8)"
MINIO_ROOT_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"

cat >"$ENV_FILE" <<EOF
CADDY_SITE_ADDRESS=$CADDY_SITE_ADDRESS
WEB_ORIGIN=$PUBLIC_ORIGIN
SESSION_COOKIE_SECURE=$SESSION_COOKIE_SECURE
SHANYU_DEPLOYMENT_ENVIRONMENT=$SHANYU_DEPLOYMENT_ENVIRONMENT
SHANYU_BACKUP_MODE=$SHANYU_BACKUP_MODE
SHANYU_COSCLI_PATH=/usr/local/bin/coscli
SHANYU_COS_CONFIG_PATH=/etc/shanyu-erp/cos.yaml
SHANYU_COS_BUCKET_ALIAS=shanyu-backup
SHANYU_COS_BACKUP_PREFIX=shanyu-erp/production/postgresql
CADDY_IMAGE=caddy:2-alpine
POSTGRES_IMAGE=postgres:18-alpine
POSTGRES_DB=shanyu_erp
POSTGRES_USER=shanyu
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
ADMIN_ACCOUNT=admin
ADMIN_DISPLAY_NAME=系统管理员
ADMIN_INITIAL_PASSWORD=Shanyu123!
MINIO_IMAGE=quay.io/minio/minio
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
EOF
chmod 600 "$ENV_FILE"
echo "Created $ENV_FILE with mode 600; secret values were not printed."
