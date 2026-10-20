# Hanasand App

Hanasand App is a mobile companion for people with Hanasand accounts. It brings account and workspace tasks to iOS and Android: sign in and manage your profile, work with mail and notes, scan documents, review images, use AI and automation features, and reach Hanasand control panels. The native macOS client is maintained separately in [`desktop/`](desktop/README.md).

## Mobile development

The mobile client uses Expo and React Native. From the repository root:

```sh
bun install
bun run start
```

Then use the Expo CLI to open a development build or simulator. The repository also provides `bun run ios`, `bun run android`, and `bun run prebuild` for native development. `bun run lint` and `bun run typecheck` check the JavaScript and TypeScript source; `bun run test:mobile` runs focused local-storage and session-refresh regression tests.

The API defaults to `https://hanasand.com/api`. To point a development build at another API, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo. Native app metadata, identifiers, permissions, and the current app version are in [`app.json`](app.json).

## Mobile releases

This checkout documents local Expo development and native prebuild commands. It does not contain an EAS configuration, a mobile release script, or a GitHub Actions workflow for building or publishing iOS and Android releases. Signing, store submission, and any release process outside this repository are not specified here.

## macOS client

The macOS app has its own Swift package, setup, screenshots, and update packaging instructions in [`desktop/README.md`](desktop/README.md).
