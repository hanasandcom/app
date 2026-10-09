#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${HANASAND_DESKTOP_AGENT_PORT:-45731}"
BASE_URL="${HANASAND_DESKTOP_AGENT_URL:-http://127.0.0.1:${PORT}}"
STAMP="$(date +"%Y%m%d-%H%M%S")"
OUT_DIR="${HANASAND_DESKTOP_SMOKE_OUT:-${ROOT_DIR}/.artifacts/desktop-smoke-${STAMP}}"
APP_BIN="${ROOT_DIR}/.build/debug/Hanasand"
APP_NAME="${HANASAND_DESKTOP_APP_NAME:-Hanasand}"
WAIT_SECONDS="${HANASAND_DESKTOP_SMOKE_WAIT:-1.4}"
CAPTURE_MODE="${HANASAND_DESKTOP_SMOKE_CAPTURE_MODE:-window}"
CAPTURE_RECT="${HANASAND_DESKTOP_SMOKE_CAPTURE_RECT:-80,70,1340,900}"
SMOKE_SCOPE="${HANASAND_DESKTOP_SMOKE_SCOPE:-full}"
STARTED_PID=""
LABELS=()
COMMANDS=()
PATHS=()
DIMENSIONS=()

mkdir -p "${OUT_DIR}"

log() {
  printf '[desktop-smoke] %s\n' "$*"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

html_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

agent_ready() {
  curl -fsS "${BASE_URL}/health" >/dev/null 2>&1
}

wait_for_agent() {
  local attempts="${1:-45}"
  local i
  for ((i = 1; i <= attempts; i += 1)); do
    if agent_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_app_if_needed() {
  if agent_ready; then
    log "loopback agent already reachable at ${BASE_URL}"
    return 0
  fi

  log "building Desktop app"
  swift build --package-path "${ROOT_DIR}" >/dev/null

  log "launching ${APP_BIN}"
  "${APP_BIN}" >"${OUT_DIR}/hanasand-desktop.log" 2>&1 &
  STARTED_PID="$!"

  if ! wait_for_agent 60; then
    log "app log follows:"
    sed -n '1,160p' "${OUT_DIR}/hanasand-desktop.log" >&2 || true
    return 1
  fi
}

activate_app() {
  osascript <<OSA >/dev/null 2>&1 || true
tell application "${APP_NAME}" to activate
delay 0.2
tell application "System Events"
  tell process "${APP_NAME}"
    if exists window 1 then
      set position of window 1 to {80, 70}
      set size of window 1 to {1340, 900}
    end if
  end tell
end tell
OSA
}

send_command() {
  local command="$1"
  local escaped
  escaped="$(json_escape "${command}")"
  curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    --data "{\"command\":\"${escaped}\"}" \
    "${BASE_URL}/command" >/dev/null
}

capture_window_id() {
  HANASAND_WINDOW_OWNER="${APP_NAME}" HANASAND_WINDOW_PID="${STARTED_PID}" swift -e '
import CoreGraphics
import Foundation

let owner = ProcessInfo.processInfo.environment["HANASAND_WINDOW_OWNER"] ?? "Hanasand"
let preferredPID = Int(ProcessInfo.processInfo.environment["HANASAND_WINDOW_PID"] ?? "")
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
let matches = windows.compactMap { window -> (id: Int, area: Int)? in
  guard
    let ownerName = window[kCGWindowOwnerName as String] as? String,
    ownerName == owner,
    let id = window[kCGWindowNumber as String] as? Int,
    let ownerPID = window[kCGWindowOwnerPID as String] as? Int,
    let bounds = window[kCGWindowBounds as String] as? [String: Any],
    let width = bounds["Width"] as? Int,
    let height = bounds["Height"] as? Int,
    width > 80,
    height > 80
  else {
    return nil
  }
  if let preferredPID, ownerPID != preferredPID {
    return nil
  }
  return (id, width * height)
}.sorted { $0.area > $1.area }

if let match = matches.first {
  print(match.id)
}
' 2>/dev/null || true
}

capture_screen() {
  local label="$1"
  local file="${OUT_DIR}/${label}.png"
  local tmp_file="${OUT_DIR}/${label}.tmp.png"
  local window_id=""
  rm -f "${tmp_file}"
  activate_app
  if [[ "${CAPTURE_MODE}" == "window" ]]; then
    window_id="$(capture_window_id)"
  fi
  if [[ -n "${window_id}" ]]; then
    if ! screencapture -x -o -l"${window_id}" "${tmp_file}"; then
      log "window capture failed for ${label}; falling back to rectangle/screen capture"
      rm -f "${tmp_file}"
    fi
  fi
  if [[ ! -s "${tmp_file}" ]]; then
    if [[ "${CAPTURE_MODE}" != "screen" && -n "${CAPTURE_RECT}" ]]; then
      screencapture -x -R"${CAPTURE_RECT}" "${tmp_file}"
    else
      screencapture -x "${tmp_file}"
    fi
  fi
  if [[ ! -s "${tmp_file}" ]]; then
    log "screenshot capture failed or produced an empty file: ${file}"
    return 1
  fi
  mv "${tmp_file}" "${file}"
  printf '%s\n' "${file}"
}

cleanup() {
  if [[ -n "${STARTED_PID}" ]]; then
    if [[ "${HANASAND_DESKTOP_SMOKE_KEEP_RUNNING:-0}" != "1" ]]; then
      kill "${STARTED_PID}" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

start_app_if_needed
activate_app

cat >"${OUT_DIR}/manifest.json" <<JSON
{
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "base_url": "${BASE_URL}",
  "screenshots": [
JSON

first=1
add_manifest_entry() {
  local label="$1"
  local command="$2"
  local path="$3"
  local dimensions="$4"
  if [[ "${first}" == "0" ]]; then
    printf ',\n' >>"${OUT_DIR}/manifest.json"
  fi
  first=0
  printf '    {"label":"%s","command":"%s","path":"%s","dimensions":"%s"}' \
    "${label}" "${command}" "${path}" "${dimensions}" >>"${OUT_DIR}/manifest.json"
}

image_dimensions() {
  local file="$1"
  local width height
  width="$(sips -g pixelWidth "${file}" 2>/dev/null | awk '/pixelWidth/ {print $2}' || true)"
  height="$(sips -g pixelHeight "${file}" 2>/dev/null | awk '/pixelHeight/ {print $2}' || true)"
  if [[ -n "${width}" && -n "${height}" ]]; then
    printf '%sx%s' "${width}" "${height}"
  else
    printf 'unknown'
  fi
}

write_report() {
  local report="${OUT_DIR}/report.html"
  cat >"${report}" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hanasand Desktop Smoke ${STAMP}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111310;
      --panel: #20231d;
      --text: #f1f0e9;
      --muted: rgba(241, 240, 233, 0.66);
      --line: rgba(255, 255, 255, 0.12);
      --accent: #9ac0ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      background: radial-gradient(circle at top left, rgba(154, 192, 255, 0.14), transparent 34rem), var(--bg);
      color: var(--text);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
      background: rgba(17, 19, 16, 0.86);
      backdrop-filter: blur(18px);
    }
    h1 { margin: 0 0 4px; font-size: 22px; }
    p { margin: 0; color: var(--muted); }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 18px;
      padding: 24px;
    }
    article {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: color-mix(in srgb, var(--panel), transparent 4%);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.26);
    }
    .meta {
      display: grid;
      gap: 5px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    .label { font-size: 15px; font-weight: 800; }
    code {
      color: var(--accent);
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .dims { color: var(--muted); font-size: 12px; }
    img {
      display: block;
      width: 100%;
      height: auto;
      background: #050505;
    }
  </style>
</head>
<body>
  <header>
    <h1>Hanasand Desktop Smoke</h1>
    <p>${STAMP} · ${BASE_URL} · ${#LABELS[@]} screenshots</p>
  </header>
  <main>
HTML

  local i label command path file dimensions
  for ((i = 0; i < ${#LABELS[@]}; i += 1)); do
    label="$(html_escape "${LABELS[$i]}")"
    command="$(html_escape "${COMMANDS[$i]}")"
    path="${PATHS[$i]}"
    file="$(basename "${path}")"
    dimensions="$(html_escape "${DIMENSIONS[$i]}")"
    cat >>"${report}" <<HTML
    <article>
      <div class="meta">
        <div class="label">${label}</div>
        <code>${command}</code>
        <div class="dims">${dimensions}</div>
      </div>
      <img src="${file}" alt="${label}">
    </article>
HTML
  done

  cat >>"${report}" <<HTML
  </main>
</body>
</html>
HTML
}

run_step() {
  local label="$1"
  local command="$2"
  log "${label}: ${command}"
  send_command "${command}"
  sleep "${WAIT_SECONDS}"
  local shot
  shot="$(capture_screen "${label}")"
  local dimensions
  dimensions="$(image_dimensions "${shot}")"
  LABELS+=("${label}")
  COMMANDS+=("${command}")
  PATHS+=("${shot}")
  DIMENSIONS+=("${dimensions}")
  add_manifest_entry "${label}" "${command}" "${shot}" "${dimensions}"
}

run_core_smoke() {
  run_step "01-control" "open_section_control"
  run_step "02-server" "open_section_server"
  run_step "03-mail" "open_section_mail"
  run_step "04-documents" "open_section_documents"
  run_step "05-images" "open_section_images"
  run_step "06-dashboard" "open_section_dashboard"
  run_step "07-shares" "open_dashboard_shares"
  run_step "08-ai-models" "open_dashboard_ai_models"
  run_step "09-settings" "open_section_settings"
}

run_dashboard_smoke() {
  run_step "10-dashboard-mail" "open_dashboard_mail"
  run_step "11-links" "open_dashboard_links"
  run_step "12-tests" "open_dashboard_tests"
  run_step "13-articles" "open_dashboard_articles"
  run_step "14-thoughts" "open_dashboard_thoughts"
  run_step "15-profile" "open_dashboard_profile"
  run_step "16-users" "open_dashboard_users"
  run_step "17-roles" "open_dashboard_roles"
  run_step "18-logs" "open_dashboard_logs"
  run_step "19-system" "open_dashboard_system"
  run_step "20-vms" "open_dashboard_vms"
  run_step "21-notes" "open_dashboard_notes"
  run_step "22-databases" "open_dashboard_db"
  run_step "23-backups" "open_dashboard_backups"
  run_step "24-restore" "open_dashboard_restore"
  run_step "25-vulnerabilities" "open_dashboard_vulnerabilities"
  run_step "26-rate-limits" "open_dashboard_rate_limits"
  run_step "27-traffic" "open_dashboard_traffic"
  run_step "28-automations" "open_dashboard_automations"
  run_step "29-cron" "open_dashboard_cron"
}

assert_dashboard_smoke_covers_loopback_commands() {
  local missing=0
  local command
  while IFS= read -r command; do
    [[ -z "${command}" ]] && continue
    if ! grep -q "\"${command}\"" "$0"; then
      log "dashboard loopback command is not covered by screenshot smoke: ${command}"
      missing=1
    fi
  done < <(grep -Eo '"open_dashboard_[^"]+"' "${ROOT_DIR}/Sources/Hanasand/Hanasand.swift" | tr -d '"' | sort -u)

  if [[ "${missing}" == "1" ]]; then
    return 1
  fi
}

assert_dashboard_smoke_covers_loopback_commands

case "${SMOKE_SCOPE}" in
  core)
    run_core_smoke
    ;;
  dashboard)
    run_step "00-dashboard" "open_section_dashboard"
    run_dashboard_smoke
    ;;
  full)
    run_core_smoke
    run_dashboard_smoke
    ;;
  *)
    log "unknown HANASAND_DESKTOP_SMOKE_SCOPE=${SMOKE_SCOPE}; expected core, dashboard, or full"
    exit 2
    ;;
esac

printf '\n  ]\n}\n' >>"${OUT_DIR}/manifest.json"
write_report

log "screenshots written to ${OUT_DIR}"
log "manifest: ${OUT_DIR}/manifest.json"
log "report: ${OUT_DIR}/report.html"
