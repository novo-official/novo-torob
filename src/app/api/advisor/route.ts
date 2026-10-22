import { z } from "zod";
import { adviseProducts } from "@/server/advisor/engine";
import { json, optInt, parseQuery, text, withDb, intParam } from "@/server/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/advisor — the deterministic advisor as a typed tool (`adviseProducts`), consumable by the UI today and an LLM
 * orchestrator in a later phase. Answers arrive as repeated `a.<questionId>=<optionId>` parameters.
 */
const Query = z.object({
  text: text(200).default(""),
  category: text(120).optional(),
  bmin: optInt,
  bmax: optInt,
  skip: text(200).default(""),
  brand: text(120).default(""),
  show: z.enum(["0", "1"]).default("0"),
  limit: intParam(1, 24, 12),
  offset: intParam(0, 200, 0),
}).catchall(z.string().max(40));

export function GET(req: Request) {
  const p = parseQuery(Query, req.url);
  if (!p.ok) return p.response;
  const d = p.data as Record<string, unknown> & z.infer<typeof Query>;
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (k.startsWith("a.") && typeof v === "string") answers[k.slice(2)] = v;
  return withDb((db) =>
    json(adviseProducts(db, {
      text: d.text, category: d.category || null, answers, skipped: d.skip ? d.skip.split(",").filter(Boolean) : [], budget: { min: d.bmin ?? null, max: d.bmax ?? null },
      brands: d.brand ? d.brand.split(",").filter(Boolean) : [], show: d.show === "1", limit: d.limit, offset: d.offset,
    })),
  );
}
