import type { ProductIntent } from "@/domain/advisor";

/**
 * The advisor's whole state lives in the URL (shareable, survives refresh and Back).
 * Only NON-sensitive data goes here — never coordinates. Unknown/oversized values are dropped.
 */
export interface AdvisorParams {
  text: string;
  category: string | null;
  answers: Record<string, string>;
  skipped: string[];
  bmin: number | null;
  bmax: number | null;
  brands: string[];
  show: boolean;
  ask: string | null;
  offset: number;
}

type Get = { get(name: string): string | null; entries(): IterableIterator<[string, string]> };

const ID = /^[a-z][a-z0-9_]{0,30}$/;
const num = (v: string | null): number | null => {
  if (!v || !/^\d{1,13}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
};

export function parseAdvisorParams(p: Get): AdvisorParams {
  const answers: Record<string, string> = {};
  for (const [k, v] of p.entries()) {
    if (k.startsWith("a.") && ID.test(k.slice(2)) && /^[a-z0-9_]{1,30}$/.test(v)) answers[k.slice(2)] = v;
    if (Object.keys(answers).length >= 12) break;
  }
  return {
    text: (p.get("text") ?? "").trim().slice(0, 200),
    category: (p.get("cat") ?? "").trim().slice(0, 120) || null,
    answers,
    skipped: (p.get("skip") ?? "").split(",").filter((s) => ID.test(s)).slice(0, 12),
    bmin: num(p.get("bmin")),
    bmax: num(p.get("bmax")),
    brands: (p.get("brand") ?? "").split(",").map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 4),
    show: p.get("show") === "1",
    ask: ID.test(p.get("ask") ?? "") ? p.get("ask") : null,
    offset: Math.min(200, Math.max(0, Number(p.get("offset")) || 0)),
  };
}

export function buildAdvisorHref(a: Partial<AdvisorParams>, base = "/discover"): string {
  const sp = new URLSearchParams();
  if (a.text) sp.set("text", a.text);
  if (a.category) sp.set("cat", a.category);
  for (const [k, v] of Object.entries(a.answers ?? {})) sp.set(`a.${k}`, v);
  if (a.skipped?.length) sp.set("skip", a.skipped.join(","));
  if (a.bmin) sp.set("bmin", String(a.bmin));
  if (a.bmax) sp.set("bmax", String(a.bmax));
  if (a.brands?.length) sp.set("brand", a.brands.join(","));
  if (a.show) sp.set("show", "1");
  if (a.ask) sp.set("ask", a.ask);
  if (a.offset) sp.set("offset", String(a.offset));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export const paramsFromIntent = (i: ProductIntent, extra: Partial<AdvisorParams> = {}): AdvisorParams => ({
  text: i.text, category: i.category, answers: i.answers, skipped: i.skipped, bmin: i.budget.min, bmax: i.budget.max, brands: i.brands, show: false, ask: null, offset: 0, ...extra,
});

/** Same-origin, whitelisted "return to results" targets only (open-redirect safe). */
export function safeBackHref(v: string | null | undefined): string | null {
  if (!v || v.length > 600) return null;
  return /^\/(discover|search)(\?[^\s]*)?$/.test(v) ? v : null;
}
