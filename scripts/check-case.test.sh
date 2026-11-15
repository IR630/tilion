#!/usr/bin/env bash
set -euo pipefail
check="$(cd "$(dirname "$0")" && pwd)/check-case.sh"

expect() {
  local expected=$1 input=$2 status=0 output stdout
  output=$(printf '%s' "$input" | bash "$check" --stdin 2>&1) || status=$?
  if [ "$status" -ne "$expected" ]; then
    printf 'FAIL: expected exit %s, got %s\n%s\n' "$expected" "$status" "$output" >&2
    exit 1
  fi
  if [ "$expected" -eq 0 ] && [ -n "$output" ]; then
    printf 'FAIL: clean input must produce no output\n%s\n' "$output" >&2
    exit 1
  fi
  if [ "$expected" -eq 1 ]; then
    stdout=$(printf '%s' "$input" | bash "$check" --stdin 2>/dev/null) || :
    [ -z "$stdout" ] || { echo 'FAIL: collisions must go to stderr' >&2; exit 1; }
  fi
  result=$output
}

expect 1 'web/src/countdown.ts
web/src/Countdown.tsx
web/src/Countdown.test.tsx
web/src/nested/foo.ts
web/src/nested/Foo.ts
web/src/space dir/bar.tsx
web/src/space dir/Bar.test.tsx'
for path in web/src/countdown.ts web/src/Countdown.tsx web/src/Countdown.test.tsx \
  web/src/nested/foo.ts web/src/nested/Foo.ts \
  'web/src/space dir/bar.tsx' 'web/src/space dir/Bar.test.tsx'; do
  [[ "$result" == *"  $path"* ]] || { echo "FAIL: missing $path" >&2; exit 1; }
done

expect 0 'web/src/Foo.tsx
web/src/Foo.test.tsx
web/src/bar.ts
web/src/bar.test.ts
web/src/foo.css
web/src/FOO.css
web/src/other/foo.ts
web/src/another/Foo.tsx
outside/web/src/foo.ts
outside/web/src/Foo.tsx'
expect 0 ''
echo 'check-case tests: OK'
