# Deployment and external verification

## Fresh Convex development deployment

Use Node 24 in `backend/`. Select the intended Convex project/deployment, or supply its scoped deploy key through your secure environment. Run `npm ci && npm run check && npx convex deploy`; deployment performs official code generation, bundling, component installation and strict schema analysis. A passing local check is not a cloud deployment.

Before the first deployment, configure these **non-secret development bootstrap values** in the deployment:

```dotenv
TAKE_DEPLOYMENT_ENV=development
AUTH_APPLE_CLIENT_ID=unconfigured
AUTH_APPLE_TEAM_ID=unconfigured
AUTH_APPLE_KEY_ID=unconfigured
AUTH_APPLE_PRIVATE_KEY=unconfigured
TAKE_HTTP_ORIGIN=https://<deployment>.convex.site
TAKE_ALLOW_DEV_SEED=false
```

Convex Auth 2.0.0's Apple component requires its four bindings even when using only development password sign-in. The literal `unconfigured` satisfies installation, but **both Apple start and completion reject any missing, empty or placeholder credential with `PROCESSING_UNAVAILABLE`**, in development and production. It is not a fake key or an authentication fallback. Development deployment/sign-in needs no additional secret beyond the deploy credential. Omit media-verifier configuration until a real worker exists; publication then fails closed rather than issuing a receipt.

Convex supplies `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL`. Do not set signing keys or a JWKS secret: Convex Auth's core signs ES256 access tokens with the deployment key. `auth.config.ts` uses `convexAuthProvider()` with the deployment's `/components/auth` issuer, `convex-auth` audience and deployment JWKS. The core must remain mounted as `auth`.

The initial backend expects an empty application deployment. It does not link or migrate identities from an earlier authentication system. Reused draft databases need an explicit reviewed migration or isolated fixture reset, not optional schema fields or client-selected identity linking. Older round fixtures also need their required `windowStartsAt`/`windowEndsAt` backfilled from the original zoned policy; never widen a window to make stale rounds open.

## Client authentication: current Convex Auth v2 APIs

All names below are **mutations**, except `auth:isAuthenticated` and `viewer:session` (queries), and `accounts:requestDeletion` (action). There is no v1 `auth:signIn` endpoint.

| Function | Arguments and result |
| --- | --- |
| `auth:signUpWithUsernamePassword` | `{ username, password }` → sign-in result; development only. |
| `auth:signInWithUsernamePassword` | `{ username, password }` → sign-in result; development only. |
| `auth:startSignInWithApple` | `{ redirectTo }` → `{ redirect, state }`. |
| `auth:completeSignInWithApple` | `{ state, code }` → sign-in result. |
| `auth:refreshSession` | `{ refreshToken }` → `{ kind: "rotated", tokens }` or `{ kind: "noSession" }`. |
| `auth:signOut` | `{ refreshToken }` → `null`; revokes that session. |
| `auth:isAuthenticated` | `{}` → whether Convex Auth still has the token's session. App availability/onboarding is checked by `viewer:session`. |

A sign-in result is `{ status: "complete", tokens: { accessToken, refreshToken, refreshTokenExpiresAt, userId } }` or `{ status: "error", userError: { error, ... } }`. Persist refresh credentials securely, refresh before the access token expires (default lifetime 60 seconds), install the access token in the Convex SDK, and use it as the bearer for authenticated upload HTTP requests. Never send `userId` as the viewer. Core `isAuthenticated` is session liveness, not a bypass for app authorization.

The development recipe's method name is `usernamePassword`; it is not an anonymous provider. Its endpoints and callbacks require **exact** `TAKE_DEPLOYMENT_ENV=development`. Missing, empty, differently cased and production values all deny it. Existing development sessions, direct content operations, old playback grants, public avatars and notification targets are also denied outside development. A claimed provider or user id cannot change the account's server-owned method. Passwords must have at least 10 characters; use separate test accounts, never public production credentials. Display-name/unique-username onboarding remains a separate `profiles:completeOnboarding` call.

For Apple production sign-in, configure a real Services ID and key in your Apple developer account:

| Variable | Meaning |
| --- | --- |
| `AUTH_APPLE_CLIENT_ID` | Apple **Services ID**, not the native bundle identifier. |
| `AUTH_APPLE_TEAM_ID` | Developer team ID. |
| `AUTH_APPLE_KEY_ID` | Sign in with Apple key ID. |
| `AUTH_APPLE_PRIVATE_KEY` | The `.p8` private key, server-only. |

