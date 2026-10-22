/**
 * LIVE MODEL GATE — Phase 9 policy (owner rule): NO chargeable model call is allowed until every feature, test, privacy/security check and
 * release-readiness item is complete AND the owner has explicitly approved a minimal, cost-capped live verification.
 *
 * The lock is IN CODE (`LIVE_MODEL_CALLS_ENABLED_IN_CODE`), so environment variables — even a complete base URL + key + model + «approval» —
 * can never switch a live model on. Phase 10 may change the constant in a reviewed commit after approval; the env checks below are the
 * second, separate gate (approval id + hard caps + kill switch) that the future live run must satisfy.
 */
export const LIVE_MODEL_CALLS_ENABLED_IN_CODE = false as const;

export interface LiveGate {
  /** the operator asked for a live provider (AGENT_PROVIDER=openai-compatible) */
  requested: boolean;
  open: boolean;
  /** Persian, actionable; shown to the operator/user when requested but closed */
  reasonFa: string;
  /** which conditions are missing (for logs/tests; never contains values) */
  missing: string[];
}

export function liveGate(env: Record<string, string | undefined>): LiveGate {
  const requested = (env.AGENT_PROVIDER ?? "").trim().toLowerCase() === "openai-compatible";
  const missing: string[] = [];
  if (!LIVE_MODEL_CALLS_ENABLED_IN_CODE) missing.push("code_lock");
  if (!/^APPROVED-[A-Z0-9]{8,}$/.test(env.AGENT_LIVE_APPROVAL ?? "")) missing.push("owner_approval_id");
  const reqs = Number(env.AGENT_LIVE_MAX_REQUESTS); const usd = Number(env.AGENT_LIVE_MAX_USD); const tok = Number(env.AGENT_LIVE_MAX_TOKENS);
  if (!(Number.isInteger(reqs) && reqs >= 1 && reqs <= 200)) missing.push("max_requests");
  if (!(Number.isFinite(usd) && usd > 0 && usd <= 1)) missing.push("max_usd");
  if (!(Number.isInteger(tok) && tok >= 100 && tok <= 4000)) missing.push("max_tokens_per_request");
  // Phase 10A: the handshake is time-boxed and pins the exact destination, model and owner-verified prices (no arbitrary URL/model, no guessed rates)
  const exp = Date.parse(env.AGENT_LIVE_APPROVAL_EXPIRES ?? "");
  const nowMs = Date.now();
  if (!(Number.isFinite(exp) && exp > nowMs && exp - nowMs <= 72 * 3_600_000)) missing.push("approval_expired_or_missing_expiry");
  if (!env.AGENT_LIVE_ALLOW_BASE_URL || env.AGENT_LIVE_ALLOW_BASE_URL.replace(/\/$/, "") !== (env.AGENT_BASE_URL ?? "").replace(/\/$/, "")) missing.push("base_url_not_allowlisted");
  if (!env.AGENT_LIVE_ALLOW_MODEL || env.AGENT_LIVE_ALLOW_MODEL !== env.AGENT_MODEL) missing.push("model_not_allowlisted");
  const pin = Number(env.AGENT_LIVE_PRICE_IN_PER_M); const pout = Number(env.AGENT_LIVE_PRICE_OUT_PER_M);
  if (!(Number.isFinite(pin) && pin > 0 && Number.isFinite(pout) && pout > 0)) missing.push("owner_verified_prices");
  if (env.AGENT_LIVE_KILL === "1") missing.push("kill_switch_engaged");
  const open = requested && missing.length === 0;
  return {
    requested, open, missing,
    reasonFa: open ? "" : "مدل زبانی زنده قفل است: هنوز تأیید صریح مالک، سقف درخواست/توکن/هزینه و کلید قطع اضطراری ثبت نشده است. هیچ درخواستی به مدل ارسال نمی‌شود و به‌جای آن چیزی «شبیه‌سازی» نمی‌شود؛ برای دمو، AGENT_PROVIDER=mock (برنامه‌ریز آفلاین، نه مدل زبانی) را به‌صورت صریح انتخاب کنید.",
  };
}
