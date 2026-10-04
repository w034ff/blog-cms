#!/usr/bin/env bash
# Stop hook: run vitest and eslint when the tree is dirty, and hand a failure
# back to Claude (decision "block") so it fixes it instead of stopping.
# A second failure in the same stop cycle (stop_hook_active) only warns the
# user, so a check Claude cannot fix never loops.

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0
[ -z "$(git status --porcelain)" ] && exit 0

# jq is not installed; parse the stdin JSON with node (always present in this repo).
read -r SESSION ACTIVE < <(node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let j={};try{j=JSON.parse(s)}catch(e){}process.stdout.write(`${j.session_id||"nosession"} ${j.stop_hook_active===true}`)})')

# Per-session logs, so concurrent sessions and worktrees do not overwrite each other.
LOG_DIR="${TMPDIR:-/tmp}/claude-stop-checks/$SESSION"
mkdir -p "$LOG_DIR"

FAILED=()
npm run test:run >"$LOG_DIR/vitest.log" 2>&1 || FAILED+=("vitest (npm run test:run, log: $LOG_DIR/vitest.log)")
npm run lint >"$LOG_DIR/eslint.log" 2>&1 || FAILED+=("eslint (npm run lint, log: $LOG_DIR/eslint.log)")
[ ${#FAILED[@]} -eq 0 ] && exit 0

MSG="Stop checks failed: $(IFS=';'; echo "${FAILED[*]}")"
if [ "$ACTIVE" = "true" ]; then
  node -e 'process.stdout.write(JSON.stringify({systemMessage:"⚠️ "+process.argv[1]}))' "$MSG"
else
  node -e 'process.stdout.write(JSON.stringify({decision:"block",reason:process.argv[1]+". Read the log, fix what this session caused, and report anything that predates it instead of fixing it."}))' "$MSG"
fi
exit 0
