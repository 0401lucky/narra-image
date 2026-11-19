# Bug Analysis: Hidden Ambient Test Environment

## 1. Root Cause Category

- E / Implicit Assumption: the real opt-in generation parser dynamically loads
  canvas/http, current-user, db and getEnv before its JSON media-type check. The
  fixture did not declare the AUTH_SECRET/DATABASE_URL it required at import.
- D / Test Coverage Gap: the local credential-isolated runner supplied safe
  synthetic values globally, masking this missing fixture prerequisite. Hosted
  CI correctly omitted those values during non-DB tests.

## 2. Why Earlier Checks Missed It

Earlier hosted CI stopped at Prisma generation/typecheck. After that independent
prerequisite was corrected, the 1,824-test run reached this previously hidden
failure. Local synthetic isolation protected real credentials but was not proof
of absent-variable behavior. No previous product fix is reverted or blamed for
the fixture's undeclared import dependency.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Fixture ownership | Suite-local vi.stubEnv and vi.unstubAllEnvs; retain real parser assertions | Implemented |
| P0 | Discriminating regression | Old source fails, fixed source passes, isolated old-source reversion fails with both ambient variables absent | Independently verified; absence/value restoration and missing-cleanup control also pass |
| P1 | Review/check contract | Distinguish credential-safe synthetic inputs from clean CI prerequisites | Added to frontend quality spec |
| P1 | Full regression | Full non-DB run without ambient AUTH_SECRET/DATABASE_URL | Independent 144 files/1,824 tests pass |

## 4. Systematic Expansion

Any parser/service test with a transitive auth/db import can require environment
validation without actually querying the database. Prefer fixture-owned inputs,
restore missing as well as pre-existing variables, and check the complete test
inventory in the corresponding absent-variable lane. Do not globally add
production-shaped test defaults or change application validation to make a test
pass. The actual hosted run passed 1,823 other tests; no broad rewrite is needed.

## 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with setup/restoration,
  absent-variable process checks, the real import chain and assertion matrix.
- This application has no `src/templates/markdown/spec` tree to synchronize.
- Spec and this record belong to the correction batch; commit approval is not
  inferred from the already delivered original two-commit batch.
