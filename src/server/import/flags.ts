import type { DatabaseSync } from "node:sqlite";
import { flagDef, RULES_VERSION, THRESHOLDS } from "@/domain/quality";
import { keysCompatible, modelRelation } from "@/server/domain/text";

type Param = string | number | bigint | null;
export interface FlagStats {
  [code: string]: number;
}

class FlagWriter {
  private ins;
  private buf: Param[][] = [];
  readonly counts: FlagStats = {};
  constructor(private db: DatabaseSync) {
    this.ins = db.prepare("INSERT INTO quality_flags(entity_type, entity_id, code, severity, rules_version, reason, details_json) VALUES (?,?,?,?,?,?,?)");
  }
  add(code: string, entityId: string, details?: Record<string, unknown>): void {
    const d = flagDef(code);
    if (!d) throw new Error(`Unknown flag code ${code}`);
    this.buf.push([d.entity, entityId, code, d.severity, RULES_VERSION, d.reason, details ? JSON.stringify(details) : null]);
    this.counts[code] = (this.counts[code] ?? 0) + 1;
    if (this.buf.length >= 5000) this.flush();
  }
  flush(): void {
    if (!this.buf.length) return;
    this.db.exec("BEGIN");
    for (const r of this.buf) this.ins.run(...r);
    this.db.exec("COMMIT");
    this.buf = [];
  }
}