Apple has no static client secret here; the component signs a short-lived one for token exchange. Its method name is `apple`. This is **browser OAuth only**: the installed provider does not exchange a native `ASAuthorizationAppleIDCredential.identityToken`. Register `<CONVEX_SITE_URL>/oauth/apple/callback` as an Apple return URL and its domain on the Services ID. Apple rejects localhost/IP return URLs. Keep real private keys in the deployment's secret configuration, never git, shell history or iOS.

### Fixed iOS relay

Convex Auth v2 allows HTTP(S) redirect origins, not `take://` allowlist entries. The app reads the configured HTTP site origin separately from the `.convex.cloud` SDK URL; the backend allowlists its built-in `CONVEX_SITE_URL`. The native flow is:

1. Generate and retain a cryptographically random 32-byte base64url **relay nonce** (43 characters). Call `auth:startSignInWithApple({ redirectTo: "<site>/auth/ios?state=<relay-nonce>" })` and separately retain its returned **OAuth state**.
2. Open the returned `redirect` in a browser authentication session with the app's fixed `take` callback scheme. Apple's return URL is `<site>/oauth/apple/callback`, not the custom scheme.
3. The component exchanges Apple's code, stores its own encrypted one-time ticket, and redirects to `/auth/ios?state=<relay-nonce>&convexAuthCode=<one-time-code>` (or `convexAuthError`). The relay redirects only to `take://auth/convex?state=<relay-nonce>&code=<one-time-code>` (or `error`).
4. Compare the returned relay nonce to the saved nonce. Reject mismatches or unsolicited callbacks. Then call `auth:completeSignInWithApple({ state: <saved-OAuth-state>, code: <returned-code> })`; do not confuse the two state values. The component validates and consumes the ticket against the saved OAuth state.

`/auth/ios` is stateless: it reads/writes no database or cookie and logs no code, nonce or token. It requires exactly one 43-character base64url relay state and exactly one similarly shaped code or allowlisted error (`access_denied`, `expired`, `oauth_error`). Missing, duplicate or malformed required parameters return **HTTP 400, no Location header**. It ignores arbitrary destination parameters, never forwards them, and redirects only to the fixed `take://auth/convex`. Every relay response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The relay only checks nonce shape; the client performs the saved-nonce comparison, and Convex Auth independently validates the actual OAuth state. Redact callback query strings at external proxies; do not enable URL/body logging there.

## Account deletion and disable

`accounts:requestDeletion({})` requires fresh authentication **to the same account**. The client repeats Apple browser sign-in or development password sign-in, replaces its session with the newly returned tokens, then calls the action. The server resolves the current verified session and checks its stored creation time is within five minutes; refresh never changes creation time. An older session receives `REAUTH_REQUIRED`. No client-supplied timestamp or JWT `auth_time` is trusted.

The internal deletion transaction sets the user to `deleting`, erases the visible profile/preferences, revokes every Convex Auth session and refresh credential, and schedules cleanup atomically. Old signed access tokens immediately stop resolving to an app user. Cleanup removes assets, content, friendships, requests, blocks, receipts, devices, grants and authored reports in batches, then marks the job `complete` and user `deleted`. The minimal app tombstone and Convex Auth method/account binding remain intentionally reserved: sign-in callbacks reject them, so new sign-in or signup cannot resurrect the account. No upstream identity-deletion credential or external deletion queue exists. Apple's own account is not deleted or claimed to be deleted.

Administrators may call internal `admin:setDisabled({ userId, disabled: true })` through authorized Convex administration. The app immediately denies existing sessions/grants while disabled. Re-enabling an ordinarily disabled account is allowed; a deletion tombstone cannot be reactivated. Normal clients cannot call internal administration.

## Application variables and trusted media verifier

| Variable | Use |
| --- | --- |
| `TAKE_HTTP_ORIGIN` | HTTPS application HTTP origin without a trailing slash; configure the native HTTP origin separately from its SDK URL. |
| `MEDIA_VERIFIER_ORIGIN` | Trusted worker HTTPS origin without path/trailing slash; required only to enable media verification. |
| `MEDIA_VERIFIER_SECRET` | Random shared server-only secret of at least 32 characters; matches worker `VERIFY_SHARED_SECRET`. |
| `TAKE_ROUND_TIMEZONE` | IANA zone; defaults to `America/Los_Angeles`. |
| `TAKE_ROUND_START_HOUR`, `TAKE_ROUND_END_HOUR` | Half-open local-hour window; defaults to 10 and 20, integer 0–23, start < end. |
| `TAKE_DEPLOYMENT_ENV`, `TAKE_ALLOW_DEV_SEED` | Use `production` and `false` in production. The former never defaults to development. |
| `CONVEX_DEPLOY_KEY` | Deployment credential, not a runtime or client value. |

