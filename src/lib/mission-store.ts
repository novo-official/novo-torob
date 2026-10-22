import type { ShoppingMissionV1 } from "@/domain/mission";
import { MISSION_ID_RE } from "@/domain/mission";
import { parseMission } from "@/lib/mission-schema";

/**
 * Where a mission lives (PHASE 8 privacy model — all client-side, there is NO server write path):
 *   TAB     sessionStorage: temporary, this tab only, gone when the tab closes. The DEFAULT. No consent needed because it never outlives the tab.
 *   DEVICE  IndexedDB: survives refresh/restart in THIS browser profile. Written ONLY after an explicit «ذخیره روی این دستگاه».
 *   MEMORY  fallback when both are blocked (private mode, storage denied): lives until the page is closed; the shopping flow still works.
 * Missions are not synced anywhere; another device or browser never sees them. A mission id is 128-bit random and is useless on its own
 * (the server holds no missions), so a guessed/forged id can only ever reach "not found on this device".
 */
export type Where = "TAB" | "DEVICE" | "MEMORY";
export type StoreFailure = "BLOCKED" | "QUOTA" | "CONFLICT" | "UNAVAILABLE";
export type SaveResult = { ok: true; where: Where } | { ok: false; reason: StoreFailure; where: Where };

/** minimal async key-value contract; real backends below, an in-memory one for tests and the last-resort fallback */
export interface KV {
  get(id: string): Promise<unknown | undefined>;
  /** compare-and-set on `rev`: expectedRev === null means "must not exist"; undefined means "don't check" */
  put(id: string, value: unknown, expectedRev?: number | null): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<Array<{ id: string; raw: unknown }>>;
  clear(): Promise<void>;
}
export class StoreError extends Error { constructor(public readonly reason: StoreFailure) { super(reason); } }

const revOf = (v: unknown): number | null => (v && typeof v === "object" && typeof (v as { rev?: unknown }).rev === "number" ? (v as { rev: number }).rev : null);
function checkRev(existing: unknown, expected: number | null | undefined): void {
  if (expected === undefined) return;
  const cur = existing === undefined ? null : revOf(existing);
  if (expected === null ? existing !== undefined : cur !== expected) throw new StoreError("CONFLICT");
}

export function createMemoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    async get(id) { return m.has(id) ? structuredClone(m.get(id)) : undefined; },
    async put(id, value, expected) { checkRev(m.get(id), expected); m.set(id, structuredClone(value)); },
    async delete(id) { m.delete(id); },
    async list() { return [...m.entries()].map(([id, raw]) => ({ id, raw: structuredClone(raw) })); },
    async clear() { m.clear(); },
  };
}

const TAB_PREFIX = "hamghadam.mission.tab.v1:";
export function createSessionKV(storage: () => Storage = () => window.sessionStorage): KV {
  const wrap = <T,>(f: (s: Storage) => T): T => {
    try { return f(storage()); } catch (e) {
      throw new StoreError(e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22) ? "QUOTA" : "BLOCKED");
    }
  };
  const read = (s: Storage, id: string): unknown | undefined => { const raw = s.getItem(TAB_PREFIX + id); if (raw === null) return undefined; try { return JSON.parse(raw); } catch { return { __corrupt: true }; } };
  return {
    async get(id) { return wrap((s) => read(s, id)); },
    async put(id, value, expected) { wrap((s) => { checkRev(read(s, id), expected); s.setItem(TAB_PREFIX + id, JSON.stringify(value)); }); },
    async delete(id) { wrap((s) => s.removeItem(TAB_PREFIX + id)); },
    async list() { return wrap((s) => Object.keys(s).filter((k) => k.startsWith(TAB_PREFIX)).map((k) => ({ id: k.slice(TAB_PREFIX.length), raw: read(s, k.slice(TAB_PREFIX.length)) }))); },
    async clear() { wrap((s) => { for (const k of Object.keys(s).filter((x) => x.startsWith(TAB_PREFIX))) s.removeItem(k); }); },
  };
}

const IDB_NAME = "hamghadam-missions";
const IDB_STORE = "missions";
export function createIdbKV(factory: () => IDBFactory | undefined = () => (typeof indexedDB === "undefined" ? undefined : indexedDB)): KV {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    let f: IDBFactory | undefined;
    try { f = factory(); } catch { f = undefined; }
    if (!f) return reject(new StoreError("UNAVAILABLE"));
    let req: IDBOpenDBRequest;
    try { req = f.open(IDB_NAME, 1); } catch { return reject(new StoreError("BLOCKED")); }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StoreError("BLOCKED"));
    req.onblocked = () => reject(new StoreError("BLOCKED"));
  }).catch((e) => { dbp = null; throw e instanceof StoreError ? e : new StoreError("UNAVAILABLE"); }));
  const tx = async <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore, fail: (e: StoreError) => void) => Promise<T> | T): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let t: IDBTransaction;
      try { t = db.transaction(IDB_STORE, mode); } catch { dbp = null; return reject(new StoreError("UNAVAILABLE")); }
      let result: T; let failure: StoreError | null = null;
      t.oncomplete = () => (failure ? reject(failure) : resolve(result));
      t.onerror = () => reject(failure ?? new StoreError(t.error?.name === "QuotaExceededError" ? "QUOTA" : "BLOCKED"));
      t.onabort = () => reject(failure ?? new StoreError(t.error?.name === "QuotaExceededError" ? "QUOTA" : "BLOCKED"));
      try { Promise.resolve(run(t.objectStore(IDB_STORE), (e) => { failure = e; try { t.abort(); } catch { /* already finished */ } })).then((r) => { result = r; }, (e) => { failure = e instanceof StoreError ? e : new StoreError("UNAVAILABLE"); try { t.abort(); } catch { /* done */ } }); } catch { reject(new StoreError("UNAVAILABLE")); }
    });
  };
  const rq = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    get: (id) => tx("readonly", (s) => rq(s.get(id))),
    // the check and the write happen inside ONE readwrite transaction: two tabs cannot both "win"
    put: (id, value, expected) => tx("readwrite", async (s) => { checkRev(await rq(s.get(id)), expected); await rq(s.put(value, id)); }),
    delete: (id) => tx("readwrite", async (s) => { await rq(s.delete(id)); }),
    list: () => tx("readonly", async (s) => { const keys = await rq(s.getAllKeys()); const out: Array<{ id: string; raw: unknown }> = []; for (const k of keys) out.push({ id: String(k), raw: await rq(s.get(k)) }); return out; }),
    clear: () => tx("readwrite", async (s) => { await rq(s.clear()); }),
  };
}

