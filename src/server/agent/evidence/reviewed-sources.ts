import type { ExternalEvidenceItem, Passage } from "@/domain/evidence";
import { looksLikeInjection } from "@/domain/evidence";
import { REQUIRED_SCOPE_NOTES, type EvidenceSource } from "@/domain/provenance";
import { htmlToText, safeFetchText, SafeFetchError, type SafeFetchOptions } from "./safe-fetch";
import type { AdapterCtx, AdapterOutput, ExternalSourceAdapter, ProductRef } from "./service";

/**
 * REVIEWED REGISTRY of real public pages (Phase 9). Each entry was opened by a human, its robots.txt rule read, and the exact dataset model
 * checked. The registry is code: neither a user nor a model can add a URL, and page content can never change which host is contacted.
 * Quotes are short (≤ 25 words), verbatim, attributed and linked. Nothing from the pages is ever given to a language model: the evidence
 * tool hands the model only counts/status (display-only use — the review site's platform robots.txt disallows AI crawlers; we are not one).
 * What is NEVER taken from a page: prices, availability/stock, ratings/stars/review counts, user comments.
 */
export interface ReviewedSource {
  id: string;
  /** exact dataset model key (uppercase) this page was verified for */
  modelKey: string;
  /** marketing name used by reviews that do not print the model code; the dataset TITLE must contain it too */
  alias: string | null;
  kind: "manufacturer" | "expert_review";
  url: string;
  publisher: string;
  /** what a human verified, shown in docs (not in the UI) */
  reviewed: { on: string; robots: string; terms: string };
  /**
   * «blocked» = the publisher's bot filter refuses our programmatic client (e.g. Cloudflare 403) although the page opens in a browser.
   * We do NOT work around an access control (no spoofed browser identity, no proxy, no headless tricks): such an entry is skipped.
   */
  access: { state: "open" | "blocked"; checkedOn: string; note: string };
  /** metadata a human read on the page at review time (shown in link-only mode; no third-party wording) */
  meta: { titleEn: string; author: string | null; publishedAt: string | null; kindFa: string };
}

export const REVIEWED_SOURCES: readonly ReviewedSource[] = [
  {
    id: "soundcore-eu-a3994", modelKey: "A3994", alias: "K20I", kind: "manufacturer", url: "https://eu.soundcore.com/products/a3994", publisher: "Soundcore (Anker) — eu.soundcore.com",
    reviewed: { on: "2026-10-22", robots: "robots.txt (User-agent: *) disallows only /search, /account, /cart, /checkout, /downloads, …; product pages are not disallowed", terms: "website terms not legally reviewed; one GET per day per product, no login, short quotes with link" },
    meta: { titleEn: "soundcore K20i", author: null, publishedAt: null, kindFa: "صفحه‌ی رسمی سازنده" },
    access: { state: "blocked", checkedOn: "2026-10-22", note: "eu./us.soundcore.com answer our Node HTTP client (and robots.txt) with Cloudflare 403 while a plain curl/browser read works; the global www.soundcore.com page for this model carries an unrelated (AeroClip) description. Not circumvented → live manufacturer retrieval NOT VERIFIED." },
  },
  {
    id: "scarbir-k20i-review", modelKey: "A3994", alias: "K20I", kind: "expert_review", url: "https://www.scarbir.com/tws/soundcore-k20i-review", publisher: "Scarbir — Bart Breij (independent review)",
    reviewed: { on: "2026-10-22", robots: "Squarespace default robots.txt: named AI crawlers disallowed; User-agent: * allows articles (only /config, /search, /api/, … disallowed). Our client is a fixed single-URL reader, not an AI crawler", terms: "author states reviews are independent; terms not legally reviewed; ≤25-word verbatim quotes with attribution and link; AI use of the text is NOT made" },
    meta: { titleEn: "Soundcore K20i review", author: "Bart Breij", publishedAt: "2025-06-26", kindFa: "نقد مستقل" },
    access: { state: "open", checkedOn: "2026-10-22", note: "live GET succeeded from the project's own client (HTTP 200, text/html); robots.txt allows the path" },
  },
];