/** Set-based flag: INSERT … SELECT, ordered for deterministic ids. `select` must yield (entity_id, details_json). */
function setFlag(db: DatabaseSync, stats: FlagStats, code: string, select: string, params: Param[] = []): void {
  const d = flagDef(code)!;
  db.exec("BEGIN");
  const r = db
    .prepare(
      `INSERT INTO quality_flags(entity_type, entity_id, code, severity, rules_version, reason, details_json)
       SELECT ?, s.entity_id, ?, ?, ?, ?, s.details FROM (${select}) AS s`,
    )
    .run(d.entity, code, d.severity, RULES_VERSION, d.reason, ...params);
  db.exec("COMMIT");
  stats[code] = (stats[code] ?? 0) + Number(r.changes);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface OfferRow {
  offer_id: string;
  product_id: string;
  shop_id: string;
  seller_title: string;
  price_toman: number | null;
  unit_hint: string;
  model_keys: string;
  source_row: number;
}

export interface FlagRunInfo {
  stats: FlagStats;
  snapshotRef: string | null;
  peerComparableOffers: number;
  cohortsEvaluated: number;
}

/** Compute every quality flag. Deterministic, LLM-free, and never deletes or edits source rows. */
export function computeFlags(db: DatabaseSync, importedAtIso: string): FlagRunInfo {
  const stats: FlagStats = {};
  const snapshotRef = (db.prepare("SELECT max(price_changed_at) AS m FROM offers").get() as { m: string | null }).m;
  db.exec("DELETE FROM quality_flags");

  // ---------- offers: set-based ----------
  setFlag(db, stats, "NULL_PRICE", "SELECT offer_id AS entity_id, NULL AS details FROM offers WHERE price_toman IS NULL AND price_out_of_range = 0 AND (price_toman_raw IS NULL OR price_toman_raw IN ('null','')) ORDER BY source_row");
  setFlag(db, stats, "PRICE_MALFORMED", "SELECT offer_id AS entity_id, json_object('raw', price_toman_raw) AS details FROM offers WHERE price_toman IS NULL AND price_out_of_range = 0 AND price_toman_raw IS NOT NULL AND price_toman_raw NOT IN ('null','') ORDER BY source_row");
  setFlag(db, stats, "NONPOSITIVE_PRICE", "SELECT offer_id AS entity_id, json_object('price', price_toman) AS details FROM offers WHERE price_toman <= 0 ORDER BY source_row");
  setFlag(db, stats, "PRICE_ABSURD_MAGNITUDE", "SELECT offer_id AS entity_id, json_object('price', price_toman_raw, 'limit', ?) AS details FROM offers WHERE price_toman >= ? OR price_out_of_range = 1 ORDER BY source_row", [THRESHOLDS.absurdMagnitudeToman, THRESHOLDS.absurdMagnitudeToman]);
  setFlag(db, stats, "TIMESTAMP_MISSING", "SELECT offer_id AS entity_id, NULL AS details FROM offers WHERE price_changed_at IS NULL AND (last_price_changed_at_raw IS NULL OR last_price_changed_at_raw IN ('null','')) ORDER BY source_row");
  setFlag(db, stats, "TIMESTAMP_MALFORMED", "SELECT offer_id AS entity_id, json_object('raw', last_price_changed_at_raw) AS details FROM offers WHERE price_changed_at IS NULL AND last_price_changed_at_raw IS NOT NULL AND last_price_changed_at_raw NOT IN ('null','') ORDER BY source_row");
  setFlag(db, stats, "TIMESTAMP_FUTURE", "SELECT offer_id AS entity_id, json_object('at', price_changed_at) AS details FROM offers WHERE price_changed_at > ? ORDER BY source_row", [importedAtIso]);
  if (snapshotRef) {
    setFlag(
      db, stats, "TIMESTAMP_STALE",
      "SELECT offer_id AS entity_id, json_object('ageDays', CAST(julianday(?) - julianday(price_changed_at) AS INTEGER), 'snapshotRef', ?) AS details FROM offers WHERE price_changed_at IS NOT NULL AND julianday(?) - julianday(price_changed_at) > ? ORDER BY source_row",
      [snapshotRef, snapshotRef, snapshotRef, THRESHOLDS.staleDays],
    );
  }
  setFlag(
    db, stats, "EXACT_DUPLICATE_OFFER",
    `SELECT offer_id AS entity_id, json_object('duplicateOf', first_id) AS details FROM (
       SELECT offer_id, source_row,
              row_number() OVER w AS rn,
              first_value(offer_id) OVER w AS first_id
       FROM offers
       WINDOW w AS (PARTITION BY shop_id, product_id, COALESCE(price_toman_raw,''), seller_title ORDER BY source_row)
     ) WHERE rn > 1 ORDER BY source_row`,
  );
  setFlag(
    db, stats, "MULTI_OFFER_SAME_SHOP_PRODUCT",
    `SELECT o.offer_id AS entity_id, json_object('offersInPair', g.n) AS details FROM offers o
       JOIN (SELECT shop_id, product_id, count(*) AS n FROM offers GROUP BY shop_id, product_id HAVING n > 1) g
         ON g.shop_id = o.shop_id AND g.product_id = o.product_id ORDER BY o.source_row`,
  );

  setFlag(db, stats, "PARSE_WARRANTY_INVALID", "SELECT offer_id AS entity_id, NULL AS details FROM offers WHERE parse_issues LIKE '%PARSE_WARRANTY_INVALID%' ORDER BY source_row");

  // ---------- shops ----------
  setFlag(db, stats, "HOURS_UNKNOWN", "SELECT shop_id AS entity_id, NULL AS details FROM shops WHERE has_schedule = 0 AND (parse_issues IS NULL OR parse_issues NOT LIKE '%HOURS_INVALID%') ORDER BY source_row");
  setFlag(db, stats, "HOURS_INVALID", "SELECT shop_id AS entity_id, NULL AS details FROM shops WHERE parse_issues LIKE '%HOURS_INVALID%' ORDER BY source_row");
  setFlag(db, stats, "HOURS_PLACEHOLDER_IGNORED", "SELECT shop_id AS entity_id, json_object('placeholderShifts', placeholder_shifts) AS details FROM shops WHERE placeholder_shifts > 0 ORDER BY source_row");
  setFlag(db, stats, "HOURS_UNSUPPORTED_DAY", "SELECT shop_id AS entity_id, json_object('days', unsupported_days) AS details FROM shops WHERE unsupported_days > 0 ORDER BY source_row");
  setFlag(db, stats, "SHOP_NO_OFFERS", "SELECT shop_id AS entity_id, NULL AS details FROM shops WHERE offer_count = 0 ORDER BY source_row");
  setFlag(db, stats, "SHOP_COORDS_INVALID", "SELECT shop_id AS entity_id, NULL AS details FROM shops WHERE lat IS NULL OR lon IS NULL ORDER BY source_row");
  setFlag(
    db, stats, "SHOP_SHARED_COORDINATES",
    `SELECT s.shop_id AS entity_id, json_object('shopsAtPoint', g.n) AS details FROM shops s
       JOIN (SELECT round(lat,5) AS la, round(lon,5) AS lo, count(*) AS n FROM shops WHERE lat IS NOT NULL GROUP BY la, lo HAVING n > 1) g
         ON g.la = round(s.lat,5) AND g.lo = round(s.lon,5) ORDER BY s.source_row`,
  );
  setFlag(db, stats, "PARSE_SHOP_JSON_INVALID", "SELECT shop_id AS entity_id, NULL AS details FROM shops WHERE parse_issues LIKE '%PARSE_SHOP_JSON_INVALID%' ORDER BY source_row");

  // ---------- products ----------
  setFlag(db, stats, "PARSE_SPECS_INVALID", "SELECT product_id AS entity_id, NULL AS details FROM products WHERE parse_issues LIKE '%PARSE_SPECS_INVALID%' ORDER BY source_row");
  setFlag(db, stats, "PARSE_IMAGES_INVALID", "SELECT product_id AS entity_id, NULL AS details FROM products WHERE parse_issues LIKE '%PARSE_IMAGES_INVALID%' ORDER BY source_row");

  // ---------- offers: cohort-aware passes (bounded memory: keyset chunks of products) ----------
  const w = new FlagWriter(db);

  // category medians (only categories with enough priced offers)
  const catIt = db
    .prepare("SELECT p.category_name AS c, o.price_toman AS p FROM offers o JOIN products p ON p.product_id = o.product_id WHERE o.price_toman > 0 AND o.price_toman < ? ORDER BY p.category_name, o.price_toman")
    .iterate(THRESHOLDS.absurdMagnitudeToman) as Iterable<{ c: string; p: number }>;
  let curCat: string | null = null;
  let buf: number[] = [];
  const catMedian = new Map<string, number>();
  const flushCat = () => {
    if (curCat !== null && buf.length >= THRESHOLDS.categoryMinOffers) catMedian.set(curCat, median(buf));
    buf = [];
  };
  for (const r of catIt) {
    if (r.c !== curCat) {
      flushCat();
      curCat = r.c;
    }
    buf.push(Number(r.p));
  }
  flushCat();

  const nextIds = db.prepare("SELECT product_id FROM products WHERE product_id > ? ORDER BY product_id LIMIT 2000");
  const offersIn = db.prepare(
    "SELECT offer_id, product_id, shop_id, seller_title, price_toman, unit_hint, model_keys, source_row FROM offers WHERE product_id > ? AND product_id <= ? ORDER BY product_id, source_row",
  );
  const prodKeys = db.prepare("SELECT product_id, model_keys, category_name FROM products WHERE product_id > ? AND product_id <= ?");

  let peerComparable = 0;
  let cohorts = 0;
  let prev = "";
  for (;;) {
    const ids = nextIds.all(prev) as Array<{ product_id: string }>;
    if (ids.length === 0) break;
    const last = ids[ids.length - 1]!.product_id;
    const pinfo = new Map<string, { keys: string[]; category: string }>();
    for (const r of prodKeys.all(prev, last) as Array<{ product_id: string; model_keys: string; category_name: string }>) {
      pinfo.set(r.product_id, { keys: r.model_keys ? r.model_keys.split(" ") : [], category: r.category_name });
    }
    const rows = offersIn.all(prev, last) as unknown as OfferRow[];
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j < rows.length && rows[j]!.product_id === rows[i]!.product_id) j++;
      processProduct(rows.slice(i, j), pinfo.get(rows[i]!.product_id)!);
      i = j;
    }
    prev = last;
  }
  w.flush();

  function processProduct(offers: OfferRow[], info: { keys: string[]; category: string }): void {
    const keyOf = (o: OfferRow) => (o.model_keys ? o.model_keys.split(" ") : []);
    const seen = new Set<string>();
    const mismatch = new Set<string>();
    const dup = new Set<string>();
    for (const o of offers) {
      const k = `${o.shop_id}|${o.price_toman ?? ""}|${o.seller_title}`;
      if (seen.has(k)) dup.add(o.offer_id);
      seen.add(k);
      const rel = modelRelation(info.keys, keyOf(o));
      if (rel === "sibling") {
        mismatch.add(o.offer_id); // excluded from price cohorts
        w.add("VARIANT_MODEL_MISMATCH", o.offer_id, { productKeys: info.keys.slice(0, 6), offerKeys: keyOf(o).slice(0, 6) });
      } else if (rel === "unrelated") {
        w.add("VARIANT_MODEL_UNCONFIRMED", o.offer_id, { productKeys: info.keys.slice(0, 6), offerKeys: keyOf(o).slice(0, 6) });
      }
    }
    // mixed unit hints inside one product
    const hints = new Set(offers.map((o) => o.unit_hint).filter((h) => h !== "unknown"));
    if (hints.size >= 2) for (const o of offers) if (o.unit_hint !== "unknown") w.add("UNIT_AMBIGUOUS", o.offer_id, { hint: o.unit_hint, hintsInProduct: [...hints] });

    // variant clusters among offers that have model keys
    const clusters: string[][] = [];
    const clusterOf = new Map<string, number>();
    for (const o of offers) {
      const ok = keyOf(o);
      if (!ok.length) continue;
      let idx = clusters.findIndex((c) => keysCompatible(c, ok));
      if (idx < 0) {
        clusters.push([...ok]);
        idx = clusters.length - 1;
      } else clusters[idx]!.push(...ok);
      clusterOf.set(o.offer_id, idx);
    }

    const valid = (o: OfferRow) => o.price_toman !== null && o.price_toman > 0 && o.price_toman < THRESHOLDS.absurdMagnitudeToman && !dup.has(o.offer_id) && !mismatch.has(o.offer_id);
    const cohortsMap = new Map<string, OfferRow[]>();
    const inCohort = new Set<string>();
    for (const o of offers) {
      if (!valid(o)) continue;
      const cl = clusterOf.get(o.offer_id);
      if (cl === undefined && clusters.length >= 2) continue; // unknown variant in a multi-variant product: do not compare
      const key = `${o.unit_hint}|${cl === undefined ? 0 : cl}`;
      // when there is exactly one cluster, key-less offers join it
      const k2 = clusters.length <= 1 ? `${o.unit_hint}|0` : key;
      (cohortsMap.get(k2) ?? cohortsMap.set(k2, []).get(k2)!).push(o);
    }
    for (const [ck, members] of cohortsMap) {
      if (members.length < THRESHOLDS.peerMinCohort) continue;
      cohorts++;
      const m = median(members.map((o) => Number(o.price_toman)));
      for (const o of members) {
        peerComparable++;
        inCohort.add(o.offer_id);
        const p = Number(o.price_toman);
        if (p > m * THRESHOLDS.peerRatio) w.add("PRICE_PEER_OUTLIER_HIGH", o.offer_id, { median: m, ratio: +(p / m).toFixed(1), cohortSize: members.length, cohort: ck });
        else if (p < m / THRESHOLDS.peerRatio) w.add("PRICE_PEER_OUTLIER_LOW", o.offer_id, { median: m, ratio: +(p / m).toFixed(4), cohortSize: members.length, cohort: ck });
      }
    }
    // fallback: category-level check for offers without an eligible peer cohort
    const cm = catMedian.get(info.category);
    if (cm) {
      for (const o of offers) {
        if (inCohort.has(o.offer_id) || !valid(o)) continue;
        const p = Number(o.price_toman);
        if (p > cm * THRESHOLDS.categoryRatio) w.add("PRICE_CATEGORY_OUTLIER_HIGH", o.offer_id, { categoryMedian: cm, ratio: +(p / cm).toFixed(1) });
        else if (p < cm / THRESHOLDS.categoryRatio) w.add("PRICE_CATEGORY_OUTLIER_LOW", o.offer_id, { categoryMedian: cm, ratio: +(p / cm).toFixed(6) });
      }
    }
  }

  for (const [k, v] of Object.entries(w.counts)) stats[k] = (stats[k] ?? 0) + v;
  return { stats, snapshotRef, peerComparableOffers: peerComparable, cohortsEvaluated: cohorts };
}
