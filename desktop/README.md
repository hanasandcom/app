# Hanasand Desktop

Native macOS client for Hanasand account, mail, AI, and control workflows. It also runs an embedded Swift command bridge that the signed-in mobile app can discover over the local network.

## Run the macOS app

From the repository root:

```sh
cd desktop
swift run Hanasand
```

The package requires macOS 14 or later. The app starts its embedded Swift bridge on port `45731`. After sign-in, it publishes active non-loopback IPv4 addresses for LAN discovery. The bridge also accepts requests on the Mac itself. Its requests require a short-lived, nonce-protected HMAC session proof derived from the current Hanasand login; a plain unauthenticated `curl` request is rejected. The bridge still uses HTTP, so proofs authenticate requests and prevent undetected changes but do not encrypt their contents or responses.

### Embedded Swift bridge routes

The bridge exposes these HTTP routes:

- `GET /health` and `GET /status` return Mac status.
- `GET /screenshot` returns the current desktop screenshot.
- `GET /commands` returns the supported command names.
- `POST /command` accepts a command in a JSON body; the same bridge also accepts command query forms.

Commands include status and update checks, AI actions, app-section navigation, browser actions, native dashboard panels, server logs, settings, and remote-desktop controls. Parameterized commands include `codex_prompt:<url-encoded-prompt>`, `mac_control_type_text:<url-encoded-text>`, and `mac_control_pointer_click_at:<x>:<y>`. Keyboard text entry and pointer clicks require macOS Accessibility permission. Use the authenticated client for requests and read `GET /commands` for the names accepted by the running app; unsupported commands return HTTP 400. The bridge returns HTTP 401 when the session proof is missing or invalid.

## Package a macOS update

From the repository root, choose a semantic version and run:

```sh
HANASAND_APP_VERSION=0.1.2 desktop/scripts/package-update.sh
```

The script builds and verifies a release `.app`, signs it with `HANASAND_CODESIGN_IDENTITY` when set, or selects the first local Apple Development identity. Stable signing keeps macOS privacy permissions such as Screen Recording attached across updates. Ad-hoc packages are refused unless `HANASAND_ALLOW_ADHOC_SIGNING=1` is set for a throwaway local build. By default, the script writes `desktop/dist/Hanasand-<version>-macos.zip` and `desktop/dist/manifest.json`. Set `HANASAND_APP_OUTPUT_DIR` to choose another output directory:

```sh
HANASAND_APP_VERSION=0.1.2 HANASAND_APP_OUTPUT_DIR=/tmp/hanasand-desktop-0.1.2 desktop/scripts/package-update.sh
```

The update API reads the exact archive filename recorded in the manifest. Upload the versioned archive and its manifest together, without renaming the archive. For example, from the repository root:

```sh
rsync -az desktop/dist/Hanasand-0.1.2-macos.zip desktop/dist/manifest.json ubuntu@hanasand:/srv/hanasand/app-updates/
```

The runner helper is intended for a Forgejo update workflow, which needs a macOS runner because SwiftUI cannot be built in the Linux Git container. This checkout includes the helper but no Forgejo workflow definition, so any trigger and automated release steps are outside this repository. Start the runner in the foreground when that external workflow requires it:

```sh
desktop/scripts/run-macos-runner-once.sh
```

The script builds the Forgejo runner locally if needed, registers it with `macos` and `macos-arm64` labels, and runs until stopped with `Ctrl-C`.

## Capture visual smoke screenshots

On macOS, run the screenshot pass from the repository root:

```sh
desktop/scripts/smoke-screenshots.sh
```

The script is intended to build or launch the Desktop app, open sections through `POST /command`, check the screenshots, and save a manifest and browsable HTML contact sheet under `desktop/.artifacts/desktop-smoke-<timestamp>/`. At this revision it sends unauthenticated `curl` requests to `/health` and `/command`, while the Swift bridge requires a session proof on both routes. The bridge returns HTTP 401, so this script cannot reach its capture steps until it gains authenticated request support.

Useful options:

```sh
HANASAND_DESKTOP_SMOKE_KEEP_RUNNING=1 desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_OUT=/tmp/hanasand-smoke desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_AGENT_URL=http://127.0.0.1:45731 desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_SCOPE=core desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_SCOPE=dashboard desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=rect desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_CAPTURE_RECT=80,70,1340,900 desktop/scripts/smoke-screenshots.sh
```

The default `full` pass captures Control, Server, Mail, Documents, Images, Dashboard, Settings, and every registered native dashboard route. The script checks route-command coverage before capture. Use `core` for a short shell pass or `dashboard` for dashboard route coverage. Screenshots use the visible Hanasand window ID by default. Set `HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=rect` to capture a rectangle, or use `HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=screen` and clear `HANASAND_DESKTOP_SMOKE_CAPTURE_RECT` for a full-screen capture.

## Legacy C++ loopback helper

`desktop/main.cpp` builds a separate, minimal helper for cases that do not need the macOS GUI. It is not the Swift bridge: it binds only to `127.0.0.1`, exposes `GET /health`, `GET /status`, and `POST /command`, and returns status output when the request text contains `status`; other command text returns HTTP 400. It does not parse the JSON command field, and it has no LAN discovery or the Swift bridge's session-proof protocol. Its default port is also `45731`; choose another port when running it alongside the Swift app.

Build it from `desktop/`:

```sh
clang++ -std=c++17 -O2 -Wall -Wextra main.cpp -o build/hanasand-agent
```

On Windows, use a C++17 compiler and link Winsock. Run it with an optional port:

```sh
./build/hanasand-agent 45732
```
