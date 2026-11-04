# Revision 2 Validation Environment

The revision-2 runner imports the source-inspected task isolation primitives
without changing their filesystem guard, source/dependency copying, owner-path
checks, deadline/exit handling or process cleanup. It uses a distinct owner kind
and fresh `rev2-*` runtime snapshots; historical receipts remain unchanged.

Pinned Node is the already installed v24.22.1 executable named in `isolated.py`.
No dependency install, actual dotenv, user credentials, live provider/database
or production app is used. Node starts with a clean OS-allowlisted environment,
synthetic home/temp, exact public-example exception and copied dependencies.
Prisma output is confined to those copies.

Only build-lane children receive `CIRCLE_NODE_TOTAL=3`. The installed Next
config CPU formula is checked before applying that two-worker resource bound;
the complete original Next build still runs. Tests receive neither this variable
nor build-only APP_URL. This is local validation, not production capacity proof.

Current authored task scripts are copied for root-lint scope. Historical
`evidence/` directories are omitted from snapshots; they are machine receipts,
not source inputs. Each run has unique receipts and source pre/post hashes.
Main and implement/check agents serialize heavy work against the runtime lock.

Browser validation uses a separately prepared current-source route-shell
fixture, native IndexedDB, dummy loopback HTTP/catalogue/media and a dedicated
headless browser profile. Actual UI/lib/contracts/styles/assets are hash-bound.
OS chooser/download/IME, physical phones, live services, paid generation and
actual remote CI are separate, unperformed acceptance boundaries.
