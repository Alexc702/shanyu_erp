#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-remote-acceptance-test.XXXXXX)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  case "$TEST_ROOT" in
    /tmp/shanyu-remote-acceptance-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin"
cat >"$TEST_ROOT/bin/ssh" <<'EOF'
#!/usr/bin/env bash
command_text="${*: -1}"
case "$command_text" in
  *environment-check.sh*)
    printf '[PASS] Production env variables\n[PASS] Recent backup artifact\n'
    ;;
  *RELEASE_VERSION*) printf 'test-release\n' ;;
  *) ;;
esac
EOF
chmod +x "$TEST_ROOT/bin/ssh"

port="$(node -e '
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')"

node - "$port" <<'NODE' >"$TEST_ROOT/http.log" 2>&1 &
const http = require("node:http");
const port = Number(process.argv[2]);
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  account: "admin",
  displayName: "系统管理员",
  role: "ADMIN",
  status: "ACTIVE",
};
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/api/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/auth/login") {
      const credentials = JSON.parse(body);
      if (
        credentials.identifier !== "admin" ||
        credentials.password !== "Shanyu123!" ||
        credentials.rememberMe !== false
      ) {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: "invalid credentials" }));
        return;
      }
      response.setHeader("Set-Cookie", "shanyu_session=test-session; Path=/; HttpOnly");
      response.end(JSON.stringify({ user }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/auth/session") {
      response.end(JSON.stringify({ user }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/users") {
      response.end(JSON.stringify({ users: [user] }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/auth/logout") {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
});
server.listen(port, "127.0.0.1");
NODE
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl --silent --fail "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

output="$TEST_ROOT/acceptance.log"
PATH="$TEST_ROOT/bin:$PATH" \
SHANYU_ADMIN_PASSWORD='Shanyu123!' \
SHANYU_EXPECT_FRESH_ADMIN_ONLY=1 \
  bash "$PROJECT_ROOT/scripts/deployment/verify-deployment-from-mac.sh" \
    test-ssh-host "http://127.0.0.1:$port" test-release \
    >"$output" 2>&1

for expected in \
  'PASS remote server self-check' \
  'PASS deployed release test-release' \
  'PASS public health endpoint' \
  'PASS ADMIN login and session' \
  'PASS fresh environment contains only the initialized ADMIN' \
  'PASS ADMIN logout'; do
  if ! grep -q "$expected" "$output"; then
    echo "Missing remote acceptance result: $expected" >&2
    cat "$output" >&2
    exit 1
  fi
done
echo "PASS Mac-driven deployment acceptance covers the real HTTP and SSH boundaries"
