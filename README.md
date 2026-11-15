# Reals

A native iPhone app for a daily video opinion. Pick a position, post a 3–15-second take, then see that round's conversation. Friends-only is the default; the requested next version adds opt-in public takes, For You, likes, comments and battles.

## Current delivery

The independent PRs are [native #2](https://github.com/mehmetuzgoren/reals/pull/2), [backend #3](https://github.com/mehmetuzgoren/reals/pull/3) and [docs #1](https://github.com/mehmetuzgoren/reals/pull/1). This docs-only branch does not copy application source.

**The Convex development deployment is live; its media verifier is not hosted.** Development sign-in is available, Apple sign-in is deliberately unavailable with bootstrap placeholders, and live media publication must fail closed. The eight-screen mock-exact Reals UI and v4 social features are still being implemented; older screenshots are not evidence of that version. See [exact verification status](docs/verification-status.md).

On the native checkout, open `ios/TAKE.xcodeproj`, select the shared `TAKE` scheme and an iOS 18+ iPhone simulator, build and choose the demo. It needs no account, deployment or secrets. Internal target/bundle names may remain `TAKE` / `com.take.app`. The last executed artifact still says **Explore Demo Mode**; the replacement mock calls this **Try the demo**. [Setup](docs/setup.md) separates the runnable current source from the pending mock build.

## Architecture and access

- SwiftUI, AVFoundation capture and AVKit playback, with isolated Demo and production services/storage.
- Convex application data, trusted functions, storage, scheduling and **Convex Auth 2.0.0**. Apple uses browser OAuth through a fixed HTTPS relay; username/password is development-only.
- APNs token/preferences are stored privately, but remote notification delivery is explicitly unavailable until a real worker is supplied.
- Revyl owns macOS native builds and the cloud-iPhone lane. Linux syntax/tests do not prove an iOS build, physical camera or audible playback.
- Whop is future payments only; this version has no subscriptions, payments or paywall.

Only server-confirmed original publication unlocks the same round. Failed uploads, previews and replies do not unlock it. Deleting an original preserves its receipt and one-original limit. The main feeds contain originals, not replies. Friends-audience replies keep the parent-first intersection rule: posted Casey sees Blair's reply on Alex; posted Dana, friends only with Alex, does not.

The new public audience does not remove same-round publication or block checks. [Privacy rules](docs/security.md) distinguish the current v3 backend from the [published v4 wire contract](docs/wire-v4.md), whose implementation is still pending.

## Run the verification tools

```sh
node --test verification/*.test.mjs
node verification/check-docs.mjs
node verification/deployment-probe.mjs verification/deployment.example.json
```

The first two commands test tooling and links. The third makes real, unauthenticated requests to the live development deployment: auth guards, the fixed relay, unavailable Apple setup and invalid-media denial. It needs no secret and creates no user or fixture. It does **not** prove signed-in access, real Apple OAuth or valid media delivery.

The separate [authenticated privacy/media probe](verification/README.md) requires dedicated published fixtures and short-lived Convex Auth access tokens. It remains blocked by the missing hosted verifier/fixture lane. See the [acceptance matrix](verification/acceptance.md) and [test lanes](docs/testing.md). Never commit credentials, private media, sessions or playback grants.
