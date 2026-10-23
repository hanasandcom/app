# Hanasand App

Hanasand App is a mobile companion for people with Hanasand accounts. It brings account and workspace tasks to iOS and Android: sign in and manage your profile, work with mail and notes, scan documents, review images, use AI and automation features, and reach Hanasand control panels. The native macOS client lives in its own [`desktop` repository](https://github.com/hanasandcom/desktop), mirrored on [Forgejo](https://git.hanasand.com/hanasandcom/desktop).

## Mobile development

The mobile client uses Expo and React Native. From the repository root:

```sh
bun install
bun run start
```

Then use the Expo CLI to open a development build or simulator. The repository also provides `bun run ios`, `bun run android`, and `bun run prebuild` for native development. Rebuild the native app after adding a native dependency; a JavaScript update alone cannot add modules such as the Files picker. `bun run lint` and `bun run typecheck` check the JavaScript and TypeScript source; `bun run test:mobile` checks session storage and refresh, authenticated transport, AI history, mail attachments, profile sessions, CDN sessions and uploads, and native navigation.

The workspace API defaults to `https://api.hanasand.com/api`. Mobile authentication and browser-backed AI routes use `https://hanasand.com/api`; organization membership discovery uses `https://identity.hanasand.com/api`, mail uses `https://mail.hanasand.com/api`, and image libraries use `https://cdn.hanasand.com/api`. To point a development build at another API, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo. Password, passkey, Google, and configured SSO sign-in are available on the login screen; see [mobile authentication](docs/mobile-authentication.md) for the service routes and provider setup. Native app metadata, identifiers, permissions, and the current app version are in [`app.json`](app.json).

New Hanasand sessions are bound to a P-256 device key. The app stores the private key in device-only SecureStore and signs authenticated requests with DPoP proofs.

The optional [native route check](docs/native-route-checks.md) exercises account reads from a compiled native app, using its existing session. Mocked transport tests cannot establish that deployed services accept a fresh device-bound session.

## Workspaces and navigation

Use the workspace name in any screen header to select Personal or an organization. Notes and other organization content use that selection; account caches are separated by user and workspace. The Menu groups the website’s tasks, with native mail, notes, images, profile, organizations, cron jobs, and service views. Pages without a native workflow open the website.

Mail supports mailbox and folder switching, message actions, opening and sending attachments, and composing replies. Choose outgoing attachments with the native Files picker; the app checks the mail service's request-size limit before sending. Images reads the signed-in CDN library and favorites, uploads explicitly selected device photos, and manages albums, their photos and invited/public sharing. Album changes keep the original files; device cleanup is separate. Private image previews use the signed-in CDN transport and stay in memory, with 5 MB thumbnail and 50 MB full-size preview limits. Rules supports organization rule lists, versioned edits, enable/disable actions, and explicit samples of stored matches. Profile sessions include device search, network details, and session revocation. Notes keeps pending edits locally, reports sync failures, and lets you preserve both versions when a remote edit conflicts. Concurrent server writes still need server-side conditional updates for atomic conflict protection.

Traffic Overview and Recent Traffic use the website’s existing Core endpoints, with domain filters, hourly totals, request breakdowns, numbered pages, and focused request details. Search and method/status filters apply to the loaded page. Rate Limits manages the global policy and client API keys; Database provides inventory, row previews, active queries and an explicitly reviewed SQL editor; Backups provides archive history and reviewed operations. These administration screens apply to Hanasand infrastructure globally, independently of the selected workspace. Changes require verified editing access and are read-only during impersonation. Interrupted writes require a refresh and review before resubmission.

Support opens your own conversations from the Menu or Profile. You can start a ticket, reply to an open conversation, and leave feedback after it is resolved. The app keeps drafts when a request fails or a conversation changes. The support agent queue, staff status controls and realtime updates remain on the website.

Integrations opens a native destination manager for the selected Personal or organization workspace: search, add/edit, archive and explicitly test Discord/webhook destinations. Testing sends an example message to the configured destination after confirmation; dry-run, skipped and failed receipts are shown separately from delivered messages. URLs entered in the editor stay in memory and clear when the screen loses focus or the app backgrounds. Editing with a blank URL keeps the current server URL. Server permissions, action blockers and workspace lifecycle control changes; impersonated views are read-only. The separate Delivery queue at `/findings/actions`, agent Support queue/status/realtime, and other website fallbacks remain outside these native slices.

## Mobile releases

Mobile builds use [EAS Build](https://docs.expo.dev/build/introduction/) and the manual GitHub Actions workflow at **Actions → Mobile EAS build → Run workflow**. It supports iOS, Android, or both, with a `preview` (internal distribution) or `production` (store-signed artifact) profile. The workflow only builds artifacts; it does not submit them to either app store or publish an update. Preview builds are the default.

### One-time setup

1. Install dependencies with `bun install`, authenticate to the intended Expo account with `bunx eas-cli login`, and link this app to an EAS project by running `bunx eas-cli init`. Commit the resulting `expo.extra.eas.projectId` entry in `app.json`. The project ID is public configuration, not a credential.
2. Add an Expo access token as the GitHub Actions repository secret `EXPO_TOKEN`. Keep this token in GitHub Secrets; do not put it in source, workflow variables, or app configuration. EAS also needs signing credentials for the selected platforms. Configure these for the EAS project before requesting builds; iOS device distribution requires Apple provisioning, and production store builds require the corresponding store signing setup.
3. Run the workflow manually. Use `preview` to create installable internal builds (Android APK; iOS ad hoc distribution) or select `production` for App Store / Google Play artifacts. Store submission and release remain a separate, deliberate step.

For an iOS Simulator artifact, use `bunx eas-cli build --platform ios --profile simulator`. The `preview` iOS profile targets registered physical devices.

The same builds can be requested locally after linking the project and signing in:

```sh
bunx eas-cli build --platform all --profile preview
bunx eas-cli build --platform all --profile production
```

See Expo's [build profiles](https://docs.expo.dev/build/eas-json/) and [programmatic access](https://docs.expo.dev/accounts/programmatic-access/) documentation for profile behavior and token setup.

## macOS client

The native macOS app has its own Swift package, setup, screenshots, and update packaging instructions in the [`desktop` repository](https://github.com/hanasandcom/desktop), also available on [Forgejo](https://git.hanasand.com/hanasandcom/desktop).
