# Performance improvements in 2.3

The popup loads packaged document readers only when their format is used. Standard DOCX, CSV, TXT, XLSX and JSON processing runs in a module worker; PDF uses PDF.js's local worker. File bytes are read/hashed once. Profile searches choose a selective existing index and count/page in one verification pass. Duplicate review uses direct identity indexes and bounded batch lookup reuse. No persistent profile cache can become stale after edits.

**Scan & fill** reduces the selected-person workflow to one action. It always scans again, checks the profile revision and ignores answers staged for an older scan. Existing values, sensitive-field protections, confirmed learning, undo and manual submission remain in place.

## Reproduce

```sh
npm ci
npm run build
npm run benchmark
npm test
npm run test:browser
```

The benchmark creates a disposable fake-indexeddb database with 300 synthetic profiles, runs 50 selective searches and 50 individual duplicate lookups, then analyzes the same 50 records as a batch. It checks the returned identities and deletes the database. Startup bytes count the app and its complete static import graph from esbuild's metadata, excluding lazy imports. Real browser workflow tests separately exercise the modules, parsers and IndexedDB.

Observed in this cloud workspace:

| Measurement | 2.2 baseline | 2.3 |
| --- | ---: | ---: |
| Startup JavaScript, uncompressed bytes | 1,026,411 | 292,231 |
| 50 selective profile searches | 4,475 ms | 60 ms |
| 50 individual duplicate lookups | 12,437 ms | 18 ms |
| Batch review of 50 records | Not measured | 13 ms |

Startup JavaScript is about 72% smaller. These timings are synthetic observations, not a guarantee of Chrome latency or the same speedup on every device. Broad one-letter/name searches still need to count their matches. First use of a reader loads its bundled local module. The full package remains larger than startup code because it includes all readers, PDF assets and fonts. Native unpacked installation and authenticated portal latency require local Chrome testing.

## Immediate resume-to-application flow

Version 2.4.0 removes the separate selection and scan steps after a reviewed single-person import. **Confirm import & autofill** obtains the saved profile by its transaction receipt, reads and revision-checks that person, injects the existing detector, scans the current page and fills it immediately. No artificial debounce or delay is added to this action. Document extraction finishes before confirmation; upload/parse time is separate from filling time. Existing startup and indexed lookup optimizations remain.

Completion within one second is a goal on simple forms, not a guarantee: document parsing, Chrome scheduling, site rendering, permissions, custom controls and missing values can take longer or require manual action. Tests verify the combined workflow and safety without flaky time limits. Multi-person imports require selection, and applications are submitted manually.
