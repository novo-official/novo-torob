# Deployment record — Liara (mock, tiles off, live AI locked) — 2026-10-23

| item | value |
|---|---|
| URL | https://hamghadam.liara.run (TLS 1.3, Let's Encrypt `CN=liara.run`, expires 2026-12-20) |
| app / plan | `hamghadam` · docker · `medium-g2` (1 GB RAM, 1 core, 10 GB SSD) · feature plan shown by CLI: `standard` · scale 1 · team `6a87f941…` (account `mhtiasta`). Price per `liara plan list`: 824,997.6 toman/month (+ bundle price shown in console — **not independently verified**) |
| disk | `hamghadam-data` 3 GB mounted at `/app/data` (2.9 GB usable) |
| source | `release/hamghadam` branch of origin + two later local fixes (see git log); image built by Liara from `deploy/liara/Dockerfile.liara` with `NEXT_PUBLIC_MAP_TILES_DISABLED=1` |
| env | none set (AGENT_PROVIDER defaults to `mock`; `/api/agent/status` reports mock, `isLanguageModel:false`) |
| DB | `/app/data/app.sqlite`, 827,924,480 B, **sha256 `47225ae5…156de5` verified on the disk**, `PRAGMA integrity_check`=ok, 225,903 / 6,476 / 331,506 |
| `/api/ready` | 200, snapshot `2026-10-13T00:02:35.297Z` |

## Transfer lessons
1. Direct FTPS upload of the 828 MB file (`curl -C -`) arrived with the right size but a **wrong hash** (bytes differ from ≈ 252 MiB). It was deleted and never installed.
2. Fix that worked: upload `app.sqlite.part.gz` (185 MB, plain `curl --ssl-reqd -T`, no resume), verify the gz hash, `gzip -d -k` on the disk, verify the DB hash, integrity and counts, then `mv app.sqlite.part app.sqlite` and `liara restart`.
3. `liara shell -c` runs the command WITHOUT a shell: no pipes, no quotes; use `node -p <expr without spaces>` for checks.
4. `.liaraignore` patterns match at any depth: a bare `data` removed `src/app/data` (the /data page) from the first build. Patterns are now root-anchored (regression test in `deploy-config.test.ts`).

## Public verification (Playwright against the URL, real catalog IDs)
Run serially on the final deployment: 197 passed, 2 latency-flaky (each passes when rerun alone), 4 skipped (labelled). Demo rehearsal (mock): 10 scenes, 16.6 s, only `POST /api/agent/turn`. Headers: CSP with nonce, X-Frame-Options DENY, nosniff, no-store; **no HSTS observed**; `POST /api/agent/admin` → 404 (no admin token configured), cross-site POST → 403.
Known: Liara edge answers 400 (not 404) to malformed percent-escapes; `TRUST_PROXY_HEADERS` unset ⇒ one shared rate-limit bucket (30 agent turns/min, 120 POST/min for everyone).
Not verified: Firefox/WebKit, screen reader, real phone, Liara edge `X-Forwarded-For` behaviour, billed amount.
