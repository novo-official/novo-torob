import { z } from "zod";
import { json, parseQuery, withDb } from "@/server/api";
import { recommendShoppingAreas } from "@/server/areas/recommend";
import { resolveOrigin } from "@/server/sellers/origins";
import { parseLl } from "@/server/sellers/params";

export const dynamic = "force-dynamic";
const Query = z.object({
  category: z.string().trim().min(1).max(120),
  o: z.string().trim().max(20).optional(),
  ll: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(8).default(3),
});

/** GET /api/areas?category=… — shopping-area leads (curated+sourced or dataset density). Never offers or stock. */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const origin = resolveOrigin(db, { preset: p.data.o, point: p.data.o === "gps" ? null : parseLl(p.data.ll ?? null) });
    return json(recommendShoppingAreas(db, { categoryHint: p.data.category, origin, limit: p.data.limit }));
  });
}
