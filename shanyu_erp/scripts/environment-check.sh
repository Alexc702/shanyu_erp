#!/usr/bin/env bash

set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-local}"
EXPECTED_NODE_VERSION="v24.20.0"
EXPECTED_PNPM_VERSION="10.29.2"
START_DEV_AFTER_CHECK=0

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
CHECK_INDEX=0
RESULT_STATUSES=()
RESULT_LABELS=()
API_PID=""
WEB_PID=""
API_LAUNCHER_PID=""
WEB_LAUNCHER_PID=""

RUN_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shanyu-env-check.XXXXXX")" || {
  echo "Unable to create the self-check log directory." >&2
  exit 1
}

terminate_process() {
  local pid="$1"
  local attempts=0

  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 0
  kill "$pid" 2>/dev/null || return 1

  while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do
    sleep 0.1
    attempts=$((attempts + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || return 1
  fi
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" 2>/dev/null
}

cleanup() {
  local pid
  local pid_file

  for pid_file in \
    "$RUN_LOG_DIR/web.pid" \
    "$RUN_LOG_DIR/api.pid" \
    "$RUN_LOG_DIR/web-launcher.pid" \
    "$RUN_LOG_DIR/api-launcher.pid"; do
    if [ -f "$pid_file" ]; then
      pid="$(<"$pid_file")"
      terminate_process "$pid" || true
    fi
  done
  for pid in "$WEB_PID" "$API_PID" "$WEB_LAUNCHER_PID" "$API_LAUNCHER_PID"; do
    terminate_process "$pid" || true
  done

  case "$RUN_LOG_DIR" in
    "${TMPDIR:-/tmp}"/shanyu-env-check.*)
      rm -R -- "$RUN_LOG_DIR"
      ;;
  esac
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

record_result() {
  local status="$1"
  local label="$2"

  RESULT_STATUSES+=("$status")
  RESULT_LABELS+=("$label")

  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

run_check() {
  local label="$1"
  local log_file
  local result
  shift

  CHECK_INDEX=$((CHECK_INDEX + 1))
  log_file="$RUN_LOG_DIR/check-${CHECK_INDEX}.log"
  printf '\n[RUN ] %s\n' "$label"

  "$@" >"$log_file" 2>&1
  result=$?

  if [ -s "$log_file" ]; then
    sed 's/^/      /' "$log_file"
  fi

  if [ "$result" -eq 0 ]; then
    printf '[PASS] %s\n' "$label"
    record_result PASS "$label"
  else
    printf '[FAIL] %s\n' "$label"
    record_result FAIL "$label"
  fi

  return "$result"
}

skip_check() {
  local label="$1"
  local reason="$2"

  printf '\n[SKIP] %s -- %s\n' "$label" "$reason"
  record_result SKIP "$label"
}

activate_local_toolchain() {
  local volta_dir="${VOLTA_HOME:-${HOME:-}/.volta}"

  if [ -x "$volta_dir/bin/volta" ]; then
    export VOLTA_HOME="$volta_dir"
    export PATH="$VOLTA_HOME/bin:$PATH"
    hash -r
    echo "Using the local Volta toolchain from $VOLTA_HOME."
  fi
}

check_repo_root() {
  [ -f "$ROOT_DIR/package.json" ] || {
    echo "package.json not found at $ROOT_DIR"
    return 1
  }
  [ -f "$ROOT_DIR/pnpm-lock.yaml" ] || {
    echo "pnpm-lock.yaml not found at $ROOT_DIR"
    return 1
  }
  echo "Repository: $ROOT_DIR"
}

check_node_version() {
  local actual
  command -v node >/dev/null 2>&1 || {
    echo "node is not available on PATH"
    return 1
  }
  actual="$(node -v)"
  echo "Expected: $EXPECTED_NODE_VERSION"
  echo "Actual:   $actual"
  [ "$actual" = "$EXPECTED_NODE_VERSION" ]
}

check_pnpm_version() {
  local actual
  command -v pnpm >/dev/null 2>&1 || {
    echo "pnpm is not available on PATH"
    return 1
  }
  actual="$(pnpm -v)"
  echo "Expected: $EXPECTED_PNPM_VERSION"
  echo "Actual:   $actual"
  [ "$actual" = "$EXPECTED_PNPM_VERSION" ]
}

check_local_env_file() {
  local env_file="$ROOT_DIR/.env"
  local key
  local missing=0
  local required_keys=(
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    MINIO_ROOT_USER
    MINIO_ROOT_PASSWORD
  )

  [ -f "$env_file" ] || {
    echo ".env is missing; create it from .env.example"
    return 1
  }

  for key in "${required_keys[@]}"; do
    if ! grep -Eq "^[[:space:]]*${key}=.+$" "$env_file"; then
      echo "Missing or empty variable: $key"
      missing=1
    fi
  done

  if [ "$missing" -eq 0 ]; then
    echo "All required variable names are present; values were not printed."
  fi
  return "$missing"
}

check_dependencies() {
  [ -d "$ROOT_DIR/node_modules/.pnpm" ] || {
    echo "node_modules is missing; run pnpm install --frozen-lockfile"
    return 1
  }
  pnpm list -r --depth -1 >/dev/null
  echo "Workspace dependency tree is readable."
}

check_docker_client() {
  command -v docker >/dev/null 2>&1 || {
    echo "docker is not available on PATH"
    return 1
  }
  docker --version
  docker compose version
}

check_docker_daemon() {
  docker info --format 'Docker server: {{.ServerVersion}}'
}

check_local_compose_config() {
  local services
  docker compose config --quiet || return 1
  services="$(docker compose config --services)" || return 1
  echo "$services"
  echo "$services" | grep -qx postgres || return 1
  echo "$services" | grep -qx minio || return 1
}

check_container_healthy() {
  local service="$1"
  local container_id
  local state
  local health

  container_id="$(docker compose ps -q "$service")" || return 1
  [ -n "$container_id" ] || {
    echo "$service container is not running"
    return 1
  }

  state="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")" || return 1
  echo "Service: $service"
  echo "State:   $state"
  echo "Health:  $health"
  [ "$state" = "running" ] && [ "$health" = "healthy" ]
}

check_local_binding() {
  local service="$1"
  local container_port="$2"
  local expected="$3"
  local actual

  actual="$(docker compose port "$service" "$container_port")" || return 1
  echo "Expected: $expected"
  echo "Actual:   $actual"
  [ "$actual" = "$expected" ]
}

check_postgres() {
  docker compose exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT 1"' | grep -qx 1
}

check_minio() {
  curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:9000/minio/health/live >/dev/null
  echo "MinIO live endpoint returned HTTP 2xx."
}

start_local_infrastructure() {
  docker compose up -d --wait --wait-timeout 90
}

check_ports_free() {
  local port
  local busy=0

  command -v lsof >/dev/null 2>&1 || {
    echo "lsof is required to verify that ports 3000 and 3001 are free"
    return 1
  }

  for port in 3000 3001; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $port is already in use. Stop pnpm dev or use the local-runtime profile."
      busy=1
    else
      echo "Port $port is free."
    fi
  done
  return "$busy"
}

wait_for_url() {
  local url="$1"
  local process_id="$2"
  local attempts=0

  while [ "$attempts" -lt 30 ]; do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$process_id" 2>/dev/null; then
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

listening_pid() {
  local port="$1"

  lsof -nP -t -iTCP:"$port" -sTCP:LISTEN | sed -n '1p'
}

start_local_apps() {
  local api_log="$RUN_LOG_DIR/api-runtime.log"
  local web_log="$RUN_LOG_DIR/web-runtime.log"

  PORT=3001 WEB_ORIGIN=http://localhost:3000 \
    node "$ROOT_DIR/apps/api/dist/main.js" >"$api_log" 2>&1 &
  API_LAUNCHER_PID=$!
  printf '%s\n' "$API_LAUNCHER_PID" >"$RUN_LOG_DIR/api-launcher.pid"

  (
    cd "$ROOT_DIR/apps/web" || exit 1
    exec ./node_modules/.bin/next start -H 127.0.0.1 -p 3000
  ) >"$web_log" 2>&1 &
  WEB_LAUNCHER_PID=$!
  printf '%s\n' "$WEB_LAUNCHER_PID" >"$RUN_LOG_DIR/web-launcher.pid"

  if ! wait_for_url http://127.0.0.1:3001/health "$API_LAUNCHER_PID"; then
    echo "API did not become ready."
    sed 's/^/API: /' "$api_log"
    return 1
  fi
  if ! wait_for_url http://127.0.0.1:3000 "$WEB_LAUNCHER_PID"; then
    echo "Web did not become ready."
    sed 's/^/WEB: /' "$web_log"
    return 1
  fi

  API_PID="$(listening_pid 3001)" || return 1
  WEB_PID="$(listening_pid 3000)" || return 1
  [ -n "$API_PID" ] && [ -n "$WEB_PID" ] || {
    echo "Unable to identify the temporary listening processes."
    return 1
  }
  printf '%s\n' "$API_PID" >"$RUN_LOG_DIR/api.pid"
  printf '%s\n' "$WEB_PID" >"$RUN_LOG_DIR/web.pid"

  echo "Temporary API and Web processes are ready on ports 3001 and 3000."
}

check_api_health() {
  local response
  response="$(curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:3001/health)" || return 1
  echo "$response"
  echo "$response" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
}

check_web_health() {
  local status
  status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 5 http://127.0.0.1:3000)" || return 1
  echo "HTTP status: $status"
  case "$status" in
    2??|3??) return 0 ;;
    *) return 1 ;;
  esac
}

stop_local_apps() {
  local pid
  local pid_file

  for pid_file in \
    "$RUN_LOG_DIR/web.pid" \
    "$RUN_LOG_DIR/api.pid" \
    "$RUN_LOG_DIR/web-launcher.pid" \
    "$RUN_LOG_DIR/api-launcher.pid"; do
    if [ -f "$pid_file" ]; then
      pid="$(<"$pid_file")"
      terminate_process "$pid" || return 1
      rm -f -- "$pid_file"
    fi
  done
  WEB_PID=""
  API_PID=""
  WEB_LAUNCHER_PID=""
  API_LAUNCHER_PID=""
  check_ports_free || return 1
  echo "Temporary API and Web processes stopped."
}

server_compose() {
  docker compose \
    --project-directory "$ROOT_DIR" \
    --env-file "$SERVER_ENV_FILE" \
    --env-file "$SERVER_RELEASE_ENV_FILE" \
    -f "$SERVER_COMPOSE_FILE" \
    "$@"
}

check_linux_server() {
  local actual
  actual="$(uname -s)"
  echo "Expected: Linux"
  echo "Actual:   $actual"
  [ "$actual" = "Linux" ]
}

check_server_files() {
  [ -f "$SERVER_COMPOSE_FILE" ] || {
    echo "Production Compose file is missing: $SERVER_COMPOSE_FILE"
    return 1
  }
  [ -f "$SERVER_ENV_FILE" ] || {
    echo "Production environment file is missing: $SERVER_ENV_FILE"
    return 1
  }
  [ -f "$SERVER_RELEASE_ENV_FILE" ] || {
    echo "Release environment file is missing: $SERVER_RELEASE_ENV_FILE"
    return 1
  }
  echo "Compose: $SERVER_COMPOSE_FILE"
  echo "Env:     $SERVER_ENV_FILE (values not printed)"
  echo "Release: $SERVER_RELEASE_ENV_FILE (values not printed)"
}

check_server_env_permissions() {
  local mode
  mode="$(stat -c '%a' "$SERVER_ENV_FILE")" || return 1
  echo "Expected permissions: 600 or 640"
  echo "Actual permissions:   $mode"
  [ "$mode" = "600" ] || [ "$mode" = "640" ]
}

check_server_env_variables() {
  local key
  local missing=0
  local required_keys=(
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    ADMIN_ACCOUNT
    ADMIN_DISPLAY_NAME
    ADMIN_INITIAL_PASSWORD
    MINIO_ROOT_USER
    MINIO_ROOT_PASSWORD
  )

  for key in "${required_keys[@]}"; do
    if ! grep -Eq "^[[:space:]]*${key}=.+$" "$SERVER_ENV_FILE"; then
      echo "Missing or empty variable: $key"
      missing=1
    fi
  done

  if [ "$missing" -eq 0 ]; then
    echo "All base production variable names are present; values were not printed."
  fi
  return "$missing"
}

check_server_compose_config() {
  local services
  local service
  local proxy_found=0

  server_compose config --quiet || return 1
  services="$(server_compose config --services)" || return 1
  echo "$services"

  for service in web api postgres; do
    echo "$services" | grep -qx "$service" || {
      echo "Required service is missing: $service"
      return 1
    }
  done

  if [ "$SERVER_REQUIRE_MINIO" -eq 1 ]; then
    echo "$services" | grep -qx minio || {
      echo "Required service is missing: minio"
      return 1
    }
  fi

  for service in proxy reverse-proxy caddy nginx traefik; do
    if echo "$services" | grep -qx "$service"; then
      proxy_found=1
    fi
  done
  [ "$proxy_found" -eq 1 ] || {
    echo "A reverse-proxy service is required."
    return 1
  }
}

check_server_containers() {
  local services
  local service
  local container_id
  local state
  local health
  local failed=0

  services="$(server_compose config --services)" || return 1
  for service in $services; do
    container_id="$(server_compose ps -q "$service")" || return 1
    if [ -z "$container_id" ]; then
      echo "$service: not running"
      failed=1
      continue
    fi
    for container_id in $container_id; do
      state="$(docker inspect --format '{{.State.Status}}' "$container_id")" || return 1
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$container_id")" || return 1
      echo "$service: state=$state health=$health"
      if [ "$state" != "running" ] || [ "$health" != "healthy" ]; then
        failed=1
      fi
    done
  done
  return "$failed"
}

check_server_container_policies() {
  local services
  local service
  local container_id
  local restart_policy
  local log_driver
  local log_max_size
  local failed=0

  services="$(server_compose config --services)" || return 1
  for service in $services; do
    container_id="$(server_compose ps -q "$service")" || return 1
    if [ -z "$container_id" ]; then
      echo "$service: no running container available for policy inspection"
      failed=1
      continue
    fi
    for container_id in $container_id; do
      restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container_id")" || return 1
      log_driver="$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$container_id")" || return 1
      log_max_size="$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$container_id")" || return 1
      echo "$service: restart=$restart_policy log-driver=$log_driver log-max-size=${log_max_size:-not-configured}"

      case "$restart_policy" in
        always|unless-stopped|on-failure) ;;
        *) failed=1 ;;
      esac

      if [ "$log_driver" != "local" ] && [ -z "$log_max_size" ]; then
        failed=1
      fi
    done
  done
  return "$failed"
}

