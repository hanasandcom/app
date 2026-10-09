#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${HANASAND_APP_VERSION:-$(git -C "$ROOT_DIR/../.." rev-parse --short HEAD)}"
CHANNEL="${HANASAND_APP_CHANNEL:-stable}"
RELEASED_AT="${HANASAND_APP_RELEASED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
RELEASE_NOTES="${HANASAND_APP_RELEASE_NOTES:-Desktop app update from commit $(git -C "$ROOT_DIR/../.." rev-parse --short HEAD).}"
DIST_DIR="${HANASAND_APP_OUTPUT_DIR:-${ROOT_DIR}/dist}"
if [[ "${DIST_DIR}" != /* ]]; then
  DIST_DIR="${PWD}/${DIST_DIR}"
fi
BUILD_DIR="${ROOT_DIR}/.build/release"
APP_DIR="${DIST_DIR}/Hanasand.app"
PACKAGE_PATH="${DIST_DIR}/Hanasand-${VERSION}-macos.zip"
ICON_FILE="${ROOT_DIR}/Resources/Hanasand.icns"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?([-+][A-Za-z0-9.]+)?$ ]]; then
  cat >&2 <<EOF
Invalid HANASAND_APP_VERSION: ${VERSION}
Desktop updater versions must be semantic, e.g. 0.1.29.
Branch names such as local-ai-simplified must not be written into CFBundleShortVersionString.
EOF
  exit 64
fi

rm -rf "$APP_DIR" "$PACKAGE_PATH"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$DIST_DIR"

swift build --package-path "$ROOT_DIR" -c release
BUILD_DIR="$(swift build --package-path "$ROOT_DIR" -c release --show-bin-path)"

cp "$BUILD_DIR/Hanasand" "$APP_DIR/Contents/MacOS/Hanasand"
chmod +x "$APP_DIR/Contents/MacOS/Hanasand"
cp -R "$BUILD_DIR/Hanasand_Hanasand.bundle" "$APP_DIR/Contents/Resources/"
if [[ -f "$ICON_FILE" ]]; then
  cp "$ICON_FILE" "$APP_DIR/Contents/Resources/Hanasand.icns"
fi

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Hanasand</string>
  <key>CFBundleIdentifier</key>
  <string>com.hanasand.desktop</string>
  <key>CFBundleName</key>
  <string>Hanasand</string>
  <key>CFBundleDisplayName</key>
  <string>Hanasand</string>
  <key>CFBundleIconFile</key>
  <string>Hanasand</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

SIGN_IDENTITY="${HANASAND_CODESIGN_IDENTITY:-}"
if [[ -z "$SIGN_IDENTITY" ]] && command -v security >/dev/null 2>&1; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Apple Development:/ { print $2; exit }')"
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  codesign --force --deep --options runtime --sign "$SIGN_IDENTITY" "$APP_DIR"
elif [[ "${HANASAND_ALLOW_ADHOC_SIGNING:-}" == "1" ]]; then
  echo "Signing ad-hoc because HANASAND_ALLOW_ADHOC_SIGNING=1 is set." >&2
  codesign --force --deep --sign - "$APP_DIR"
else
  cat >&2 <<EOF
No valid Apple Development signing identity found.
Refusing to package an ad-hoc desktop update because macOS privacy permissions
such as Screen Recording are tied to the app signature and will be lost.

Set HANASAND_CODESIGN_IDENTITY to a valid identity, or set
HANASAND_ALLOW_ADHOC_SIGNING=1 only for throwaway local builds.
EOF
  exit 65
fi

codesign --verify --deep --strict --verbose=2 "$APP_DIR"

(
  cd "$DIST_DIR"
  ditto -c -k --keepParent "Hanasand.app" "$(basename "$PACKAGE_PATH")"
)

SHA256="$(shasum -a 256 "$PACKAGE_PATH" | awk '{print $1}')"
SIZE="$(stat -f%z "$PACKAGE_PATH")"

VERSION="${VERSION}" \
PACKAGE_NAME="$(basename "$PACKAGE_PATH")" \
SHA256="${SHA256}" \
SIZE="${SIZE}" \
DIST_DIR="${DIST_DIR}" \
CHANNEL="${CHANNEL}" \
RELEASED_AT="${RELEASED_AT}" \
RELEASE_NOTES="${RELEASE_NOTES}" \
python3 - <<'PY'
import json
import os
from pathlib import Path

manifest = {
    "app": "hanasand-desktop",
    "platform": "macos",
    "version": os.environ["VERSION"],
    "package": os.environ["PACKAGE_NAME"],
    "sha256": os.environ["SHA256"],
    "size": int(os.environ["SIZE"]),
    "channel": os.environ["CHANNEL"],
    "released_at": os.environ["RELEASED_AT"],
    "notes": os.environ["RELEASE_NOTES"],
}

Path(os.environ.get("DIST_DIR", "dist")).joinpath("manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY

printf '%s\n' "$PACKAGE_PATH"
