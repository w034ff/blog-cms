#!/usr/bin/env bash
# PostToolUse hook: format ONLY the file that was just edited, with prettier.
# Reads the hook JSON from stdin and extracts tool_input.file_path.
# Never blocks — always exits 0 (a formatter must not halt the agent loop).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# jq is not installed; parse the stdin JSON with node (always present in this repo).
FILE="$(node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch(e){}})')"
[ -z "$FILE" ] && exit 0

# Normalize a relative path against the project root.
case "$FILE" in
  /*) ;;
  *) FILE="$ROOT/$FILE" ;;
esac
[ -f "$FILE" ] || exit 0

# --ignore-unknown lets prettier silently skip file types it can't format.
"$ROOT/node_modules/.bin/prettier" --write --ignore-unknown "$FILE" >/dev/null 2>&1
exit 0