check_server_private_port() {
  local service="$1"
  local port="$2"
  local binding
  local container_id
  local container_ids

  container_ids="$(server_compose ps -q "$service")" || return 1
  [ -n "$container_ids" ] || {
    echo "$service has no running container available for port inspection."
    return 1
  }
  for container_id in $container_ids; do
    binding="$(
      docker inspect \
        --format "{{with index .HostConfig.PortBindings \"${port}/tcp\"}}{{json .}}{{end}}" \
        "$container_id"
    )" || return 1
    if [ -n "$binding" ]; then
      echo "$service:$port has a host binding; it must remain on the internal Compose network."
      return 1
    fi
  done
  echo "$service:$port is not published to the host."
}

check_server_postgres() {
  server_compose exec -T postgres sh -lc \
    'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

check_server_minio() {
  server_compose exec -T minio curl --fail --silent --show-error \
    --max-time 5 http://localhost:9000/minio/health/live >/dev/null
  echo "MinIO live endpoint returned HTTP 2xx inside the container."
}

check_server_public_health() {
  [ -n "${SHANYU_HEALTH_URL:-}" ] || {
    echo "Set SHANYU_HEALTH_URL to the public HTTPS API health URL."
    return 1
  }
  if [ "$SERVER_REQUIRE_HTTPS" -eq 1 ]; then
    case "$SHANYU_HEALTH_URL" in
      https://*) ;;
      *)
        echo "SHANYU_HEALTH_URL must use HTTPS."
        return 1
        ;;
    esac
  fi
  curl --fail --silent --show-error --max-time 10 \
    "$SHANYU_HEALTH_URL" >/dev/null || return 1
  echo "$SHANYU_HEALTH_URL returned HTTP 2xx."
}

