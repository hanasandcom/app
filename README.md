# Hanasand App

Hanasand App is a mobile companion for people with Hanasand accounts. It brings account and workspace tasks to iOS and Android: sign in and manage your profile, work with mail and notes, scan documents, review images, use AI and automation features, and reach Hanasand control panels. The native macOS client is maintained separately in [`desktop/`](desktop/README.md).

## Mobile development

The mobile client uses Expo and React Native. From the repository root:

```sh
bun install
bun run start
```

Then use the Expo CLI to open a development build or simulator. The repository also provides `bun run ios`, `bun run android`, and `bun run prebuild` for native development. `bun run lint` and `bun run typecheck` check the JavaScript and TypeScript source; `bun run test:mobile` runs focused local-storage and session-refresh regression tests.

The workspace API defaults to `https://api.hanasand.com/api`. Mobile authentication and browser-backed AI routes use `https://hanasand.com/api`; mail uses `https://mail.hanasand.com/api`, and image libraries use `https://cdn.hanasand.com/api`. To point a development build at another API, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo. Password, passkey, Google, and configured SSO sign-in are available on the login screen; see [mobile authentication](docs/mobile-authentication.md) for the service routes and provider setup. Native app metadata, identifiers, permissions, and the current app version are in [`app.json`](app.json).

Hanasand sessions are bound to a P-256 device key. The app stores the private key in device-only SecureStore and signs authenticated requests with DPoP proofs. Existing sessions without a device key require signing in again after the Identity migration.

## Workspaces and navigation

Use the workspace name in any screen header to select Personal or an organization. Notes and other organization content use that selection; account caches are separated by user and workspace. The Menu groups the website’s tasks, with native mail, notes, images, profile, organizations, cron jobs, and service views. Pages without a native workflow open the website.

Mail supports mailbox and folder switching, message actions, attachments, and composing replies. Images reads the signed-in CDN library, albums, and favorites; device cleanup is separate. Notes keeps pending edits locally, reports sync failures, and lets you preserve both versions when a remote edit conflicts. Concurrent server writes still need server-side conditional updates for atomic conflict protection.

## Mobile releases

Mobile builds use [EAS Build](https://docs.expo.dev/build/introduction/) and the manual GitHub Actions workflow at **Actions → Mobile EAS build → Run workflow**. It supports iOS, Android, or both, with a `preview` (internal distribution) or `production` (store-signed artifact) profile. The workflow only builds artifacts; it does not submit them to either app store or publish an update. Preview builds are the default.

### One-time setup

1. Install dependencies with `bun install`, authenticate to the intended Expo account with `bunx eas-cli login`, and link this app to an EAS project by running `bunx eas-cli init`. Commit the resulting `expo.extra.eas.projectId` entry in `app.json`. The project ID is public configuration, not a credential.
2. Add an Expo access token as the GitHub Actions repository secret `EXPO_TOKEN`. Keep this token in GitHub Secrets; do not put it in source, workflow variables, or app configuration. EAS also needs signing credentials for the selected platforms. Configure these for the EAS project before requesting builds; iOS device distribution requires Apple provisioning, and production store builds require the corresponding store signing setup.
3. Run the workflow manually. Use `preview` to create installable internal builds (Android APK; iOS ad hoc distribution) or select `production` for App Store / Google Play artifacts. Store submission and release remain a separate, deliberate step.

The same builds can be requested locally after linking the project and signing in:

```sh
bunx eas-cli build --platform all --profile preview
bunx eas-cli build --platform all --profile production
```

See Expo's [build profiles](https://docs.expo.dev/build/eas-json/) and [programmatic access](https://docs.expo.dev/accounts/programmatic-access/) documentation for profile behavior and token setup.

## macOS client

The macOS app has its own Swift package, setup, screenshots, and update packaging instructions in [`desktop/README.md`](desktop/README.md).
