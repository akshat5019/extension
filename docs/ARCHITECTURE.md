# Architecture and storage replacement

The extension has four trust-separated components:

- `src/ui/App.tsx`: React popup/workspace, paged search, profile selection, reviewed import and confirmed edits.
- `src/background.ts`: extension-page-only runtime RPC and one-time legacy migration. Messages from tabs/content scripts are rejected for database operations.
- `src/core/repository.ts`: `ProfileRepository` contract and `LocalRepository` using Dexie/IndexedDB. No DOM or parsing concerns enter this layer.
- `src/content.ts`: user-injected form snapshot, conservative mapping, profile-bound filling, manual-edit capture and conditional undo. It has no database access or startup profile requests.

`src/core/documents.ts` orchestrates local PDF/DOCX reads and a cancellable parsing worker. `src/document-worker.ts` reads TXT/CSV/XLSX/JSON. `extraction.ts` separates records; `mapping.ts` implements `FieldMapper`; `ai.ts` implements optional `IntelligenceService` using an opt-in on-device model. Browser APIs are confined to orchestration/UI and background/content boundaries. Existing local parsing libraries are bundled; no CDN scripts are loaded.

`pdf-layout.ts` reconstructs horizontal text lines from page coordinates, rejoins adjacent glyph fragments and separates wide columns. It sends temporary prominent heading hints to the extraction worker. `name-detection.ts` excludes common job/section titles and uses a heading or nearby contact identity to suggest a resume name. Hints only apply to names present in the current record, and conflicting identifiers suppress header inference. Ambiguous candidate names are presented as bounded selectable suggestions in the reviewed import UI; they never trigger a database write or merge. No filename/email-derived names are generated. Geometric/font heuristics are not proof of identity, and unusual or rotated layouts still require source review.

## Database and schema

Database `personal-assist-v2`, IndexedDB version 1:

| Store | Keys/indexes | Contents |
| --- | --- | --- |
| profiles | id, updatedAt, status, multi-entry searchTokens | Person fields, sources, timestamps, revision and schemaVersion |
| documents | id, unique fingerprint, importedAt | File reference/name, hash, import count and warnings; no raw bytes |
| settings | key | Version/migration markers and legacy answer archive |

`Person.fields` is a validated flexible dictionary of strings or alternate arrays. Known fields use canonical keys; additional fields use `custom:<normalized label>`. Sensitive/prototype keys are removed at the storage boundary. Multiple values intentionally do not silently choose a winner during autofill. Sources list document/manual-edit provenance and affected field keys with timestamps, capped at the latest 100 source entries. Revision numbers enforce optimistic concurrency.

Search normalizes Unicode/case and indexes character n-grams (lengths 1–3) across a bounded searchable projection, including digits-only phone variants. Queries use an IndexedDB index and verify matching rows with a cursor filter; only the requested page is returned. The interface renders 20 rows, never every profile. Frequent short queries may scan many matching index candidates to count results, but do not materialize the full dataset in the UI. Export is a separately confirmed full-dataset operation. Potential duplicate hints are bounded to 50 candidate results per identifier; they never cause an automatic merge.

Import is staged in UI memory. Confirmation runs a single transaction over profile/document stores; any stale revision or unresolved conflict aborts all writes. File SHA-256 fingerprints prevent repeated commits. Reloading during staging loses only the staged draft; interrupted transactions cannot leave a half-import. Repeated updates to the same target in one batch can produce a stale-revision error: consolidate the records or split into reviewed batches.

## Replace or supplement local storage

1. Implement the methods of `ProfileRepository` in a remote adapter: `search`, `get`, `save`, `remove`, `matches`, `merge`, `all`, `stats`, `clear`, `getSetting`, `migrateLegacy` and `commitImport`. Imports and legacy migration are part of the same repository contract; background code does not depend on Dexie tables or transactions.
2. Inject the adapter at the composition point in `background.ts`; keep UI's versioned `DB_*` messages stable. Do not give content scripts access to credentials or repository queries.
3. Preserve UUID profile IDs, schemaVersion, created/updated timestamps and expected revision checks. Enforce field validation on the server too. Map multi-record import/merge to server transactions and idempotency keys.
4. Translate indexed paginated search into the server's full-text/trigram/phone indexes. Keep page sizes bounded. Preserve potential-match review; never merge by name alone.
5. For a future PostgreSQL service, define separate profiles/field-value/source/document/import-operation tables or validated JSONB fields with appropriate indexes. Authentication, authorization, data-sharing consent and transport protections are prerequisites, rather than implied by a repository swap.
6. If synchronization is introduced, maintain an offline outbox and server change cursor. Conflicting revisions need explicit replace/keep-both/unchanged decisions; avoid last-write-wins for different people. Support tombstones for deletion, recovery and reauthentication. Add an explicit cloud opt-in with disclosures before transmitting any personal data.

A repository adapter must preserve transactions and conflict semantics, not merely reproduce CRUD. No remote credentials, URLs, account flows or pretend cloud buttons exist in this initial release.

## Versioning and migration

The profile envelope and JSON export carry `schemaVersion: 1`. For a future schema change, add a Dexie `version(2).stores(...).upgrade(...)` migration and a corresponding export/import version converter. Migrations should be idempotent, transactional, validated and tested against old databases/backups. Current JSON import stages fields into new candidate profiles, with duplicates reviewed; it does not blindly replace the database or reuse foreign IDs.

The 1.x upgrade is a one-time guarded transaction: the old single Chrome-storage profile becomes a review-needed person. Generic old answers are archived in settings and exports. Existing automatic registrations are retired. Future schema upgrades must keep this archive or offer an explicit reviewed conversion. Backups are JSON and include full profile envelopes/sources; reimport currently creates new source references to the backup and restores fields, rather than replaying arbitrary historical metadata.

## AI and site adapters

`IntelligenceService.extract(text)` returns candidates plus warnings. The standard implementation is local parsing. Optional `OnDeviceIntelligence` checks model quotes and treats all model person associations as uncertain. The native Chrome Prompt API is availability-dependent; its contract and error handling are tested, not native model accuracy. A future remote implementation needs explicit consent and a clear disclosure of transmitted data.

`FieldMapper` is separate from persistence and uses labels, accessible names, autocomplete and reviewed custom keys. Add site adapters behind this boundary for complex controls without weakening selected-profile, current-snapshot, no-overwrite, sensitive-field and no-submission rules. Documents and website labels are data; they cannot modify these rules.

`src/site-adapters.js` supplies portal-specific label conventions and exact native-field identifiers, with generic fallback and explicit label precedence. `src/form-tree.js` bounds traversal to 100 roots and 2,000 fields, including open shadow roots and accessible same-origin/inherited-origin iframes. Cross-origin/sandboxed documents are counted but never read. Snapshots bind elements to their root, document URL, label/key/type and top-level scan URL; embedded navigation invalidates previous mappings. Native setters/events use the owning window, composed events cross open component boundaries, and trusted edit listeners use the original event path. Only the selected profile is passed to these controls after a user fill; the traversal does not expose database access. Custom dropdowns remain manual instead of accepting unselected free text. See COMPATIBILITY.md for fixture coverage and live-site limitations.
