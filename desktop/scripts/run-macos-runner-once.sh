#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER_DIR="${ROOT_DIR}/.hanasand-runner"
BIN="${RUNNER_DIR}/bin/forgejo-runner"
SOURCE_DIR="${RUNNER_DIR}/src"
INSTANCE="${FORGEJO_INSTANCE_URL:-https://git.hanasand.com}"
RUNNER_NAME="${FORGEJO_RUNNER_NAME:-$(hostname)-macos}"
RUNNER_LABELS="${FORGEJO_RUNNER_LABELS:-macos:host,macos-arm64:host}"

mkdir -p "${RUNNER_DIR}/bin"

if [[ ! -x "${BIN}" ]]; then
  rm -rf "${SOURCE_DIR}"
  git clone --depth 1 --branch v6.2.2 https://code.forgejo.org/forgejo/runner.git "${SOURCE_DIR}"
  (
    cd "${SOURCE_DIR}"
    go build -o "${BIN}" .
  )
fi

cd "${RUNNER_DIR}"

if [[ ! -f .runner ]]; then
  if [[ -z "${FORGEJO_RUNNER_TOKEN:-}" ]]; then
    if command -v ssh >/dev/null 2>&1; then
      FORGEJO_RUNNER_TOKEN="$(ssh hanasand 'docker exec --user git git_ui forgejo actions generate-runner-token')"
    fi
  fi

  if [[ -z "${FORGEJO_RUNNER_TOKEN:-}" ]]; then
    echo "Set FORGEJO_RUNNER_TOKEN or make sure the hanasand SSH alias works." >&2
    exit 1
  fi

  "${BIN}" register \
    --no-interactive \
    --instance "${INSTANCE}" \
    --token "${FORGEJO_RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}"
fi

echo "Starting foreground Forgejo runner for ${INSTANCE}."
echo "Stop it with Ctrl-C when the desktop update workflow is finished."
exec "${BIN}" daemon