check_server_disk() {
  local usage
  usage="$(df -Pk "$ROOT_DIR" | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')" || return 1
  echo "Filesystem usage: ${usage}%"
  [ -n "$usage" ] && [ "$usage" -lt 90 ]
}

check_server_backup() {
  local max_hours="${SHANYU_BACKUP_MAX_AGE_HOURS:-26}"
  local max_minutes
  local candidate
  local environment
  local recent_file

  [ -n "${SHANYU_BACKUP_DIR:-}" ] || {
    echo "Set SHANYU_BACKUP_DIR to the directory containing off-host backup artifacts or sync markers."
    return 1
  }
  [ -d "$SHANYU_BACKUP_DIR" ] || {
    echo "Backup directory not found: $SHANYU_BACKUP_DIR"
    return 1
  }
  case "$max_hours" in
    ''|*[!0-9]*)
      echo "SHANYU_BACKUP_MAX_AGE_HOURS must be an integer."
      return 1
      ;;
  esac

  max_minutes=$((max_hours * 60))
  environment="$(sed -n 's/^SHANYU_DEPLOYMENT_ENVIRONMENT=//p' "$SERVER_ENV_FILE" | tail -n 1)"
  recent_file=""
  while IFS= read -r candidate; do
    if [ ! -s "$candidate" ] || [ ! -s "$candidate.meta" ] || [ ! -s "$candidate.sha256" ]; then
      continue
    fi
    if [ "$environment" = "production" ] && [ ! -s "$candidate.cos" ]; then
      continue
    fi
    recent_file="$candidate"
    break
  done < <(
    find "$SHANYU_BACKUP_DIR" -maxdepth 1 -type f \
      -name 'shanyu-erp-*.dump' -mmin "-$max_minutes" -print
  )
  [ -n "$recent_file" ] || {
    if [ "$environment" = "production" ]; then
      echo "No complete COS-verified backup newer than $max_hours hours was found."
    else
      echo "No complete local backup newer than $max_hours hours was found."
    fi
    return 1
  }
  echo "A complete backup newer than $max_hours hours exists; file name is intentionally not printed."
}

