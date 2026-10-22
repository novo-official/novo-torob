import { NextResponse } from "next/server";
import { getReadDbOrNull } from "@/server/db/safe";
import { clientKey } from "@/server/agent/guard";
import { buildEvidenceCard } from "@/server/agent/evidence/card";
import { getExternalEvidence } from "@/server/agent/evidence/service";
import { getRuntime } from "@/server/agent/runtime";

export const dynamic = "force-dynamic";
const ID = /^product_[0-9a-f]{8,40}$/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/evidence/:productId?optin=1 — OPT-IN enrichment for ONE dataset product (never a search, never a user-supplied URL).
 * Without `optin=1` nothing external is read. The mode comes from server config only (off | fixture | live), the registry of pages is code,
 * results are cached, and no language model is involved anywhere on this path.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
  const rt = getRuntime();
  const wait = rt.limiter.check(clientKey(req.headers));
  if (wait > 0) return NextResponse.json({ error: "RATE_LIMITED", retryAfterSec: wait }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(wait) } });
  const db = getReadDbOrNull();
  if (!db) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  const optin = new URL(req.url).searchParams.get("optin") === "1";
  const mode = optin ? rt.config.evidenceMode : "off";
  const r = await getExternalEvidence(db, id, { mode, reproduce: rt.config.evidenceReproduce });
  const card = buildEvidenceCard(id, r, mode);
  if (mode === "off") card.notes = [rt.config.evidenceMode === "off" ? "بازیابی شواهد بیرونی در این محیط غیرفعال است؛ فقط داده‌ی رسمی ترب نمایش داده می‌شود." : "شواهد بیرونی فقط با درخواست صریح شما خوانده می‌شود."];
  return NextResponse.json({ card, cached: r.cached, retrievedAt: r.retrievedAt }, { headers: NO_STORE });
}
