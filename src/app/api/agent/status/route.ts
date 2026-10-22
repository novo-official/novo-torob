import { json } from "@/server/api";
import { publicStatus } from "@/server/agent/config";
import { getRuntime } from "@/server/agent/runtime";

export const dynamic = "force-dynamic";

/** GET /api/agent/status — what the UI may know (mode label, evidence mode). Never keys, base URLs or limits internals. */
export function GET() {
  return json(publicStatus(getRuntime().config));
}
