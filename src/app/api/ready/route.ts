import { NextResponse } from "next/server";
import { DatabaseUnavailableError, getImportInfo, getReadDb } from "@/server";

export const dynamic = "force-dynamic";

/** Readiness: the dataset database exists, opens read-only and holds a completed import. */
export function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const db = getReadDb();
    const info = getImportInfo(db);
    if (!info) return NextResponse.json({ status: "not_ready", reason: "no completed import" }, { status: 503, headers });
    db.prepare("SELECT 1 FROM products LIMIT 1").get();
    return NextResponse.json(
      { status: "ready", import: { rulesVersion: info.rulesVersion, importerVersion: info.importerVersion, snapshotRef: info.snapshotRef, finishedAt: info.finishedAt } },
      { headers },
    );
  } catch (e) {
    const reason = e instanceof DatabaseUnavailableError ? "database file missing" : "database error";
    return NextResponse.json({ status: "not_ready", reason }, { status: 503, headers });
  }
}