print_summary() {
  local index=0

  printf '\n================ Environment self-check summary ================\n'
  while [ "$index" -lt "${#RESULT_LABELS[@]}" ]; do
    printf '%-6s %s\n' "[${RESULT_STATUSES[$index]}]" "${RESULT_LABELS[$index]}"
    index=$((index + 1))
  done
  printf '%s\n' '------------------------------------------------------------------'
  printf 'PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
}

run_common_local_checks() {
  local docker_ready=0
  local infra_ready=1

  run_check "Repository structure" check_repo_root || true
  run_check "Node.js $EXPECTED_NODE_VERSION" check_node_version || true
  run_check "pnpm $EXPECTED_PNPM_VERSION" check_pnpm_version || true
  run_check "Local .env variables" check_local_env_file || true
  run_check "Workspace dependencies" check_dependencies || true
  run_check "Docker and Compose clients" check_docker_client || true

  if run_check "Docker daemon" check_docker_daemon; then
    docker_ready=1
  fi

  if [ "$docker_ready" -eq 1 ]; then
    run_check "Local Compose configuration" check_local_compose_config || infra_ready=0
    run_check "PostgreSQL container health" check_container_healthy postgres || infra_ready=0
    run_check "MinIO container health" check_container_healthy minio || infra_ready=0
    run_check "PostgreSQL localhost binding" check_local_binding postgres 5432 127.0.0.1:5432 || infra_ready=0
    run_check "MinIO API localhost binding" check_local_binding minio 9000 127.0.0.1:9000 || infra_ready=0
    run_check "MinIO Console localhost binding" check_local_binding minio 9001 127.0.0.1:9001 || infra_ready=0
    run_check "PostgreSQL readiness and query" check_postgres || infra_ready=0
    run_check "MinIO live endpoint" check_minio || infra_ready=0
  else
    infra_ready=0
    skip_check "Local Compose configuration" "Docker daemon unavailable"
    skip_check "PostgreSQL container health" "Docker daemon unavailable"
    skip_check "MinIO container health" "Docker daemon unavailable"
    skip_check "Localhost infrastructure bindings" "Docker daemon unavailable"
    skip_check "PostgreSQL readiness and query" "Docker daemon unavailable"
    skip_check "MinIO live endpoint" "Docker daemon unavailable"
  fi

  LOCAL_INFRA_READY="$infra_ready"
}

