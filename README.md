# Hanasand App

Hanasand App is a mobile companion for people with Hanasand accounts. It brings account and workspace tasks to iOS and Android: sign in and manage your profile, work with mail and notes, scan documents, review images, use AI and automation features, and reach Hanasand control panels. The native macOS client lives in its own [`desktop` repository](https://github.com/hanasandcom/desktop), mirrored on [Forgejo](https://git.hanasand.com/hanasandcom/desktop).

## Mobile development

The mobile client uses Expo and React Native. From the repository root:

```sh
bun install
bun run start
```

Then use the Expo CLI to open a development build or simulator. The repository also provides `bun run ios`, `bun run android`, and `bun run prebuild` for native development. Rebuild the native app after adding a native dependency; a JavaScript update alone cannot add modules such as the Files picker. `bun run lint` and `bun run typecheck` check the JavaScript and TypeScript source; `bun run test:mobile` checks session storage and refresh, authenticated transport, AI history, mail attachments, profile sessions, CDN sessions and uploads, and native navigation.

Synthetic simulator entries live under `test/` and are excluded from `index.ts`. After exporting a fixture with `EXPO_PUBLIC_` overrides, export the normal entry with `--reset-cache` and verify its service URLs; Metro can retain an inlined fixture endpoint in its transform cache.

The workspace API defaults to `https://api.hanasand.com/api`. Mobile authentication and browser-backed AI routes use `https://hanasand.com/api`; organization membership discovery uses `https://identity.hanasand.com/api`, mail uses `https://mail.hanasand.com/api`, and image libraries use `https://cdn.hanasand.com/api`. To point a development build at another API, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo. Password, passkey, Google, and configured SSO sign-in are available on the login screen; see [mobile authentication](docs/mobile-authentication.md) for the service routes and provider setup. Native app metadata, identifiers, permissions, and the current app version are in [`app.json`](app.json).

New Hanasand sessions are bound to a P-256 device key. The app stores the private key in device-only SecureStore and signs authenticated requests with DPoP proofs.

The optional [native route check](docs/native-route-checks.md) exercises account reads from a compiled native app, using its existing session. Mocked transport tests cannot establish that deployed services accept a fresh device-bound session.

## Workspaces and navigation

Use the workspace name in any screen header to select Personal or an organization. Notes and other organization content use that selection; account caches are separated by user and workspace. The Menu groups the website’s tasks, with native mail, notes, images, profile, organizations, cron jobs, and service views. Pages without a native workflow open the website.

Mail supports mailbox and folder switching, message actions, opening and sending attachments, and composing replies. Choose outgoing attachments with the native Files picker; the app checks the mail service's request-size limit before sending. Images reads the signed-in CDN library and favorites, uploads explicitly selected device photos, and manages albums, their photos and invited/public sharing. Album changes keep the original files; device cleanup is separate. Private image previews use the signed-in CDN transport and stay in memory, with 5 MB thumbnail and 50 MB full-size preview limits. Rules supports organization rule lists, versioned edits, enable/disable actions, and explicit samples of stored matches. Profile sessions include device search, network details, and session revocation. Notes keeps pending edits locally, reports sync failures, and lets you preserve both versions when a remote edit conflicts. Concurrent server writes still need server-side conditional updates for atomic conflict protection.

Traffic Overview and Recent Traffic use the website’s existing Core endpoints, with domain filters, hourly totals, request breakdowns, numbered pages, and focused request details. Search and method/status filters apply to the loaded page. Live Map streams the existing SSE feed, with domain filters, country focus, request details, zoom and pan. Country shares describe the located requests in the latest 200-request snapshot; they do not represent every retained request. It pauses while hidden and stops automatic reconnects after authentication rejection. Rate Limits manages the global policy and client API keys; Database provides inventory, row previews, active queries and an explicitly reviewed SQL editor; Backups provides archive history and reviewed operations. These administration screens apply to Hanasand infrastructure globally, independently of the selected workspace. Changes require verified editing access and are read-only during impersonation. Interrupted writes require a refresh and review before resubmission.

Support in the Menu opens the server-authorized staff queue or your own conversations. Staff can filter and open conversations, reply, resolve/reopen them, and review customer account changes. Authenticated live updates refresh the queue. Profile keeps your personal tickets, replies and resolved-ticket feedback. Interrupted changes require an explicit refresh before another attempt. Discord account linking remains on the website.

Integrations opens a native destination manager for the selected Personal or organization workspace: search, add/edit, archive and explicitly test Discord/webhook destinations. Testing sends an example message to the configured destination after confirmation; dry-run, skipped and failed receipts are shown separately from delivered messages. URLs entered in the editor stay in memory and clear when the screen loses focus or the app backgrounds. Editing with a blank URL keeps the current server URL. Server permissions, action blockers and workspace lifecycle control changes; impersonated views are read-only. The destination manager uses `/findings/actions`. Delivery history at `/findings/delivery` has alert selection, retained attempt details, reviewed Test/Send/Retry actions and durable receipts; linked cases open their exact website route.

The organization directory supports search, sorting and switching only to freshly verified active memberships. AI Metrics shows the existing HTTP and authenticated socket telemetry, queue, clients and containers, with explicitly reviewed tests targeting one available client. Container logs open the filtered website view. Missing telemetry remains unavailable rather than becoming zero. Other menu destinations without native workflows remain website links.

Users opens the native account directory, scoped profile details, active memberships, and reviewed activation, deactivation and deletion scheduling. Deactivation revokes the account’s tokens; deletion is scheduled for 30 days and may require an ownership transfer. Impersonation is unavailable until Core and Identity agree on delegated-session tokens. No legacy impersonation marker is generated by the app.

Load Testing supports reviewed traffic presets and custom stages, account allowance, personal and shared history, result lookup, metrics, logs, sharing and reruns. Creating or rerunning a test requires confirmation of permission to generate traffic. Joining public live output requires a separate confirmation because it starts the server’s queued runner. The app never joins or reconnects automatically; closing it does not stop a server run.

Findings uses the scoped website feed, opaque cursor pages, loaded-result search and evidence investigation. Its website proxy must forward the device-bound proof to the scraper; older proxies that validate the session and then discard its proof cannot serve native sessions. Actor links prefill native threat search. Case and monitored-actor links retain their website handoffs; native case actions still need a compatible server authorization path. Threat search cancels reads and polling while hidden and keeps account-saved searches separate by session and workspace.

Rule Tuning uses the fixed Hanasand workspace: review log patterns, edit and preview rules against stored logs, create a rule, and inspect or cancel reprocessing jobs. Starting reprocessing requires confirmation because it can permanently remove eligible matching Low logs and originals. Interrupted changes require refresh and review. API reference and OpenAPI JSON use the website’s public contract; application examples are a pinned copy of the website’s fictional examples. Neither reference screen submits the described API operations.


Thesis opens the shared Hanasand document in a native editor with sheet switching, Markdown and tables, Plan, Timetable and PDF sharing. It uses revision checks, explicit conflict review, version history, source inventory and review, and a dependency graph. Unsaved drafts are encrypted on the device. Editing requires fresh Thesis permissions on your own account; an interrupted save requires reconciliation before another write. These workflows have local contract and model checks; device behavior and production authorization still need verification.

TI administration website links open the owning `ti.hanasand.com/dashboard/ti/` pages. The old Core `/ti/` aliases can resolve as public search queries after redirecting. Custom website origins remain configurable; `EXPO_PUBLIC_TI_SITE_URL` selects the TI website when needed. Native TI operator parity still needs compatible service authentication and full snapshot endpoints.

Privacy & Retention uses the selected organization’s existing Core privacy API directly. It shows protection, recent runs and requests, paged records, and reviewed export, purge and deletion actions. Export files are checksum-checked and temporary. Deletion requires the current organization name and password. A missing request in the limited history or loss of organization access does not establish that a change failed or completed. Device sharing, production authorization and backend latency remain unverified.

Articles and Thoughts use the registered Core content APIs for workspace lists, native Markdown editing and preview, creation, saving and deletion. Saves persist immediately; there is no separate draft or publication state. Personal reads the shared editorial pool, with Hanasand permissions required for editing; organization content uses its own membership. Interrupted writes retain a scoped fingerprint for explicit reconciliation within the app process. Article reads expose the body without original YAML frontmatter, so saving can remove that metadata; the editor discloses this before saving. There is no server revision check or version-history contract. Device behavior and production authorization remain unverified.

System and Containers use Core runtime snapshots, authenticated live telemetry, storage progress and recent Docker/native logs. Restart and storage cleanup require fresh editing access, your own account and confirmation. An interrupted action remains unresolved across screen changes and token refresh within the app process; manual inspection and acknowledgement are required before another action. Runtime logs identify their source and availability; the full Logs website can use a separate ingested dataset. Users without internal visibility can open the current VM inventory. Full native VM management and terminal interaction remain unfinished. The backend restart route still needs its own role enforcement; native controls do not repair that server authorization gap. Device behavior and production authorization remain unverified.

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
