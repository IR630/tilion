#!/usr/bin/env bash
# Reject module names that differ only in case within web/src.
set -euo pipefail
export LC_ALL=C

case "$#:${1:-}" in
  0:) paths=$(git -c core.quotePath=false ls-files -- 'web/src/*.ts' 'web/src/*.tsx') ;;
  1:--stdin) paths=$(cat) ;;
  *) echo "Usage: bash scripts/check-case.sh [--stdin]" >&2; exit 2 ;;
esac

records=$(printf '%s\n' "$paths" | awk '
  { sub(/\r$/, "") }
  /^web\/src\/.*\.tsx?$/ {
    key = $0
    sub(/\.tsx?$/, "", key)
    sub(/\.test$/, "", key)
    printf "%s\t%s\n", key, $0
  }
')
# Deduplicate exact keys before folding: Foo.tsx and Foo.test.tsx are valid.
collisions=$(printf '%s\n' "$records" | cut -f1 | sort -u |
  tr '[:upper:]' '[:lower:]' | sort -f | uniq -di)
[ -n "$collisions" ] || exit 0

while IFS= read -r key; do
  printf 'Module names differ only in case (%s):\n' "$key" >&2
  printf '%s\n' "$records" | awk -F '\t' -v key="$key" '
    tolower($1) == key { print "  " $2 }
  ' >&2
done <<< "$collisions"
exit 1