export interface Located { mission: ShoppingMissionV1; where: Where }
export interface ListResult { items: Located[]; unreadable: Array<{ id: string; where: Where; reason: string }> }

export interface MissionStore {
  load(id: string): Promise<{ found: Located | null; unreadable: string | null }>;
  /** write; `expectedRev` = the rev this client last saw (null = must be new) */
  save(m: ShoppingMissionV1, where: Where, expectedRev: number | null): Promise<SaveResult>;
  /** the ONLY way a mission reaches the device store: explicit user action. Notes are removed unless `keepNotes`. */
  saveToDevice(m: ShoppingMissionV1, keepNotes: boolean): Promise<SaveResult>;
  forgetFromDevice(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** delete EVERYTHING this app stored locally (tab + device + memory) */
  deleteAll(): Promise<{ ok: boolean }>;
  list(): Promise<ListResult>;
  /** which backends actually work right now (for honest UI) */
  probe(): Promise<{ tab: boolean; device: boolean }>;
}

export function createMissionStore(b: { tab: KV; device: KV; memory?: KV }): MissionStore {
  const memory = b.memory ?? createMemoryKV();
  const order: Array<[Where, KV]> = [["TAB", b.tab], ["DEVICE", b.device], ["MEMORY", memory]];
  const fail = (e: unknown, where: Where): SaveResult => ({ ok: false, reason: e instanceof StoreError ? e.reason : "UNAVAILABLE", where });
  const readFrom = async (kv: KV, id: string): Promise<unknown | undefined | "ERR"> => { try { return await kv.get(id); } catch { return "ERR"; } };

  const store: MissionStore = {
    async load(id) {
      if (!MISSION_ID_RE.test(id)) return { found: null, unreadable: null };
      let unreadable: string | null = null;
      for (const [where, kv] of order) {
        const raw = await readFrom(kv, id);
        if (raw === undefined || raw === "ERR") continue;
        const p = parseMission(raw);
        if (!p.ok) { unreadable = p.reason; continue; }
        if (p.mission.id !== id) { unreadable = "ID_MISMATCH"; continue; } // a record stored under another key is not trusted
        return { found: { mission: p.mission, where }, unreadable: null };
      }
      return { found: null, unreadable };
    },
    async save(m, where, expectedRev) {
      const kv = order.find(([w]) => w === where)![1];
      try { await kv.put(m.id, m, expectedRev); return { ok: true, where }; } catch (e) {
        const r = fail(e, where);
        if (!r.ok && r.reason !== "CONFLICT" && where === "TAB") { try { await memory.put(m.id, m); return { ok: true, where: "MEMORY" }; } catch { /* memory cannot fail */ } }
        return r;
      }
    },
    async saveToDevice(m, keepNotes) {
      const copy: ShoppingMissionV1 = { ...m, notes: keepNotes ? m.notes : null };
      try {
        await b.device.put(m.id, copy);
        try { await b.tab.delete(m.id); } catch { /* tab copy is only a temporary duplicate */ }
        return { ok: true, where: "DEVICE" };
      } catch (e) { return fail(e, "DEVICE"); }
    },
    async forgetFromDevice(id) { try { await b.device.delete(id); return true; } catch { return false; } },
    async remove(id) {
      let ok = true;
      for (const [, kv] of order) { try { await kv.delete(id); } catch { ok = false; } }
      return ok;
    },
    async deleteAll() {
      let ok = true;
      for (const [, kv] of order) { try { await kv.clear(); } catch { ok = false; } }
      return { ok };
    },
    async list() {
      const items: Located[] = []; const unreadable: ListResult["unreadable"] = [];
      for (const [where, kv] of order) {
        let rows: Array<{ id: string; raw: unknown }> = [];
        try { rows = await kv.list(); } catch { continue; }
        for (const r of rows) {
          const p = parseMission(r.raw);
          if (p.ok && p.mission.id === r.id) items.push({ mission: p.mission, where }); else unreadable.push({ id: r.id, where, reason: p.ok ? "ID_MISMATCH" : p.reason });
        }
      }
      items.sort((a, c) => (a.mission.updatedAt < c.mission.updatedAt ? 1 : -1));
      return { items, unreadable };
    },
    async probe() {
      const t = async (kv: KV) => { try { await kv.get("probe"); return true; } catch { return false; } };
      return { tab: await t(b.tab), device: await t(b.device) };
    },
  };
  return store;
}

let singleton: MissionStore | null = null;
export const getMissionStore = (): MissionStore => (singleton ??= createMissionStore({ tab: createSessionKV(), device: createIdbKV() }));