run_local_full() {
  local ports_ready=0
  local build_ready=0
  local apps_ready=0

  run_common_local_checks

  if run_check "Ports 3000 and 3001 available" check_ports_free; then
    ports_ready=1
  fi

  run_check "Lint" pnpm lint || true
  run_check "TypeScript typecheck" pnpm typecheck || true
  run_check "Tests" pnpm test || true
  if run_check "Production build" pnpm build; then
    build_ready=1
  fi

  if [ "$LOCAL_INFRA_READY" -eq 1 ] && [ "$ports_ready" -eq 1 ] && [ "$build_ready" -eq 1 ]; then
    if run_check "Start temporary API and Web" start_local_apps; then
      apps_ready=1
    fi
  else
    skip_check "Start temporary API and Web" "requires healthy infrastructure, free ports, and a successful build"
  fi

  if [ "$apps_ready" -eq 1 ]; then
    run_check "API /health endpoint" check_api_health || true
    run_check "Web root endpoint" check_web_health || true
    run_check "Stop temporary API and Web" stop_local_apps || true
  else
    skip_check "API /health endpoint" "temporary applications were not started"
    skip_check "Web root endpoint" "temporary applications were not started"
  fi
}

run_local_resume() {
  local infra_started=0

  if run_check "Start local PostgreSQL and MinIO" start_local_infrastructure; then
    infra_started=1
  fi

  if [ "$infra_started" -eq 1 ]; then
    run_check "Apply local database migrations" pnpm db:migrate || true
  else
    skip_check "Apply local database migrations" "local infrastructure did not start"
  fi

  run_local_full
}

