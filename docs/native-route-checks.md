# Native account route check

`test/native-route-probe.tsx` is an optional integration entry for a simulator or test device with an existing signed-in account. The normal `index.ts` does not import it. It replaces the app UI temporarily and makes read requests through the real native storage, device-proof and service adapters. It does not sign in, create records, send mail, submit billing actions, or change settings.

Bundle it with Expo's `export:embed --entry-file test/native-route-probe.tsx --platform ios --dev false` into a separate simulator app artifact with the same native modules and signing identity. Set `EXPO_PUBLIC_PROBE_REVISION` to the checked source revision. Preserve the normal artifact and its JavaScript bundle before running the probe; reinstall the normal artifact afterward. Do not change the simulator's Keychain access group between these artifacts.

The check writes `mobile-runtime-probe.json` in the app cache directory. The report contains the source label, session availability, success, collection counts, elapsed time and redacted failure categories. Tokens, device keys, account identifiers, messages, filenames, session details and other response content are not written to the report. Credentials stay inside the app's normal storage and authenticated transport.

The nineteen checks cover organizations, AI conversations, profile, sessions, passkeys, SSH keys, Support tickets, mail, notes, CDN images/albums, cron, health checks, profile statistics, subscription, hosts, both update hosts and standalone service status. A missing session is not a passing check. Inspect every result and the final `complete` marker. Empty lists do not establish create/edit behavior; cron readiness and service-status warnings require separate interpretation.

This verifies native API reads, not visual layout, password entry, passkey user presence, provider sign-in, mutations or full menu task completion. Check those separately in the installed normal app. Use a test account when another login is needed, and preserve the account's data.
