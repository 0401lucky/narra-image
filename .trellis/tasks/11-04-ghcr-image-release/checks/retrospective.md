# Bug Analysis: Clean CI Prerequisites

## 1. Root Cause Category

- E / Implicit assumption: a developer's generated Prisma Client was present
  locally, but dependency installation did not guarantee that output before CI's
  first TypeScript stage. Generating only inside the later build was too late.
- E / Implicit assumption: default pg_isready used the official PostgreSQL
  image's temporary initialization Unix socket. That server could report ready
  and then shut down before the first CREATE DATABASE.
- D / Coverage gap: warm local dependencies and an undifferentiated readiness
  mock did not distinguish either clean-start condition.

## 2. Why Previous Runs Stayed Red

The two observed Actions runs repeated those unchanged assumptions. This task
does not assert that an earlier attempted fix failed. Both defects appeared
before the later gates could provide useful evidence; passing local canvas tests
was not evidence that a clean CI runner could complete the release workflow.

## 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Stage contract | Explicit Prisma generation before tsc; failure stops the chain | Done |
| P0 | Readiness contract | Probe final container TCP 127.0.0.1:5432, not the init socket | Done |
| P0 | Regression | Missing-client negative, real generation and positive tsc | Passed |
| P0 | Regression | Socket-ready/TCP-not-ready mock and three immediate real CREATE/query cycles | Passed |
| P1 | Environment lanes | Synthetic production build variables stay out of preceding tests | Passed |
| P1 | Release gate | No registry publication when any required validation fails | Covered locally |

## 4. Systematic Expansion

The separate worker-contracts DB runner has its own socket-only readiness loop.
It does not use the shared helper and is not one of the three publication gates.
The independent reviewer identified it; main explicitly deferred that existing
risk rather than silently expanding this approved release task.

Real GHCR bootstrap/public access, clean hosted CI and production deployment
remain distinct from these local regressions. Do not relax deadlines or gates
to turn a new infrastructure failure into a green release.

## 5. Knowledge Capture

- Updated operations/release-hardening with explicit generation and TCP probe.
- Added operations/image-publishing with command signatures, token/image
  contracts, public bootstrap, failure matrix and required regressions.
- Retained the independent review, failed checks and current source identities.
