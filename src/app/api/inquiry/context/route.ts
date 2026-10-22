import { z } from "zod";
import { json, parseQuery, withDb } from "@/server/api";
import { resolveInquiryContext } from "@/server/inquiry/context";

export const dynamic = "force-dynamic";
const nullish = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const Query = z.object({
  product: nullish(60), shop: nullish(60), offer: nullish(60), variant: nullish(120),
  visit: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().transform((v) => v ?? null),
});

/** GET /api/inquiry/context?product&variant&shop&offer[&visit] — READ-ONLY. Re-derives every fact from the DB; there is no write endpoint. */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const r = resolveInquiryContext(db, p.data);
    if (r.ok) return json(r.context);
    return json({ error: r.error, candidates: r.candidates ?? null, recovery: r.recovery }, r.error === "INVALID_ID" || r.error === "VARIANT_UNKNOWN" ? 400 : r.error === "OFFER_REQUIRED" ? 409 : r.error === "OFFER_MISMATCH" ? 409 : 404);
  });
}
