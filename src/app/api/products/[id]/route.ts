import { buildSelection, getProductDetail } from "@/server/catalog/detail";
import { json, withDb } from "@/server/api";

export const dynamic = "force-dynamic";
const ID = /^product_[0-9a-f]{8,40}$/;

/** GET /api/products/:id — product detail with variant groups. ?variant=<groupId> additionally returns the Selection handed to Phase 4. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: "INVALID_INPUT" }, 400);
  const variant = new URL(req.url).searchParams.get("variant");
  return withDb((db) => {
    const d = getProductDetail(db, id);
    if (!d) return json({ error: "NOT_FOUND" }, 404);
    return json({ detail: d, selection: buildSelection(db, id, { variantGroupId: variant, source: "search" }) });
  });
}
