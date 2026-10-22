import { z } from "zod";
import { json, parseQuery, text, withDb, intParam } from "@/server/api";
import { searchCatalog } from "@/server/search/search";

export const dynamic = "force-dynamic";

const Query = z.object({ q: text(120).default(""), category: text(120).optional(), limit: intParam(1, 50, 20), offset: intParam(0, 500, 0), facets: z.enum(["0", "1"]).default("0") });

/** GET /api/search?q=… — same service as the /search page (no duplicated business logic). */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => json(searchCatalog(db, { q: p.data.q, category: p.data.category || null, limit: p.data.limit, offset: p.data.offset, facets: p.data.facets === "1" })));
}
