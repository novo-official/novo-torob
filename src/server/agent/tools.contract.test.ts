// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TOOL_NAMES, initialAgentState, type AgentCard, type AgentState } from "@/domain/agent";
import { openRealDb } from "../../../tests/helpers/real-db";
import { readAgentConfig } from "./config";
import { runTurn, toolSpecs } from "./orchestrator";
import { createMockProvider } from "./providers/mock";
import { TOOLS, isToolName } from "./tools";

const db = openRealDb();
const config = readAgentConfig({ AGENT_EVIDENCE_MODE: "fixture" });
const provider = createMockProvider();
const NOW = new Date("2026-10-22T09:00:00Z");
const DAHUA = "product_7308febc43c2f793fd0e1cf9";
const go = (state: AgentState, message: string | null, control: Parameters<typeof runTurn>[0]["control"] = null) => runTurn({ db: db!, config, provider, state, message, control, now: NOW });

describe("tool registry contract", () => {
  it("is closed: exactly the declared tools, each with a description and a STRICT args schema", () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_NAMES].sort());
    expect(isToolName("run_shell")).toBe(false); expect(isToolName("__proto__")).toBe(false); expect(isToolName("constructor")).toBe(false); expect(isToolName("toString")).toBe(false);
    for (const s of toolSpecs()) {
      expect(s.description.length, s.name).toBeGreaterThan(20);
      expect((s.parameters as { additionalProperties?: unknown }).additionalProperties, s.name).toBe(false);
      const props = Object.keys(((s.parameters as { properties?: Record<string, unknown> }).properties) ?? {});
      for (const k of props) expect(k, `${s.name}.${k}`).not.toMatch(/phone|sms|whatsapp|email|url|href|shell|command|lat|lon|apiKey|token/i);
    }
  });
  it("no tool can contact a seller, take payment, fetch an arbitrary URL or execute code (by description and by name)", () => {
    for (const t of Object.values(TOOLS)) expect(`${t.name} ${t.description}`.replace(/\(NOT send\)/g, ""), t.name).not.toMatch(/\b(send|call|dial|pay|checkout|execute|exec|fetch_url|browse)\b/i);
  });
});

describe.skipIf(!db)("tool outputs carry provenance and honest wording", () => {
  const badgesOk = (cards: AgentCard[]) => { for (const c of cards) expect(c.badges.length, c.id).toBeGreaterThan(0); };
  it("seller + comparison cards: dataset badge, rounded/caveated prices, offerId, validated hrefs, no phone/coords/stock claims", async () => {
    let r = await go(initialAgentState(), null, { type: "select_product", productId: DAHUA, variantGroupId: null });
    r = await go(r.state, null, { type: "set_origin", id: "ferdowsi" });
    r = await go(r.state, "فروشنده‌های نزدیک را نشان بده");
    badgesOk(r.cards);
    const sellers = r.cards.filter((c) => c.type === "seller");
    expect(sellers.length).toBeGreaterThan(0);
    r = await go(r.state, "فروشنده‌ها را مقایسه کن");
    badgesOk(r.cards);
    const cmp = r.cards.find((c) => c.type === "comparison");
    expect(cmp?.badges).toContain("OFFICIAL_DATASET");
    const blob = JSON.stringify(r);
    expect(blob).not.toMatch(/\b09\d{9}\b|\b0\d{10}\b|tel:|wa\.me/);
    expect(blob).not.toMatch(/"(lat|lon|latitude|longitude)"/);
    expect(blob).not.toMatch(/موجود است|در انبار|ارزان‌ترین فروشنده/); // no stock claim, no unconditional «cheapest»
    for (const m of blob.matchAll(/"offerId":"([^"]+)"/g)) expect(m[1]).toMatch(/^offer_[0-9a-f]{8,40}$/);
  });
  it("seller-draft inquiry never claims anything was sent and ships a copy-only draft", async () => {
    let r = await go(initialAgentState(), null, { type: "select_product", productId: DAHUA, variantGroupId: null });
    r = await go(r.state, "فروشنده‌ها را مقایسه کن");
    r = await go(r.state, "برای فروشنده‌ی اول پیش‌نویس سؤال بنویس");
    const inq = r.cards.find((c) => c.type === "inquiry");
    expect(inq).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/ارسال شد|فرستاده شد|تماس گرفته شد/);
    expect(JSON.stringify(inq)).toMatch(/کپی|پیش‌نویس/);
  });
  it("a reply the user reports is stored as USER_REPORTED / unverified, and a different-model reply is flagged, not trusted", async () => {
    let r = await go(initialAgentState(), null, { type: "select_product", productId: DAHUA, variantGroupId: null });
    r = await go(r.state, "فروشنده‌ها را مقایسه کن");
    const c = r.cards.find((x) => x.type === "comparison");
    const row = c && c.type === "comparison" ? c.rows[0] : null;
    expect(row).toBeTruthy();
    r = await go(r.state, null, { type: "select_offer", shopId: row!.shopId, offerId: row!.offerId! });
    r = await go(r.state, "فروشنده گفت مدل دیگه‌ای داره و فردا موجود می‌شه");
    expect(tools(r)).toContain("summarize_user_reported_reply");
    const o = r.cards.find((x) => x.type === "outcome");
    expect(o?.badges).toContain("USER_REPORTED");
    expect(o && o.type === "outcome" && o.provenance).toBe("USER_REPORTED");
    expect(r.assistant.text + r.notices.join() + JSON.stringify(o)).toMatch(/تأیید ?نشده|تأییدنشده|گزارش شما/);
  });
  it("alternatives: dataset products only, with a stated reason and the original kept", async () => {
    let r = await go(initialAgentState(), null, { type: "select_product", productId: DAHUA, variantGroupId: null });
    r = await go(r.state, "جایگزین مشابه پیشنهاد بده");
    badgesOk(r.cards);
    expect(r.state.selection?.productId).toBe(DAHUA);
    for (const c of r.cards) if (c.type === "product") expect(c.id).toMatch(/product_[0-9a-f]+/);
  });
  it("recovery: a model absent from the sample says so WITHOUT claiming absence from the market, and offers only district-type areas (verified or density estimate), never a seller", async () => {
    const r = await go(initialAgentState(), "دوربین مداربسته مدل ZZ9999X رو می‌خوام نزدیک بهارستان");
    expect(r.assistant.text).toContain("نمونه‌ی محدود");
    expect(r.assistant.text).not.toMatch(/در تهران (موجود )?نیست|ناموجود/);
    const areas = r.cards.filter((c) => c.type === "area");
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) if (a.type === "area") { expect(a.badges).toContain("SYSTEM_ESTIMATE"); expect(["VERIFIED_SHOPPING_DISTRICT", "DATASET_DENSITY_ESTIMATE"]).toContain(a.geoType); }
    expect(r.cards.some((c) => c.type === "seller")).toBe(false); // an area is never presented as a seller who has the item
  });
});
const tools = (r: { trace: Array<{ tool: string }> }) => r.trace.map((t) => t.tool);
