import { describe, expect, it } from "vitest";
import { buildVariantGroups } from "./detail";

const row = (id: string, title: string, keys: string, price: number | null, unit = "unknown", flags = "") => ({
  offer_id: id, shop_id: `s_${id}`, seller_title: title, price_toman: price, price_toman_raw: price === null ? "null" : String(price), unit_hint: unit as "unknown", model_keys: keys, price_changed_at: null, flags: flags || null,
});

describe("buildVariantGroups: never assume one product_id = one sellable variant", () => {
  it("splits sibling model codes into separate groups (LC1D95 vs LC1D50)", () => {
    const { groups } = buildVariantGroups(["LC1D95AM7"], [
      row("a", "کنتاکتور LC1D95AM7", "LC1D95AM7", 100), row("b", "کنتاکتور LC1D95AM7 اشنایدر", "LC1D95AM7", 110),
      row("c", "کنتاکتور LC1D50AM7", "LC1D50AM7", 80, "unknown", "VARIANT_MODEL_MISMATCH"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.offerCount).toBe(2);
    expect(groups.find((g) => g.modelKey === "LC1D50AM7")!.flags).toContain("VARIANT_MODEL_MISMATCH");
    expect(groups.find((g) => g.modelKey === "LC1D95AM7")!.flags).not.toContain("VARIANT_MODEL_MISMATCH");
  });
  it("same model code but different price units are different groups", () => {
    const { groups } = buildVariantGroups(["ABC12345"], [row("a", "سیم ABC12345 (قیمت متری)", "ABC12345", 10, "per_metre"), row("b", "سیم ABC12345 حلقه", "ABC12345", 900, "roll_or_pack")]);
    expect(groups.map((g) => g.unitHint).sort()).toEqual(["per_metre", "roll_or_pack"]);
  });
  it("a group's own price range ignores identity flags but still honours price-quality flags", () => {
    const { groups } = buildVariantGroups(["XYZ12345"], [
      row("a", "x", "XYZ12345", 100, "unknown", "VARIANT_MODEL_UNCONFIRMED"), row("b", "x", "XYZ12345", 120), row("c", "x", "XYZ12345", 99999, "unknown", "PRICE_PEER_OUTLIER_HIGH"),
    ]);
    expect(groups[0]!.price).toMatchObject({ status: "reliable", min: 100, max: 120, reliableCount: 2 });
  });
  it("key-less offers join the only cluster, but form their own 'unspecified' group when several variants exist", () => {
    const one = buildVariantGroups(["XYZ12345"], [row("a", "t", "XYZ12345", 1), row("b", "t", "", 2)]);
    expect(one.groups).toHaveLength(1);
    const many = buildVariantGroups(["XYZ12345"], [row("a", "t", "XYZ12345", 1), row("b", "t", "QQQ99999", 2), row("c", "t", "", 3)]);
    expect(many.groups.map((g) => g.modelKey).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([null, "QQQ99999", "XYZ12345"]);
  });
  it("group ids are stable and every offer is assigned to exactly one group", () => {
    const rows = [row("a", "t", "XYZ12345", 1), row("b", "t", "QQQ99999", 2), row("c", "t", "", 3, "per_metre")];
    const r1 = buildVariantGroups([], rows);
    const r2 = buildVariantGroups([], rows);
    expect(r1.groups.map((g) => g.id)).toEqual(r2.groups.map((g) => g.id));
    expect(r1.assignment.size).toBe(3);
  });
  it("the sample title is the RAW seller title, untouched", () => {
    const { groups } = buildVariantGroups([], [row("a", "  عنوان   خام  با فاصله‌ها ", "", 1)]);
    expect(groups[0]!.sampleTitle).toBe("  عنوان   خام  با فاصله‌ها ");
  });
});
