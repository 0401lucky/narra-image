# Task Artifact Retention

Task requirements, designs, execution plans, source-bound result JSON,
hash manifests, review reports, regression before/after bytes and bounded
test helpers are versioned. Production images/fonts and their licenses live
under `public/` and are not affected by task artifact ignores.

Repeated browser screenshots, raw HTML/Flight/network captures, stdout/stderr
logs, duplicate generated image candidates and cached reference binaries are
local verification material. `.gitignore` excludes them from commits without
deleting or modifying the existing files. Result/identity manifests preserve
their provenance and recorded outcomes. An archived task may therefore cite
a raw capture present in the original local workspace but absent from a
fresh checkout; do not claim that absence invalidates or reproduces a run.

Downloaded third-party HTML is also local-only: it may bundle unrelated public
client API configuration. The supplied design references and actual font
license text remain versioned; no third-party key is copied into the app.

Runtime snapshots, dependency copies, browser profiles, dotenv and credentials
are never task deliverables. Use the task's documented credential-isolated
runner to recreate checks. Fetching missing reference caches or downloading
tools is a separate explicit action, not an automatic test fallback.

Archived helpers may contain task-depth-relative roots and historical absolute
paths. Recreate their documented active-task layout before rerunning them;
do not execute an archived helper in place or reuse a snapshot without its
owner, source and dependency checks. Ignored runtime snapshots may remain at
their original local path after archival to preserve absolute dependency
junctions. A directory containing only ignored runtime data, without a
`task.json`, is not an active task.

Original font licenses and retained `.before` snapshots keep their exact bytes.
The narrow `.gitattributes` whitespace exceptions apply only to those originals,
not application source, task helpers or authored documentation. Ordinary source
and notices must pass the default staged whitespace check without exemptions.

ESLint excludes `.trellis/tasks/**` because historical fixtures, reference
scripts and generated snapshots are not application source. The executable
scope regression keeps application components, unit tests, production scripts
and non-task tooling in scope; source lint/type/test/build gates remain
mandatory.
