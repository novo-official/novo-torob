import { z } from "zod";
import { compareProducts } from "@/server/advisor/compare";
import { json, parseQuery, withDb } from "@/server/api";

export const dynamic = "force-dynamic";
const Query = z.object({ ids: z.string().max(400).regex(/^product_[0-9a-f]{8,40}(,product_[0-9a-f]{8,40}){1,3}$/, "ids must be 2–4 product ids") });

/** GET /api/compare?ids=a,b[,c[,d]] */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => {
    const r = compareProducts(db, p.data.ids.split(","));
    return r ? json(r) : json({ error: "NOT_FOUND" }, 404);
  });
}
