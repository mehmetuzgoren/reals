# Verification status

## Documentation bootstrap

Baseline: `3151ed0772f208dcb1700580bf85bdeed79c23b2` on `main`, containing only `.gitignore`. No native or backend implementation was present when this documentation was authored. Names drawn from the accepted integration contract are clearly marked pending in [setup](setup.md).

Executed on Linux/Node 24: `node --test verification/*.test.mjs` passed 11 tests, `node verification/check-docs.mjs` checked seven Markdown files with zero missing local destinations, and `git diff --check` passed. The unit tests exercised 25 simulated transport assertions and verified deliberate leak/protocol failure detection. These are tests of the probe, not the product.

Independent read-only review of `ccea43caec359abc55b4fce78ba359e16cb957b4` found two probe blind spots: unvalidated nested Round fields and discarded client-visible log/error fields. Added recursive Round/options checks, strict response/failure envelopes with generic denial text and no client logs, generic media error bodies, and adversarial regressions. Recheck of these corrections is pending; the final reviewed revision belongs in the handoff record. Tooling CI passed at the original head.

No real deployment, iOS build, XCTest, phone session, actual media inspection, or notification delivery ran in this snapshot.

## Gates awaiting implementation handoff

| Gate | Required handoff / evidence |
| --- | --- |
| Source/config reconciliation | Native/backend PR URLs and full head SHAs; actual package scripts, config readers, schema/indexes, seed, media verifier contract, payload/deep-link keys. |
| Native build/tests | Native owner's succeeded Revyl build and XCTest evidence, installable simulator artifact or managed build reference, bundle ID/runtime. |
| Final cloud-iPhone loop | One REAL-7 session installing that artifact; screen evidence and exact steps/limits. |
| Live backend acceptance | Dedicated deployment/site URLs, internal seed command and opaque fixture IDs, real staging Firebase tokens supplied securely, verifier availability. |
| External auth/push | Apple team/bundle/provider setup, signing/APNs/FCM credentials, successful real identity and remote delivery checks. |
| Physical capture | A connected signed iPhone and actual camera/audio/orientation/interruption observations. |

None of these pending rows is implied by the probe's mock transport tests. [Acceptance criteria](../verification/acceptance.md) remain the behavior gate.