run_local_runtime() {
  run_common_local_checks
  run_check "Running API /health endpoint" check_api_health || true
  run_check "Running Web root endpoint" check_web_health || true
  skip_check "Lint, typecheck, tests, and build" "runtime-only profile selected"
}

run_server() {
  local server_files_ready=0
  local server_compose_ready=0

  SERVER_COMPOSE_FILE="${SHANYU_COMPOSE_FILE:-$ROOT_DIR/compose.prod.yaml}"
  SERVER_ENV_FILE="${SHANYU_ENV_FILE:-$ROOT_DIR/.env.production}"
  SERVER_RELEASE_ENV_FILE="${SHANYU_RELEASE_ENV_FILE:-$ROOT_DIR/.release.env}"

  run_check "Repository structure" check_repo_root || true
  run_check "Linux production VM" check_linux_server || true
  run_check "Docker and Compose clients" check_docker_client || true
  run_check "Docker daemon" check_docker_daemon || true
  run_check "Production disk usage below 90%" check_server_disk || true

  if run_check "Production Compose and env files" check_server_files; then
    server_files_ready=1
  fi

  if [ "$server_files_ready" -eq 1 ]; then
    run_check "Production env file permissions" check_server_env_permissions || true
    run_check "Production env variables" check_server_env_variables || true
    if run_check "Production Compose configuration" check_server_compose_config; then
      server_compose_ready=1
    fi
  else
    skip_check "Production env file permissions" "production files unavailable"
    skip_check "Production env variables" "production files unavailable"
    skip_check "Production Compose configuration" "production files unavailable"
  fi

  if [ "$server_compose_ready" -eq 1 ]; then
    run_check "Production container states" check_server_containers || true
    run_check "Restart and log-rotation policies" check_server_container_policies || true
    run_check "Web is private" check_server_private_port web 3000 || true
    run_check "API is private" check_server_private_port api 3001 || true
    run_check "PostgreSQL is private" check_server_private_port postgres 5432 || true
    run_check "Production PostgreSQL readiness" check_server_postgres || true
    if [ "$SERVER_REQUIRE_MINIO" -eq 1 ]; then
      run_check "MinIO API is private" check_server_private_port minio 9000 || true
      run_check "MinIO Console is private" check_server_private_port minio 9001 || true
      run_check "Production MinIO live endpoint" check_server_minio || true
    else
      skip_check "Production MinIO checks" "object storage is disabled for the constrained test server"
    fi
  else
    skip_check "Production container states" "valid production Compose configuration unavailable"
    skip_check "Restart and log-rotation policies" "valid production Compose configuration unavailable"
    skip_check "Private application, database, and object-storage ports" "valid production Compose configuration unavailable"
    skip_check "Production PostgreSQL readiness" "valid production Compose configuration unavailable"
    skip_check "Production MinIO live endpoint" "valid production Compose configuration unavailable"
  fi

  run_check "Public health endpoint" check_server_public_health || true
  run_check "Recent backup artifact" check_server_backup || true
}

