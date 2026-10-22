# Mobile authentication

The mobile login screen supports password login, iOS and Android passkey login, Google sign-in, and the configured OIDC SSO provider. Passkey assertions use Identity's existing WebAuthn challenge and `hanasand.com` relying-party ID so website credentials can be reused in the app. Google sign-in uses the website's Google OAuth client and returns a PKCE-bound, single-use code to the app; Google credentials and provider tokens never enter the app.

## Deployment requirements

- Deploy `frontend/public/.well-known/apple-app-site-association` from the Hanasand website repository. It associates `webcredentials:hanasand.com` with `8VBNY258K7.com.hanasand.app`.
- Deploy the mobile passkey verification and SSO start/exchange routes in the Hanasand frontend, and the mobile SSO start/exchange handlers and schema migration in Identity.
- Deploy the social-auth routes in the Hanasand frontend and configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in both Identity workers. Register `https://hanasand.com/api/auth/social/google/callback` as the Google OAuth redirect URI. `GET /api/auth/social/providers` must report Google as configured before mobile sign-in can start.
- Keep `PASSKEY_ORIGIN=https://hanasand.com` and `PASSKEY_RP_ID=hanasand.com` for the website and iOS.
- The EAS Android upload-certificate SHA-256 is `6B:76:5F:2C:89:3E:CB:9A:45:14:EA:5B:56:B4:32:10:20:42:6E:59:4B:70:6D:B3:7D:42:65:38:57:17:66:A7`. Keep it in the website `assetlinks.json` and its base64url `android:apk-key-hash:` form in Identity's `PASSKEY_ALLOWED_ORIGINS`. If publishing through Google Play, add the Play App Signing fingerprint as well.
- Configure the signed iOS EAS build with the associated domain and custom `hanasand://` scheme. Mobile SSO and Google sign-in bind PKCE challenges to Identity transactions and send only short-lived, single-use codes to the app; the app exchanges them with their verifiers over HTTPS.

The app build does not deploy the website or Identity service. Release the app, website, and Identity changes together. Google sign-in also requires the Google OAuth credentials and callback URI above; if the provider-status route reports `configured: false`, sign-in is unavailable until the server credentials are set.
