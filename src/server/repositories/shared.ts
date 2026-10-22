import type { DatabaseSync } from "node:sqlite";

/** Hard caps so no read API can trigger an unbounded scan or payload. */
export const LIMITS = {
  searchMax: 50,
  searchOffsetMax: 1000,
  offersMax: 200,
  shopsNearMax: 100,
  radiusMaxMeters: 10_000,
  textMax: 2000,
} as const;

export const clamp = (n: number | undefined, def: number, max: number): number => {
  const v = Number.isFinite(n) ? Math.trunc(n as number) : def;
  return Math.min(Math.max(v, 1), max);
};

export const clampOffset = (n: number | undefined): number => Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n as number) : 0, 0), LIMITS.searchOffsetMax);

export const clip = (s: string | null, max = LIMITS.textMax): string | null => (s === null ? null : s.length > max ? `${s.slice(0, max)}…` : s);

export interface FlagView {
  code: string;
  severity: "info" | "warn" | "error";
  reason: string;
  details: Record<string, unknown> | null;
}

export function getFlags(db: DatabaseSync, entityType: "offer" | "shop" | "product", entityId: string): FlagView[] {
  const rows = db.prepare("SELECT code, severity, reason, details_json FROM quality_flags WHERE entity_type = ? AND entity_id = ? ORDER BY id").all(entityType, entityId) as Array<{
    code: string; severity: FlagView["severity"]; reason: string; details_json: string | null;
  }>;
  return rows.map((r) => ({ code: r.code, severity: r.severity, reason: r.reason, details: r.details_json ? (JSON.parse(r.details_json) as Record<string, unknown>) : null }));
}

export interface ImportInfo {
  status: string;
  sourceKind: string;
  sourceSha256: string | null;
  importerVersion: string;
  rulesVersion: string;
  snapshotRef: string | null;
  finishedAt: string | null;
}

export function getImportInfo(db: DatabaseSync): ImportInfo | null {
  const r = db.prepare("SELECT status, source_kind, source_sha256, importer_version, rules_version, snapshot_ref, finished_at FROM import_runs WHERE status = 'complete' ORDER BY id DESC LIMIT 1").get() as
    | { status: string; source_kind: string; source_sha256: string | null; importer_version: string; rules_version: string; snapshot_ref: string | null; finished_at: string | null }
    | undefined;
  return r ? { status: r.status, sourceKind: r.source_kind, sourceSha256: r.source_sha256, importerVersion: r.importer_version, rulesVersion: r.rules_version, snapshotRef: r.snapshot_ref, finishedAt: r.finished_at } : null;
}