const MAX_WORDS = 25;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** the shortest verbatim span ≤ 25 words that contains `phrase`, from a sentence (ellipsis marks a cut) */
export function quoteAround(sentence: string, phrase: RegExp, maxWords = MAX_WORDS): string | null {
  const m = phrase.exec(sentence);
  if (!m) return null;
  const clean = sentence.replace(/\s+([.,;:!?])/g, "$1").replace(/\.\.+$/, ".").trim();
  const w = words(clean);
  if (w.length <= maxWords) return clean;
  const start = Math.max(0, words(clean.slice(0, clean.toLowerCase().indexOf(m[0].toLowerCase()))).length - 6);
  return `…${w.slice(start, start + maxWords).join(" ")}…`;
}

const ldBlocks = (html: string): unknown[] => [...html.slice(0, 600_000).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => { try { return [JSON.parse(m[1]!)]; } catch { return []; } });
const pick = (blocks: unknown[], type: string) => blocks.map((b) => b as Record<string, unknown>).find((b) => b && (b["@type"] === type || (Array.isArray(b["@type"]) && (b["@type"] as unknown[]).includes(type))));
const canonicalOf = (html: string): string | null => /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ?? null;

interface Extracted { passages: Passage[]; strengths: Array<{ text: string; passageId: string }>; weaknesses: Array<{ text: string; passageId: string }>; publishedAt?: string; modifiedAt?: string; author?: string; proof: string }

/** manufacturer page: model proof = canonical slug / JSON-LD id contains the exact key; claims = marketing feature lines (spec words only) */
export function extractManufacturer(html: string, src: ReviewedSource): Extracted | null {
  const key = src.modelKey.toLowerCase();
  const blocks = ldBlocks(html);
  const product = pick(blocks, "ProductGroup") ?? pick(blocks, "Product");
  const canon = canonicalOf(html) ?? "";
  const id = typeof product?.["@id"] === "string" ? (product["@id"] as string) : "";
  const skus = Array.isArray(product?.hasVariant) ? (product!.hasVariant as Array<Record<string, unknown>>).map((v) => String(v.sku ?? "").toLowerCase()) : [];
  const proof = new RegExp(`/${key}(?:[/?#]|$)`).test(canon.toLowerCase()) ? "canonical URL slug" : id.toLowerCase().includes(`/products/${key}`) ? "JSON-LD @id" : skus.some((k) => k.startsWith(key)) ? "JSON-LD variant SKU prefix" : null;
  if (!proof || !product) return null;
  const name = String(product.name ?? "");
  if (src.alias && !name.toUpperCase().includes(src.alias)) return null; // the page must also name the product the dataset title names
  const desc = typeof product.description === "string" ? product.description : "";
  const lines = desc.split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 20);
  const FEATURE = /(\d+\s?mm\b|\bup to \d+\s?hours?\b|\b\d+(\.\d+)?\s?g\b|bluetooth|IPX?\d|dual-mic|noise reduction|driver)/i;
  const out: Passage[] = [];
  for (const l of lines) {
    if (out.length >= 3) break;
    if (!FEATURE.test(l) || looksLikeInjection(l)) continue;
    const first = l.split(/(?<=[.!?])\s+/)[0]!;
    const q = quoteAround(first, FEATURE);
    if (q && q.length <= 280) out.push({ id: `p${out.length + 1}`, text: q, field: "JSON-LD Product.description (متن تبلیغاتی سازنده)" });
  }
  return out.length ? { passages: out, strengths: [], weaknesses: [], proof } : null;
}

