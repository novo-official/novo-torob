#!/usr/bin/env bash
# One-command, OWNER-RUN live trial (BoxAPI). The API key is read from YOUR shell (BOXAPI_API_KEY) or typed silently; it is never written to a file.
# What it does: (1) temporarily flips the compile-time lock in the working tree, (2) runs scripts/live-trial.ts with the approved caps, (3) ALWAYS restores
# the lock (trap) and verifies `git diff` of live-gate.ts is empty. Approved caps: max 100 requests, USD 0.25, 700 output tokens, 30000 input tokens (pessimistic estimate: real ≈ estimate/4.5).
#   BOXAPI_API_KEY=… ./scripts/run-live-trial.sh          # or just run it and type the key
#   MODEL=openai/gpt-6-luna ./scripts/run-live-trial.sh   # only if the bare model name is rejected as unknown
#   TOKEN_PARAM=max_completion_tokens NO_TEMPERATURE=1 ./scripts/run-live-trial.sh   # only if the first call is rejected for those parameters
#   CLEAR_HALT=1 ./scripts/run-live-trial.sh              # after a halted run: keeps the spent/request counters, clears only the halted flag
#   DRY_RUN=1 ./scripts/run-live-trial.sh                 # flips and restores the lock, sends NOTHING
set -euo pipefail
cd "$(dirname "$0")/.."
GATE=src/server/agent/live-gate.ts
[ -e .live-kill ] && { echo "STOP: .live-kill exists (stop switch). Remove it only if you really want to continue."; exit 3; }
git diff --quiet -- "$GATE" || { echo "STOP: $GATE already has uncommitted changes."; exit 3; }
grep -q 'LIVE_MODEL_CALLS_ENABLED_IN_CODE = false as const' "$GATE" || { echo "STOP: unexpected lock line."; exit 3; }

LEDGER="$PWD/.cache/live-ledger.json"
if [ -f "$LEDGER" ]; then
  echo "[ledger] $(node -p 'const j=require(process.argv[1]);`requests=${j.requests} spentUsd=${j.spentUsd.toFixed(6)} halted=${j.halted}${j.halted?" ("+j.haltReason+")":""}`' "$LEDGER")"
  if node -p 'require(process.argv[1]).halted' "$LEDGER" | grep -q true; then
    if [ "${CLEAR_HALT:-0}" = "1" ] && [ "${DRY_RUN:-0}" != "1" ]; then node -e 'const f=require("fs"),p=process.argv[1],j=JSON.parse(f.readFileSync(p,"utf8"));j.halted=false;j.haltReason=null;f.writeFileSync(p,JSON.stringify(j),{mode:0o600})' "$LEDGER"; echo "[ledger] halted flag cleared (counters kept)"
    elif [ "${DRY_RUN:-0}" != "1" ]; then echo "STOP: the previous run halted the guard. Read qa-artifacts/live-trial.json, then re-run with CLEAR_HALT=1 to continue (spend counters are kept)."; exit 3; fi
  fi
fi

restore() { sed -i 's/LIVE_MODEL_CALLS_ENABLED_IN_CODE = true as const/LIVE_MODEL_CALLS_ENABLED_IN_CODE = false as const/' "$GATE"; git diff --quiet -- "$GATE" && echo "[lock restored: LIVE_MODEL_CALLS_ENABLED_IN_CODE=false, git diff empty]" || echo "!! LOCK NOT RESTORED — run: sed -i 's/= true as const/= false as const/' $GATE"; }
trap restore EXIT

if [ "${DRY_RUN:-0}" != "1" ] && [ -z "${BOXAPI_API_KEY:-}" ]; then read -rsp "BoxAPI key (hidden, not stored): " BOXAPI_API_KEY; echo; export BOXAPI_API_KEY; fi
[ "${DRY_RUN:-0}" = "1" ] && export BOXAPI_API_KEY="${BOXAPI_API_KEY:-dry-run-no-key-0000000000000000}"

MODEL="${MODEL:-gpt-6-luna}"
export AGENT_PROVIDER=openai-compatible AGENT_BASE_URL=https://ai.boxapi.ir/ai/v1 AGENT_MODEL="$MODEL"
export AGENT_LIVE_ALLOW_BASE_URL=https://ai.boxapi.ir/ai/v1 AGENT_LIVE_ALLOW_MODEL="$MODEL"
export AGENT_LIVE_PRICE_IN_PER_M=0.115 AGENT_LIVE_PRICE_OUT_PER_M=0.575      # openai/gpt-6-luna, boxapi.ir/docs/ai/models, read 2026-10-23 — re-check on the day
export AGENT_LIVE_MAX_REQUESTS=100 AGENT_LIVE_MAX_USD=0.25 AGENT_LIVE_MAX_TOKENS=700 AGENT_LIVE_MAX_INPUT_TOKENS=30000
export AGENT_LIVE_APPROVAL="APPROVED-$(date +%s)" AGENT_LIVE_APPROVAL_EXPIRES="$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)"
export AGENT_TURN_DEADLINE_MS=60000 AGENT_PROVIDER_TIMEOUT_MS=30000 AGENT_MAX_HOPS=8   # gpt-6-luna measured 3-10 s per call; the first live run hit the 28 s turn deadline and the 6-hop limit
export AGENT_LIVE_ADMIN_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)aaaaaaaa"
export AGENT_LIVE_LEDGER_PATH="$PWD/.cache/live-ledger.json" AGENT_EVIDENCE_MODE=off AGENT_RATE_PER_MIN=600
[ -n "${TOKEN_PARAM:-}" ] && export AGENT_TOKEN_PARAM="$TOKEN_PARAM"
[ -n "${NO_TEMPERATURE:-}" ] && export AGENT_SEND_TEMPERATURE=0
[ -n "${REASONING:-}" ] && export AGENT_REASONING_EFFORT="$REASONING"   # none (default for gpt-6-luna) | low | … | omit
export LIVE_TRIAL_CONFIRM="SPEND-UP-TO-0.25"

sed -i 's/LIVE_MODEL_CALLS_ENABLED_IN_CODE = false as const/LIVE_MODEL_CALLS_ENABLED_IN_CODE = true as const/' "$GATE"
if [ "${DRY_RUN:-0}" = "1" ]; then echo "[dry run: lock flipped to $(grep -o 'IN_CODE = [a-z]*' "$GATE"), nothing sent]"; exit 0; fi
mkdir -p .cache
npx tsx scripts/live-trial.ts
echo "report: qa-artifacts/live-trial.json   ledger: .cache/live-ledger.json"
