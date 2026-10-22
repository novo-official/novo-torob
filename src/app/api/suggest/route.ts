import { z } from "zod";
import { json, parseQuery, text, withDb } from "@/server/api";
import { suggest } from "@/server/search/suggest";

export const dynamic = "force-dynamic";
const Query = z.object({ q: text(80).default("") });

/** GET /api/suggest?q=هند — typeahead: product titles + categories, with an honest "no suggestion" state. */
export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  return withDb((db) => json(suggest(db, p.data.q)));
}
