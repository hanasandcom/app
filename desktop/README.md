# Hanasand Desktop App + Agent

Native macOS desktop app with an embedded loopback agent. The UI is built for fast agentic work: project rail, transcript, local status, Hanasand actions, and a bottom command dock. The embedded agent exposes the same safe local API that the phone app can call.

## Run the Desktop GUI

```sh
swift run Hanasand
```

The app starts a local agent on `http://127.0.0.1:45731` and keeps the status visible in the title bar and transcript.

## Native Features

- Command-first local control surface.
- Native dashboard panels for Hanasand website, admin, share, VM, logs, database, backups, restore, notes, traffic, and vulnerability pages.
- Real local Mac status through the embedded loopback agent.
- Mail overview loader using the real Hanasand mail API.
- Hanasand AI model check and prompt endpoint wiring.
- Server controls for VPN, RDP, start, stop, and logs.
- Settings for API URLs, auth token, user id, desktop agent URL, VPN, RDP, and server paths.

## Package an Auto Update

```sh
HANASAND_APP_VERSION=0.1.2 app/desktop/scripts/package-update.sh
```

The script builds a release `.app`, signs it with `HANASAND_CODESIGN_IDENTITY` when set, otherwise auto-selects the first local `Apple Development` signing identity, and verifies the result before writing the archive. Stable signing keeps macOS privacy permissions such as Screen Recording attached across updates. Ad-hoc update packages are refused by default; set `HANASAND_ALLOW_ADHOC_SIGNING=1` only for throwaway local builds. It writes `Hanasand-<version>-macos.zip` plus `manifest.json` to `app/desktop/dist` by default. Set `HANASAND_APP_OUTPUT_DIR` to write into another directory, for example:

```sh
HANASAND_APP_VERSION=0.1.2 HANASAND_APP_OUTPUT_DIR=/tmp/hanasand-desktop-0.1.2 app/desktop/scripts/package-update.sh
```

The API reads the exact archive filename from `manifest.json`, so upload that versioned archive and the manifest together without renaming the archive:

```sh
rsync -az dist/Hanasand-0.1.2-macos.zip dist/manifest.json ubuntu@hanasand:/srv/hanasand/app-updates/
```

## Run the macOS Update Runner

The Forgejo workflow needs a macOS runner because SwiftUI apps cannot be built in the Linux git container. To avoid an always-on remote execution agent, run the macOS runner in the foreground only when publishing desktop updates:

```sh
app/desktop/scripts/run-macos-runner-once.sh
```

The script builds the Forgejo runner locally if needed, registers it with `macos` and `macos-arm64` labels, and runs it until you stop it with `Ctrl-C`.

## Embedded Agent Endpoints

- `GET /health`
- `GET /status`
- `POST /command` with `{ "command": "status" }`

Only the safe `status` command is enabled. Add future actions as explicit allowlist entries.

## Visual Smoke Screenshots

Run a repeatable native UI smoke pass from macOS:

```sh
app/desktop/scripts/smoke-screenshots.sh
```

The script builds/launches the Desktop app if the loopback agent is not already reachable, opens important sections through `POST /command`, validates that screenshots were written, and captures them into `.artifacts/desktop-smoke-<timestamp>/` with a `manifest.json` plus a browsable `report.html` contact sheet.

Useful options:

```sh
HANASAND_DESKTOP_SMOKE_KEEP_RUNNING=1 app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_OUT=/tmp/hanasand-smoke app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_AGENT_URL=http://127.0.0.1:45731 app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_SCOPE=core app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_SCOPE=dashboard app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=rect app/desktop/scripts/smoke-screenshots.sh
HANASAND_DESKTOP_SMOKE_CAPTURE_RECT=80,70,1340,900 app/desktop/scripts/smoke-screenshots.sh
```

The default `full` smoke path captures Control, Server, Mail, Documents, Images, Dashboard, Settings, and every registered native dashboard route: dashboard mail, shares, links, tests, articles, thoughts, profile, users, roles, logs, system, VMs, notes, databases, backups, restore, vulnerabilities, rate limits, and traffic. The script statically checks that every `open_dashboard_*` loopback command is included in screenshot coverage before it starts capturing. Use `HANASAND_DESKTOP_SMOKE_SCOPE=core` for a fast shell pass or `dashboard` for route parity only. Screenshots use the visible Hanasand window id by default so older background windows do not pollute the visual review. Set `HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=rect` for rectangle capture, or set `HANASAND_DESKTOP_SMOKE_CAPTURE_MODE=screen HANASAND_DESKTOP_SMOKE_CAPTURE_RECT=` for full-screen captures.

## Legacy C++ Agent

The small C++ loopback agent is still available when a GUI is not needed.

### Build

```sh
clang++ -std=c++17 -O2 -Wall -Wextra main.cpp -o build/hanasand-agent
```

On Windows, build with a C++17 compiler and link Winsock.

### Run

```sh
./build/hanasand-agent 45731
```

The agent binds only to `127.0.0.1` by default. The iOS simulator can reach it through `http://127.0.0.1:45731`.
