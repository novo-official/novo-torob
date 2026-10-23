#!/usr/bin/env bash
# Hamghadam release gate (zero-cost): runs every local check in order and writes a sanitized, timestamped log.
# It makes NO model/network-paid calls, downloads nothing, and never writes data/app.sqlite or .data/.
# Usage: bash scripts/release-gate.sh [logfile]      (default: qa-artifacts/release-gate-latest.txt)
set -u
cd "$(dirname "$0")/.."
LOG="${1:-qa-artifacts/release-gate-latest.txt}"
mkdir -p "$(dirname "$LOG")"
PWJSON="$(mktemp -t pw-gate-XXXX.json)"
DB="${DATABASE_PATH:-data/app.sqlite}"
FAIL=0
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
step() {  # step "<label>" cmd...
  local label="$1"; shift
  local t0; t0=$(date +%s); say ""; say "### $label — start $(date -Is)"; say "\$ $*"
  "$@" > >(tail -n 400 >> "$LOG") 2>&1; local rc=$?
  local t1; t1=$(date +%s)
  say "### $label — exit=$rc duration=$((t1 - t0))s end $(date -Is)"
  [ $rc -ne 0 ] && FAIL=1
  return 0
}
say "# Hamghadam release gate — $(date -Is)"
export REQUIRE_REAL_CATALOG=1   # missing real catalog => BLOCKED (exit 3), never a green "full pass"
if [ ! -f "$DB" ]; then say "BLOCKED: AWAITING REAL DATA — no database at $DB (need .data/torob-dataset.zip + npm run db:import)"; exit 3; fi
say "node=$(node -v) host=$(uname -sr) cpus=$(nproc)  (secrets/env values are never printed)"
say "AGENT_PROVIDER=${AGENT_PROVIDER:-<unset>} AGENT_API_KEY=$([ -n "${AGENT_API_KEY:-}" ] && echo '<SET — abort>' || echo '<unset>')"
[ -n "${AGENT_API_KEY:-}" ] && { say "refusing to run with AGENT_API_KEY set"; exit 2; }
H0=$(sha256sum "$DB" | cut -d' ' -f1); B0=$(stat -c %s "$DB")
Z0=$(sha256sum .data/torob-dataset.zip 2>/dev/null | cut -d' ' -f1)
say "db sha256(before)=$H0 bytes=$B0   zip sha256=${Z0:-n/a}"
step "tsc" npx tsc --noEmit
step "lint" npm run lint
step "vitest" npm test
step "db:verify" npm run db:verify
step "build (standalone)" npm run build
step "agent:eval (mock)" npm run agent:eval
step "playwright (full, chromium)" env PLAYWRIGHT_JSON_OUTPUT_NAME="$PWJSON" npx playwright test --reporter=line,json
node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const s=r.stats; console.log("playwright totals: expected(pass)="+s.expected+" unexpected(fail)="+s.unexpected+" flaky="+s.flaky+" skipped="+s.skipped+" durationMs="+Math.round(s.duration));
const walk=(suite,f)=>{for(const x of suite.suites||[])walk(x,f);for(const sp of suite.specs||[])for(const t of sp.tests)f(sp,t)};
for(const su of r.suites)walk(su,(sp,t)=>{ if(t.status==="skipped"||t.status==="flaky"||t.status==="unexpected") console.log("  "+t.status+": "+sp.file+":"+sp.line+" "+sp.title+" — "+(t.annotations||[]).map(a=>a.description||a.type).join("; ")) });
' "$PWJSON" 2>&1 | tee -a "$LOG"
H1=$(sha256sum "$DB" | cut -d' ' -f1); B1=$(stat -c %s "$DB"); Z1=$(sha256sum .data/torob-dataset.zip 2>/dev/null | cut -d' ' -f1)
say "db sha256(after) =$H1 bytes=$B1  unchanged=$([ "$H0" = "$H1" ] && [ "$B0" = "$B1" ] && echo yes || echo NO)   zip unchanged=$([ "$Z0" = "$Z1" ] && echo yes || echo NO)"
[ "$H0" = "$H1" ] || FAIL=1
say ""; say "# GATE A RESULT: $([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
rm -f "$PWJSON"
exit $FAIL