Deploy `verifier/` as the included nonroot, resource-bounded container behind authenticated HTTPS. Its README specifies image/build, CPU/memory/process/temp limits, ingress bounds, concurrency and shared-secret delivery. Convex sends actual stored bytes plus SHA-256; the worker hashes and fully decodes those bytes, validates the media, and returns matching-hash trusted metadata and generated JPEGs. Convex independently bounds the response and rechecks validity and <=15,000 ms before atomic publication. No worker or bad configuration means `PROCESSING_UNAVAILABLE`, no receipt and no unlock.

Set the ingress cap for TAKE video to at least 8 MiB and avatar input to at least 2 MiB, with a strict service ceiling of 20 MiB. The worker never fetches client URLs. Terminate TLS correctly; redact bodies, authorization and private grant URLs from logs. Do not CDN-cache private `/v1/media/` routes. Scale bounded worker instances rather than removing limits; overload must fail closed.

## Explicitly unavailable push delivery

The app registers its hex-encoded APNs device token via `devices:register({ installationId, token, platform: "ios", notificationsEnabled })`, updates it on rotation, unregisters on sign-out, and never uploads contacts. Tokens remain server-private and opaque, bounded to 1–4096 characters. The shipped `lib/pushProvider.ts` always returns `unavailable`, sends no network request and creates no successful delivery receipt. There is no APNs transport, production success stub, or push credential needed for deployment.

A future trusted **APNs HTTP/2 worker** can enter through internal `push:claimForWorker({ jobId })`, receiving a lease and token-free `{ id }` batch, cursor and completion marker. Immediately before each send it must call internal `notifications:target({ jobId, deviceId, lease })`; this rechecks active account, permission, preferences, current round and direct-reply visibility. Only this trusted server path receives a token. It then calls `notifications:finishAttempt({ jobId, deviceId, lease, token, outcome })` with `sent`, `invalid-token` or `unavailable`, and `notifications:progress` with the returned pagination state. No normal client or public credential/token endpoint exposes these functions. This is an integration boundary, not an implemented external worker.

Jobs use bounded retries and per-device receipts, so successful targets are skipped on retry. Every raw page has at most five claims, including crashes; exhaustion advances to the next raw page with a fresh budget. An exhausted final page remains unavailable. Leases fence stale workers and cron recovers interruption, including the fifth-claim crash. Permanent-token retirement compares the failed token to the current stored token, preserving concurrent rotations. Receipts expire after 30 days or account deletion. A crash after a future external send but before receipt persistence may duplicate a generic alert; exactly-once remote delivery is not claimed. Generic payloads contain routing IDs but no author, opinion, thumbnail or transcript, and a tap must re-fetch authorized state.

## Planning and launch checks

`planner:plan` is internal and maintains the next three eligible local dates. The hourly cron preserves zoned windows, skips elapsed plans and closes the current round only when a valid successor opens. `CONVEX_DEPLOYMENT=dev:<name> npm run seed:dev` additionally requires exact development mode and `TAKE_ALLOW_DEV_SEED=true`; it creates plans, never users, media, receipts or an auth bypass. Offline native fixtures remain separate.

Local verification covers real Convex Auth component signup/signin/refresh/signout, tombstones/revocation, production development-session denial, the stateless relay, privacy/publication/media/planner invariants and unavailable push. The separate media suite runs actual HTTP and FFmpeg, and the verifier tests adversarial decoding. A real local Convex HTTP smoke also verifies signed JWT acceptance and session deletion; it is not a cloud result.

Before production, verify real Apple browser OAuth and iOS callback/configuration on the deployed site, invalid/expired JWT rejection, real authenticated upload→hosted TLS verifier→receipt→private playback, social/grant revocation, round scheduling and load/retention/logging controls. Remote push requires implementing and verifying the APNs worker on a signed physical device; it is unavailable today. No simulator, local test or successful deployment proves those external behaviors.
