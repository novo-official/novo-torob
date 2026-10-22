import { z } from "zod";
import type { AgentErrorResponse } from "@/domain/agent";
import { getReadDb } from "@/server/db/connect";
import { DatabaseUnavailableError } from "@/server/db/connect";
import { NextResponse } from "next/server";
import { clientKey, isCrossSite } from "@/server/agent/guard";
import { runTurn } from "@/server/agent/orchestrator";
import { getRuntime } from "@/server/agent/runtime";
import { AgentControlSchema, validateState } from "@/server/agent/state";
import { agentLog } from "@/server/agent/config";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const err = (status: number, e: AgentErrorResponse, extra: Record<string, string> = {}) => NextResponse.json(e, { status, headers: { ...NO_STORE, ...extra } });

const Body = z.object({ message: z.string().max(4000).nullish(), control: AgentControlSchema.nullish(), state: z.unknown() }).strict();

/**
 * POST /api/agent/turn  { message?, control?, state }
 * The client holds the typed conversation state (server keeps NONE → no cross-user leakage); the server re-validates it each turn.
 */
export async function POST(req: Request) {
  const rt = getRuntime();
  if (rt.config.provider === "live-locked") return err(503, { ok: false, error: "AGENT_LIVE_LOCKED", messageFa: rt.config.liveGate.reasonFa });
  if (rt.config.provider === "disabled") return err(503, { ok: false, error: "AGENT_DISABLED", messageFa: "دستیار در این محیط غیرفعال است؛ از جست‌وجو و مشاور معمول استفاده کنید." });
  if (isCrossSite(req.headers, req.url)) return err(403, { ok: false, error: "CROSS_SITE", messageFa: "درخواست از مبدأ نامعتبر." });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return err(415, { ok: false, error: "INVALID_INPUT", messageFa: "قالب درخواست باید JSON باشد." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > rt.config.limits.maxBodyBytes) return err(413, { ok: false, error: "INVALID_INPUT", messageFa: "درخواست بیش از حد بزرگ است." });
  const wait = rt.limiter.check(clientKey(req.headers));
  if (wait > 0) return err(429, { ok: false, error: "RATE_LIMITED", messageFa: "درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.", retryAfterSec: wait }, { "Retry-After": String(wait) });

  let raw: string;
  try { raw = await req.text(); } catch { return err(400, { ok: false, error: "INVALID_INPUT", messageFa: "بدنه‌ی درخواست خوانده نشد." }); }
  if (raw.length > rt.config.limits.maxBodyBytes) return err(413, { ok: false, error: "INVALID_INPUT", messageFa: "درخواست بیش از حد بزرگ است." });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return err(400, { ok: false, error: "INVALID_INPUT", messageFa: "JSON نامعتبر است." }); }
  const b = Body.safeParse(parsed);
  if (!b.success) return err(400, { ok: false, error: "INVALID_INPUT", messageFa: "ورودی معتبر نیست." });
  const message = b.data.message?.trim() ? b.data.message.trim() : null;
  if (!message && !b.data.control) return err(400, { ok: false, error: "INVALID_INPUT", messageFa: "پیام یا یک کنترل لازم است." });
  if (message && message.length > rt.config.limits.maxMessageChars) return err(400, { ok: false, error: "INVALID_INPUT", messageFa: `پیام باید حداکثر ${rt.config.limits.maxMessageChars} نویسه باشد.` });

  if (!rt.gate.tryAcquire()) return err(503, { ok: false, error: "BUSY", messageFa: "دستیار الان مشغول است؛ چند ثانیه‌ی دیگر دوباره امتحان کنید.", retryAfterSec: 3 }, { "Retry-After": "3" });
  try {
    let db;
    try { db = getReadDb(); } catch (e) {
      if (e instanceof DatabaseUnavailableError) return err(503, { ok: false, error: "DATABASE_UNAVAILABLE", messageFa: "پایگاه داده در دسترس نیست." });
      throw e;
    }
    const sv = validateState(b.data.state, db);
    if (!sv.ok) return err(400, { ok: false, error: "INVALID_INPUT", messageFa: "وضعیت گفت‌وگو معتبر نیست؛ گفت‌وگو را از نو شروع کنید." });
    const out = await runTurn({ db, config: rt.config, provider: rt.provider, state: sv.state, message, control: b.data.control ?? null });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e) {
    agentLog("turn_error", { kind: e instanceof Error ? e.name : "unknown" }, rt.config);
    return err(500, { ok: false, error: "INTERNAL", messageFa: "خطای داخلی؛ دوباره تلاش کنید." });
  } finally {
    rt.gate.release();
  }
}
