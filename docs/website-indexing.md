# Website indexing

The website index is prepared outside the conversation request. Crawling and PDF parsing make no model calls. GPT continues to receive bounded retrieved excerpts and source-owned assets from Postgres through the existing conversation path.

Retrieval prioritizes complete named phrases, samples at most eight library passages with page diversity, and passes up to three matching image candidates per library passage. The existing curated catalog remains available within the overall 24-source bound. This keeps a larger corpus from flooding the model with repeated page assets or incidental endpoint mentions.

## Refresh a bot

Use Node 22.19+ or Node 24 and install the repository dependencies. On Windows, enable the system certificate store if a manufacturer uses a certificate chain absent from Node's bundled CA store; do not disable TLS verification.

```powershell
$env:NODE_USE_SYSTEM_CA='1'
npx tsx scripts/index-medical-website.ts nubeqa C:/reports/nubeqa.json
npx tsx scripts/validate-website-index.ts C:/reports/nubeqa.json
./scripts/import-website-index.ps1 -SnapshotPath C:/reports/nubeqa.json -ReportDirectory C:/reports/import
```

Repeat with brukinsa or padcev. The import script uses a Windows-user-encrypted admin credential and never writes bearer tokens to reports. Configure ADMIN_PASSWORD and ADMIN_SESSION_SECRET on the API first. On other systems, use the same authenticated admin endpoints with an appropriately protected credential store.

The crawler follows same-site links and up to 12 sitemaps, plus first-party source-pack seed URLs. Only PDFs actually linked by those pages may be downloaded from the explicit manufacturer document hosts in WEBSITE_PROFILES. Redirects remain constrained to approved HTTPS domains. Crawls are bounded to 180 resources, 24 MB per resource and 150 pages per PDF; bounds, extraction failures and empty/image-only pages are reported. Coverage means the discovered eligible site graph, not a guarantee that every unlinked, gated, scripted or image-only resource is indexed. HTML tables retain column separators; PDF extraction retains page provenance but is not visual/OCR validation. Review material with complex layouts before relying on extracted numbers.

Snapshots include raw extracted text, source/discovery URLs, hashes, figures, issues and timestamps. Validate before importing. Import is transactional and serialized per bot. Unchanged pages retain IDs; changed crawler-owned pages receive new versions, while old rows/chunks/assets are archived and retained. Pages missing from a subsequent crawl are not automatically deleted or archived. Manually imported content and curated cards remain untouched. The DRAFT crawl-report document records created and archived IDs for targeted rollback and never enters active retrieval.

Authenticated endpoints:

- GET /admin/source-library/export?surveySlug=nubeqa — complete evidence backup.
- POST /admin/source-library/website-index — validate and import a snapshot.
- GET /admin/source-library/website-index/reports?surveySlug=nubeqa — latest persisted coverage reports.

The PowerShell importer saves a pre-import backup and verifies the active index afterward. Its repeat run should return zero newly created pages for the same snapshot. Do not use the legacy replaceExisting bulk import to refresh these indexes.

The admin Source Library includes website setup and automatic refresh controls. Saving a website creates a durable queued initial index; scheduled refresh is enabled weekly by default (daily/weekly/30-day options). Refresh now queues the same pipeline. Operators configure the survey slug, root website and exact approved website/document hosts without changing code. A new survey still needs its authored interview guide and launch acceptance checks.

The API worker checks persisted DRAFT configuration documents every 30 seconds, claims jobs with a compare-and-swap write, and runs one crawl at a time per process. A two-hour lease recovers interrupted work across restarts; failed crawls retry after 24 hours. Configurations, run outcome and next-run timestamps live in Postgres. Control records never have retrieval chunks. Every successful run uses the versioned importer, keeping former source versions and recording a coverage report. Download sockets are pinned to validated public IPv4 DNS results and TLS verifies the original hostname; every redirect must remain within the approved profile. A failed root leaves the previous index intact.

The scheduled crawler is the same module used by the CLI, including image and structured HTML table extraction. No conversation-time crawling or extra model calls are introduced. The UI shows status, page/image/table counts, next run and crawl issues. Incomplete crawls preserve absent pages; a completed run can still have reported coverage gaps. Search currently uses Postgres full-text retrieval, not an external vector store.

HTML data tables are also indexed as typed cells, row/column spans and nearby notes. Their immutable source-owned SVG views are served from `/website-tables/:hash.svg` using persisted metadata, with no live website fetch or model call. They participate in the same answer selection and carousel as image assets. The renderer escapes all text and retains captions, column groupings and footnotes. It redraws the website table in the application style rather than claiming to be a screenshot.

For an existing index, `npx tsx scripts/refresh-website-tables.ts <snapshot.json> <table-refresh.json>` extracts tables from those approved HTML URLs and verifies their cell text still occurs in the indexed evidence. Import the resulting partial snapshot through the normal backed-up importer. A page whose evidence changed requires a full refresh. The import retains older versions for citation replay.
