import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up. Does not touch the database (so a missing DB never restarts the container). */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