cd "$ROOT_DIR" || exit 1

case "$PROFILE" in
  local|local-runtime|resume) activate_local_toolchain ;;
esac

case "$PROFILE" in
  resume)
    echo "Shanyu ERP environment self-check: resume local development"
    run_local_resume
    START_DEV_AFTER_CHECK=1
    ;;
  local)
    echo "Shanyu ERP environment self-check: local full profile"
    run_local_full
    ;;
  local-runtime)
    echo "Shanyu ERP environment self-check: local runtime profile"
    run_local_runtime
    ;;
  server)
    echo "Shanyu ERP environment self-check: production server profile"
    SERVER_REQUIRE_MINIO=1
    SERVER_REQUIRE_HTTPS=1
    run_server
    ;;
  server-test)
    echo "Shanyu ERP environment self-check: constrained test server profile"
    SERVER_REQUIRE_MINIO=0
    SERVER_REQUIRE_HTTPS=0
    run_server
    ;;
  *)
    echo "Usage: bash scripts/environment-check.sh [resume|local|local-runtime|server|server-test]" >&2
    exit 2
    ;;
esac

print_summary

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

if [ "$START_DEV_AFTER_CHECK" -eq 1 ]; then
  printf '\nEnvironment is ready. Starting pnpm dev; press Ctrl+C to stop Web and API.\n\n'
  cleanup
  trap - EXIT INT TERM
  exec pnpm dev
fi

exit 0
