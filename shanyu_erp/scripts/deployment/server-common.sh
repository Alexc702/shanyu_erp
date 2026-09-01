#!/usr/bin/env bash

set -Eeuo pipefail

DEPLOY_ROOT="${SHANYU_DEPLOY_ROOT:-/srv/shanyu-erp}"
COMPOSE_FILE="${SHANYU_COMPOSE_FILE:-$DEPLOY_ROOT/compose.prod.yaml}"
ENV_FILE="${SHANYU_ENV_FILE:-$DEPLOY_ROOT/.env.production}"
RELEASE_ENV_FILE="${SHANYU_RELEASE_ENV_FILE:-$DEPLOY_ROOT/.release.env}"
BACKUP_DIR="${SHANYU_BACKUP_DIR:-$DEPLOY_ROOT/backups}"
OPERATION_LOCK_FILE="${SHANYU_OPERATION_LOCK_FILE:-$DEPLOY_ROOT/.data-operation.lock}"

require_file() {
  local path="$1"
  [ -f "$path" ] || {
    echo "Required file not found: $path" >&2
    exit 1
  }
}

compose() {
  sudo docker compose \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$ENV_FILE" \
    --env-file "$RELEASE_ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

postgres_sql() {
  compose exec -T postgres sh -lc \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' \
    sh "$@"
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

deployment_environment() {
  local configured public_origin
  configured="$(env_value SHANYU_DEPLOYMENT_ENVIRONMENT)"
  if [ -z "$configured" ]; then
    public_origin="$(env_value WEB_ORIGIN)"
    case "$public_origin" in
      http://*) configured="test" ;;
      https://*) configured="production" ;;
      *)
        echo "SHANYU_DEPLOYMENT_ENVIRONMENT must be test or production." >&2
        exit 1
        ;;
    esac
  fi
  case "$configured" in
    test|production) printf '%s\n' "$configured" ;;
    *)
      echo "SHANYU_DEPLOYMENT_ENVIRONMENT must be test or production; actual value: $configured" >&2
      exit 1
      ;;
  esac
}

backup_mode() {
  local environment configured
  environment="${1:-$(deployment_environment)}"
  configured="$(env_value SHANYU_BACKUP_MODE)"
  if [ -z "$configured" ] && [ "$environment" = "test" ]; then
    configured="local"
  fi
  case "$environment:$configured" in
    test:local|production:cos) printf '%s\n' "$configured" ;;
    test:cos)
      echo "Test environment must use local backups; COS is production-only." >&2
      exit 1
      ;;
    production:local|production:)
      echo "Production environment requires SHANYU_BACKUP_MODE=cos." >&2
      exit 1
      ;;
    *)
      echo "SHANYU_BACKUP_MODE must be local or cos; actual value: ${configured:-<empty>}" >&2
      exit 1
      ;;
  esac
}

require_deployment_files() {
  require_file "$COMPOSE_FILE"
  require_file "$ENV_FILE"
  require_file "$RELEASE_ENV_FILE"
  require_file "$DEPLOY_ROOT/Caddyfile"
}

postgres_is_running() {
  local container_id
  container_id="$(compose ps -q postgres 2>/dev/null || true)"
  [ -n "$container_id" ] &&
    [ "$(sudo docker inspect -f '{{.State.Running}}' "$container_id")" = "true" ]
}

require_postgres() {
  if ! postgres_is_running; then
    echo "PostgreSQL is not running." >&2
    exit 1
  fi
}

acquire_operation_lock() {
  if [ "${SHANYU_OPERATION_LOCK_HELD:-0}" = "1" ]; then
    return
  fi
  command -v flock >/dev/null 2>&1 || {
    echo "flock is required for serialized backup and restore operations." >&2
    exit 1
  }
  install -d -m 0750 "$(dirname "$OPERATION_LOCK_FILE")"
  exec 9>"$OPERATION_LOCK_FILE"
  flock -n 9 || {
    echo "Another backup, clear, or restore operation is already running." >&2
    exit 1
  }
}

backup_canonical_path() {
  local backup_file="$1"
  local canonical_backup_dir canonical_backup
  require_file "$backup_file"
  canonical_backup_dir="$(realpath -e "$BACKUP_DIR")"
  canonical_backup="$(realpath -e "$backup_file")"
  case "$canonical_backup" in
    "$canonical_backup_dir"/*.dump) printf '%s\n' "$canonical_backup" ;;
    *)
      echo "Backup must be a .dump file inside $canonical_backup_dir: $canonical_backup" >&2
      exit 1
      ;;
  esac
}

verify_backup_file() {
  local backup_file canonical_backup expected_checksum actual_checksum
  local expected_metadata_checksum actual_metadata_checksum
  backup_file="$1"
  canonical_backup="$(backup_canonical_path "$backup_file")"
  require_file "$canonical_backup.sha256"
  test -s "$canonical_backup" || {
    echo "Backup is empty: $canonical_backup" >&2
    exit 1
  }
  expected_checksum="$(awk 'NR == 1 { print $1 }' "$canonical_backup.sha256")"
  actual_checksum="$(sha256sum "$canonical_backup" | awk '{ print $1 }')"
  if [ -z "$expected_checksum" ] || [ "$expected_checksum" != "$actual_checksum" ]; then
    echo "Backup checksum verification failed: $canonical_backup" >&2
    exit 1
  fi
  if [ -f "$canonical_backup.meta" ]; then
    expected_metadata_checksum="$(awk 'NR == 2 { print $1 }' "$canonical_backup.sha256")"
    actual_metadata_checksum="$(sha256sum "$canonical_backup.meta" | awk '{ print $1 }')"
    if [ -z "$expected_metadata_checksum" ] ||
       [ "$expected_metadata_checksum" != "$actual_metadata_checksum" ]; then
      echo "Backup metadata checksum verification failed: $canonical_backup.meta" >&2
      exit 1
    fi
  fi
  require_postgres
  compose exec -T postgres pg_restore --list <"$canonical_backup" >/dev/null
  printf '%s\n' "$canonical_backup"
}

require_tty_confirmation() {
  local prompt="$1"
  local expected="$2"
  local answer
  if [ ! -t 0 ]; then
    echo "Interactive confirmation requires a TTY; non-interactive execution is refused." >&2
    exit 1
  fi
  printf '%s\n> ' "$prompt" >/dev/tty
  IFS= read -r answer </dev/tty || exit 1
  if [ "$answer" != "$expected" ]; then
    echo "Confirmation did not match; operation cancelled." >&2
    exit 1
  fi
}

write_backup_result() {
  local result_file="${SHANYU_BACKUP_RESULT_FILE:-}"
  local backup_file="$1"
  if [ -z "$result_file" ]; then
    return
  fi
  if [ ! -f "$result_file" ] || [ -L "$result_file" ]; then
    echo "SHANYU_BACKUP_RESULT_FILE must name an existing regular temporary file." >&2
    exit 1
  fi
  printf '%s\n' "$backup_file" >"$result_file"
  chmod 600 "$result_file"
}
