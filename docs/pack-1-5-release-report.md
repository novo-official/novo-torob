# Pack 1.5 release report — real-data recovery & regression restoration (2026-10-23)

Status: **PARTIAL — real-data checks PASS locally; Docker runtime NOT VERIFIED; Liara NOT DEPLOYED; BoxAPI LOCKED.**

## Real data (found, not generated)
| item | value |
|---|---|
| ZIP | `.data/torob-dataset.zip`, 60,178,644 B, sha256 `37a25fbd4cdb30aec265d6367e7ebafd8673364ffc90e74411a5f13cd7d94013` (equals `sourceSha256` recorded in the DB's import run) |
| DB | `data/app.sqlite`, 827,924,480 B, sha256 `47225ae564418042bc6f558e0653f63d3fb570228460074e0f43b4a99b156de5`, mtime 2026-10-21 22:50 (unchanged before/after all work) |
| counts | 225,903 products · 6,476 shops · 331,506 offers · 0 orphan offers · integrity_check ok |
| import run | importer 2.0.0, rules qf-2026.1, snapshot 2026-10-13T00:02:35Z |
Neither file was written, regenerated or replaced. `db:verify` opens read-only.

## Results (real catalog unless labelled)
| check | result |
|---|---|
| `tsc --noEmit` / `npm run lint` | clean / 0 warnings |
| `npm test` (vitest) | 62 files, **886 pass, 0 fail, 0 skip** (historical ref: 871) |
| `npm run db:verify` (real) | ALL CHECKS PASSED; `db:verify:fixture` also green (fixture, separately) |
| `npm run build` | standalone OK |
| `npm run agent:eval` (mock, real DB) | **80/80** scenarios, 176/176 checks, externalCalls 0, costUsd 0 |
| `npx playwright test` (real catalog) | **400 pass, 0 fail, 0 flaky, 111 skipped** (historical ref: 393) |
| skips by cause | 55 `assistant-missions` + 43 `sellers-experience` + 11 `search-experience` = synthetic-fixture opt-in; 1 live-evidence opt-in; 1 smoke "database absent" |
| fixture suites (SYNTHETIC, not real evidence) | `qa:search` 11/11, `qa:sellers` 43/43, `qa:assistant` 55/55 |

Real IDs exercised (all join correctly):
- Dahua camera `product_7308febc43c2f793fd0e1cf9` — 21 offers, e.g. `offer_c5e7b056b065d44e66fe1351` @ `shop_0ca1ab09d6a27d703e3ea4a0` 2,480,000 toman
- Electrogen pump `product_068bab0f4321e4133a559a8b` — 1 offer `offer_5f3e0f8434a39c8cdaf8b216` @ `shop_511abe128c6133cff4708878` 21,600,000
- JD8500 generator `product_50fe6f6cf6e774e95d575e88` — 1 offer `offer_28ac4b1e1fe8e244cbc62828` @ `shop_6ab9920d37ebf8304670304d` 130,000,000

## Regressions found by the first real-data run after the redesign (10 failures) and fixes
| # | cause | kind | fix |
|---|---|---|---|
| 1 | assistant example chips 40 px high (< 44 px target) | **product bug** | `.exampleChip` min-height 2.75rem |
| 2 | `/assistant` CLS 0.136 at 390 px (skeleton shorter than page, footer jumps out of view); intermittent | **product bug** | `assistant/loading.tsx` reserves viewport height |
| 3 | "مشاهده فروشنده‌ها" substring-matches the new header CTA "…اطراف" (5 specs) | stale selector | `exact: true` |
| 4 | advisor label renamed to «شرح نیاز خرید» (4 specs) | stale selector | role/name selector |
| 5 | keyboard spec targeted the intentional `tabindex=-1` image link | stale selector | target focusable link |
| 6 | discover keyboard test tabbed into the loading shell | test race | wait for radiogroup |
Nothing was hidden behind a skip.

## Hygiene changes
- All e2e/scripts QA output → git-ignored `qa-artifacts/` (`QA_OUTPUT_DIR=docs/qa` is the explicit opt-in to refresh tracked references). `docs/qa/**` tracked files untouched (`git status docs/qa` clean). Regression test: `src/server/deploy/deploy-config.test.ts`.
- Missing real catalog now prints a **BLOCKED: AWAITING REAL DATA** banner (vitest + Playwright global setup) and `scripts/release-gate.sh` exits 3 / sets `REQUIRE_REAL_CATALOG=1`. `assistant-missions.spec.ts` no longer crashes at import in a clean clone and is gated to the synthetic project. Skip reasons standardised (`requires real catalog …`, `explicit synthetic-fixture opt-in …`).
- `.dockerignore` / new `.liaraignore` / `.gitignore` exclude data, env, DB and QA artifacts.

## Not done / not verified
- **DOCKER RUNTIME NOT VERIFIED.** `node:24-slim` is not local (only `node:24-alpine`, `node:22-alpine`); no pull was made. Existing `novo-torob-app:latest` was built 2026-10-22 18:39, before the redesign, so it proves nothing about current code. Request to owner: pull `node:24-slim` (docker.io/library, ≈75 MB compressed / ≈230 MB on disk), then run the documented compose flow with an isolated volume; local smoke matters because the Liara variant shares its stages.
- Liara: templates only (`deploy/liara/`, `.liaraignore`, `docs/liara-readiness.md`). Prices, FTP size limits, edge header behaviour unverified.
- The 4-viewport × light/dark audit is covered by `redesign-shell`, `a11y-routes`, `screens`, and the fixture suites; no new visual review was performed by a human.
- Nothing committed, pushed, deployed, downloaded or uploaded; no BoxAPI/model request (`LIVE_MODEL_CALLS_ENABLED_IN_CODE=false`, tests use mock, vitest fetch guard).
