#!/usr/bin/env bash
set -euo pipefail

QUEUE_DIR="${HANASAND_CODEX_QUEUE_DIR:-/tmp/hanasand-codex-queue}"
DONE_DIR="${QUEUE_DIR}/done"
FAILED_DIR="${QUEUE_DIR}/failed"
CODEX_BIN="${HANASAND_CODEX_BIN:-/Applications/Codex.app/Contents/Resources/codex}"
REPO_DIR="${HANASAND_CODEX_REPO:-/Users/eirikhanasand/Desktop/personal/hanasand}"
POLL_SECONDS="${HANASAND_CODEX_POLL_SECONDS:-2}"
PORTAL_WORKER="${HANASAND_PROMPT_PORTAL_WORKER:-$(dirname "$0")/codex-portal-worker.mjs}"

mkdir -p "$QUEUE_DIR" "$DONE_DIR" "$FAILED_DIR"

run_prompt() {
  local prompt_file="$1"
  local base token output log
  base="$(basename "$prompt_file" .prompt)"
  token="$base"
  output="/tmp/hanasand-phone-codex-last-message.txt"
  log="/tmp/hanasand-phone-codex-run.log"

  printf 'Processing %s at %s\n' "$token" "$(date -u +%FT%TZ)" >> "$log"
  if "$CODEX_BIN" exec \
    --cd "$REPO_DIR" \
    --sandbox workspace-write \
    --full-auto \
    --output-last-message "$output" \
    - < "$prompt_file" >> "$log" 2>&1; then
    mv "$prompt_file" "$DONE_DIR/${base}.prompt"
    printf 'Completed %s at %s\n' "$token" "$(date -u +%FT%TZ)" >> "$log"
  else
    mv "$prompt_file" "$FAILED_DIR/${base}.prompt"
    printf 'Failed %s at %s\n' "$token" "$(date -u +%FT%TZ)" >> "$log"
  fi
}

if [[ "${1:-}" == "--once" ]]; then
  shopt -s nullglob
  for prompt_file in "$QUEUE_DIR"/*.prompt; do
    run_prompt "$prompt_file"
  done
  exit 0
fi

if [[ -f "$PORTAL_WORKER" && "${HANASAND_PROMPT_PORTAL_ENABLED:-1}" == "1" ]]; then
  node "$PORTAL_WORKER" &
fi

while true; do
  shopt -s nullglob
  for prompt_file in "$QUEUE_DIR"/*.prompt; do
    run_prompt "$prompt_file"
  done
  sleep "$POLL_SECONDS"
done