const REVIEW_RULES: Array<{ re: RegExp; side: "verdict" | "strength" | "weakness"; fa: string; field: string }> = [
  { re: /joins the ranks of good cheap semi-in-ears/i, side: "verdict", fa: "جمع‌بندی نویسنده", field: "review verdict sentence" },
  { re: /rock good battery life, comfort and waterproofing/i, side: "strength", fa: "باتری، راحتی و مقاومت در برابر آب را خوب توصیف کرده", field: "review body" },
  { re: /doesn't support multipoint connectivity/i, side: "weakness", fa: "اتصال هم‌زمان به دو دستگاه (multipoint) را ندارد", field: "review body" },
  { re: /Bluetooth connection isn't the best/i, side: "weakness", fa: "کیفیت اتصال بلوتوث را «بهترین» نمی‌داند", field: "review body" },
  { re: /disconnect right after a phone call/i, side: "weakness", fa: "نویسنده روی نمونه‌ی خودش یک‌بار قطع و وصل پس از تماس دیده", field: "review body" },
];

/** review page: the page must name the alias; strengths/weaknesses come ONLY from a reviewed phrase table, each tied to a verbatim quote */
export function extractReview(html: string, src: ReviewedSource): Extracted | null {
  const text = htmlToText(html, 400_000);
  if (!src.alias || !text.toUpperCase().includes(src.alias)) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length < 500);
  const passages: Passage[] = []; const strengths: Extracted["strengths"] = []; const weaknesses: Extracted["weaknesses"] = [];
  let verdictAdded = false;
  for (const rule of REVIEW_RULES) {
    const s = sentences.find((x) => rule.re.test(x));
    if (!s || looksLikeInjection(s)) continue;
    const bare = s.replace(/^[A-Z ]+STARS?\s*-\s*/, "");
    const q = quoteAround(bare, rule.re);
    if (!q) continue;
    const id = `p${passages.length + 1}`;
    passages.push({ id, text: q, field: rule.field });
    if (rule.side === "strength") strengths.push({ text: rule.fa, passageId: id });
    else if (rule.side === "weakness") weaknesses.push({ text: rule.fa, passageId: id });
    else verdictAdded = true;
  }
  if (!verdictAdded && !strengths.length && !weaknesses.length) return null;
  const art = pick(ldBlocks(html), "Article");
  return { passages, strengths, weaknesses, publishedAt: typeof art?.datePublished === "string" ? art.datePublished.slice(0, 10) : undefined, modifiedAt: typeof art?.dateModified === "string" ? art.dateModified.slice(0, 10) : undefined, author: typeof art?.author === "string" ? art.author : undefined, proof: `alias «${src.alias}» on the page` };
}

/**
 * Minimal robots.txt evaluation (RFC 9309 subset): the most specific matching group for our token, falling back to `*`; longest matching
 * Allow/Disallow wins (Allow on tie); `*` and `$` wildcards. Used as a runtime gate: a Disallow (or an unreadable robots.txt) means NO request.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = "HamghadamBot"): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pat: string }> }> = [];
  let cur: (typeof groups)[number] | null = null; let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase(); const v = m[2]!.trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow") && v) cur.rules.push({ allow: k === "allow", pat: v });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  const rules = use.flatMap((g) => g.rules);
  const re = (pat: string) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) if (re(r.pat).test(path) && (!best || r.pat.length > best.len || (r.pat.length === best.len && r.allow))) best = { len: r.pat.length, allow: r.allow };
  return best ? best.allow : true;
}

const robotsCache = new Map<string, { at: number; text: string | null }>();
async function robotsOk(url: URL, opts: SafeFetchOptions, now: number): Promise<boolean> {
  const key = url.hostname;
  let hit = robotsCache.get(key);
  if (!hit || now - hit.at > 24 * 3600_000) {
    try {
      const r = await safeFetchText(`https://${url.hostname}/robots.txt`, { ...opts, maxBytes: 200_000 });
      hit = { at: now, text: r.text };
    } catch (e) {
      // RFC 9309 §2.3.1: a robots.txt that is «unavailable» (any 4xx, incl. 403 from a bot filter) means no published restrictions; a server error or
      // network failure means we cannot know → we do not fetch (fail closed)
      hit = { at: now, text: e instanceof SafeFetchError && e.code === "HTTP_ERROR" && /status 4\d\d/.test(e.message) ? "" : null };
    }
    robotsCache.set(key, hit);
  }
  return hit.text !== null && robotsAllows(hit.text, url.pathname + url.search);
}
export const clearRobotsCache = () => robotsCache.clear();

/** a human-verified REFERENCE: where an independent review / the official page exists, with who/when — no third-party wording, no network read */
export function linkOnlyItem(src: ReviewedSource, ref: ProductRef, now: Date): ExternalEvidenceItem {
  const manufacturer = src.kind === "manufacturer";
  const exact = manufacturer;
  const reviewedOn = src.reviewed.on;
  const source: EvidenceSource = {
    sourceType: manufacturer ? "manufacturer" : "expert_review", sourceName: src.publisher, sourceUrl: src.url, retrievedAt: reviewedOn,
    ...(src.meta.publishedAt ? { publishedAt: src.meta.publishedAt } : {}), evidenceConfidence: exact ? "medium" : "low", claimType: manufacturer ? "specification" : "opinion",
    match: exact ? { productId: ref.productId, modelKey: src.modelKey, method: "exact_model_key", note: "کد مدل در نشانی صفحه (بازبینی دستی)" } : { productId: ref.productId, modelKey: src.modelKey, method: "manual", note: `نام تجاری بازبینی‌شده «${src.alias ?? ""}»` },
    attribution: `${src.publisher}${src.meta.author ? ` — نویسنده: ${src.meta.author}` : ""}. فقط پیوند؛ متن آن در این برنامه ذخیره یا بازتولید نمی‌شود.`,
    scopeLimits: [REQUIRED_SCOPE_NOTES[manufacturer ? "manufacturer" : "expert_review"], "قیمت، موجودی و امتیاز/شمار نظر از این منبع گرفته نمی‌شود."],
  };
  void now;
  return {
    id: `rs-link-${src.id}`, kind: manufacturer ? "SPEC_CLAIM" : "EXPERT_REVIEW", source, linkOnly: true,
    productMatch: { productId: ref.productId, modelKey: src.modelKey, method: exact ? "exact_model_key" : "manual", confidence: exact ? "medium" : "low" }, modelClaimed: exact ? src.modelKey : null,
    passages: [{ id: "p1", text: `${src.meta.kindFa} برای همین مدل در منبع بیرونی هست (بازبینی دستی در ${reviewedOn}). برای خواندنش به همان نشانی بروید.`, field: "پیوند ارجاعی (بدون بازتولید متن)" }],
    summary: `${src.meta.kindFa}: پیوند ارجاعی بدون بازتولید متن؛ ادعا یا نظری از آن در برنامه نشان داده نمی‌شود.`, strengths: [], weaknesses: [],
    limitations: [manufacturer ? "ادعای سازنده است و ممکن است با نسخه‌ی بازار ایران فرق کند." : "نظر یک نویسنده است؛ کد مدل روی صفحه نیست و تطبیق با نام تجاری انجام شد (اطمینان کم).", "تاریخ نمایش‌داده‌شده تاریخ بازبینی دستی است، نه خواندن خودکار؛ ممکن است صفحه بعداً عوض شده باشد.", "حقوق بازنشر متن این منبع بررسی نشده، پس نقل‌قول نمی‌کنیم."],
    fixture: false,
  };
}

const lastHit = new Map<string, number>();
const MIN_GAP_MS = 2_000;
async function politely(host: string): Promise<void> {
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  lastHit.set(host, Date.now() + Math.max(0, wait));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export function createReviewedSourcesAdapter(registry: readonly ReviewedSource[] = REVIEWED_SOURCES, defaults: Partial<SafeFetchOptions> = {}, opts: { includeBlocked?: boolean; /** quote short spans (needs the owner's rights decision); default: link-only, NO request to the page */ reproduce?: boolean } = {}): ExternalSourceAdapter {
  const hosts = [...new Set(registry.map((r) => new URL(r.url).hostname.toLowerCase()))];
  return {
    id: "reviewed-sources", version: "rs-1", mode: "live", allowedHosts: hosts,
    async collect(ref: ProductRef, ctx: AdapterCtx): Promise<AdapterOutput> {
      const mine = registry.filter((r) => ref.modelKeys.includes(r.modelKey.toUpperCase()) && (!r.alias || ref.title.toUpperCase().includes(r.alias)));
      if (!mine.length) return { items: [], outcome: "no_match" };
      const items: ExternalEvidenceItem[] = []; const details: string[] = [];
      for (const src of mine) {
        if (!opts.reproduce) { items.push(linkOnlyItem(src, ref, ctx.now)); continue; } // rights unclear → a reference, not a copy; and no request to the page at all
        if (src.access.state === "blocked" && !opts.includeBlocked) { details.push(`${src.id}: ACCESS_BLOCKED_BY_PUBLISHER (not circumvented)`); continue; }
        try {
          const host = new URL(src.url).hostname.toLowerCase();
          if (!defaults.fetchImpl && !ctx.fetchOpts?.fetchImpl) await politely(host);
          const fopts: SafeFetchOptions = { allowedHosts: hosts, maxBytes: 1_500_000, ...defaults, ...ctx.fetchOpts };
          if (!(await robotsOk(new URL(src.url), fopts, ctx.now.getTime()))) { details.push(`${src.id}: ROBOTS_DISALLOWED_OR_UNREADABLE`); continue; }
          const r = await safeFetchText(src.url, fopts);
          const x = src.kind === "manufacturer" ? extractManufacturer(r.text, src) : extractReview(r.text, src);
          if (!x) { details.push(`${src.id}: no exact-model proof or no extractable claims`); continue; }
          const manufacturer = src.kind === "manufacturer";
          const exact = manufacturer; // the review matches by the reviewed brand name, not by printing the model code
          const source: EvidenceSource = {
            sourceType: manufacturer ? "manufacturer" : "expert_review", sourceName: src.publisher, sourceUrl: r.url, retrievedAt: ctx.now.toISOString().slice(0, 10),
            ...(x.publishedAt ? { publishedAt: x.publishedAt } : {}), evidenceConfidence: exact ? "medium" : "low", claimType: manufacturer ? "specification" : "opinion",
            match: exact ? { productId: ref.productId, modelKey: src.modelKey, method: "exact_model_key", note: `مدل روی صفحه: ${x.proof}` } : { productId: ref.productId, modelKey: src.modelKey, method: "manual", note: `نام تجاری بازبینی‌شده؛ ${x.proof}` },
            attribution: `${src.publisher} — ${r.url}${x.author ? ` — نویسنده: ${x.author}` : ""}. گزیده‌های کوتاه و عیناً نقل‌شده با ارجاع.`,
            scopeLimits: [REQUIRED_SCOPE_NOTES[manufacturer ? "manufacturer" : "expert_review"], "قیمت، موجودی و امتیاز/شمار نظر از این صفحه گرفته نمی‌شود."],
          };
          items.push({
            id: `rs-${src.id}`, kind: manufacturer ? "SPEC_CLAIM" : "EXPERT_REVIEW", source, productMatch: { productId: ref.productId, modelKey: src.modelKey, method: exact ? "exact_model_key" : "manual", confidence: exact ? "medium" : "low" },
            modelClaimed: exact ? src.modelKey : null, passages: x.passages,
            summary: manufacturer ? "گزیده‌ی ویژگی‌ها از صفحه‌ی سازنده (متن تبلیغاتی سازنده؛ نه آزمون مستقل)." : "گزیده‌ی نقد مستقل یک نویسنده؛ فقط نظر او روی یک نمونه است، نه حقیقت اندازه‌گیری‌شده.",
            strengths: x.strengths, weaknesses: x.weaknesses,
            limitations: manufacturer ? ["متن تبلیغاتی سازنده است و ممکن است با نسخه‌ی فروخته‌شده در ایران فرق کند.", "قیمت و موجودی این صفحه استفاده نشد."] : [`نظر یک نویسنده (${x.author ?? "نامشخص"})${x.publishedAt ? `، منتشرشده ${x.publishedAt}` : ""}${x.modifiedAt ? `، به‌روزرسانی ${x.modifiedAt}` : ""}.`, "کد مدل روی صفحه نیست؛ تطبیق با نام تجاری K20i انجام شد (اطمینان کم).", "امتیاز ستاره یا شمار نظر نمایش داده نمی‌شود."],
            fixture: false,
          });
        } catch (e) { details.push(`${src.id}: ${e instanceof SafeFetchError ? e.code : "unexpected"}`); }
      }
      return items.length ? { items, outcome: "ok", detail: details.join("; ") || undefined } : { items: [], outcome: details.some((d) => /NETWORK|TIMEOUT|HTTP_ERROR|PRIVATE|HOST|BLOCKED|LARGE|CONTENT|ROBOTS/.test(d)) ? "error" : "no_match", detail: details.join("; ") };
    },
  };
}
