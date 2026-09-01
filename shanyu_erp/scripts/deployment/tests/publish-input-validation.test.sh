#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/shanyu-publish-validation-test.XXXXXX)"

cleanup() {
  case "$TEST_ROOT" in
    /tmp/shanyu-publish-validation-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin"
cat >"$TEST_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker must not run for invalid publish input" >&2
exit 99
EOF
cat >"$TEST_ROOT/bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh must not run for invalid publish input" >&2
exit 99
EOF
chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/ssh"

assert_rejected_before_external_work() {
  local expected="$1"
  shift
  local output="$TEST_ROOT/output.log"
  if PATH="$TEST_ROOT/bin:$PATH" \
    bash "$PROJECT_ROOT/scripts/deployment/publish-from-mac.sh" "$@" \
    >"$output" 2>&1; then
    echo "Invalid publish input unexpectedly passed: $*" >&2
    exit 1
  fi
  if ! grep -q "$expected" "$output"; then
    echo "Invalid publish input did not produce the expected validation error: $expected" >&2
    cat "$output" >&2
    exit 1
  fi
  if grep -q 'must not run' "$output"; then
    echo "Publish touched Docker or SSH before rejecting invalid input." >&2
    cat "$output" >&2
    exit 1
  fi
}

assert_rejected_before_external_work \
  'public origin must be an HTTP(S) origin' \
  test-host 'http://127.0.0.1/unexpected-path' valid-release
echo "PASS publish rejects a public origin with a path before external work"

assert_rejected_before_external_work \
  'release version may contain only' \
  test-host 'http://127.0.0.1' '包含 空格'
echo "PASS publish rejects an unsafe release version before external work"
