import { json } from "@/server/api";
import { publicStatus } from "@/server/agent/config";
import { isAdmin } from "@/server/agent/admin";
import { getRuntime } from "@/server/agent/runtime";

export const dynamic = "force-dynamic";

/** GET /api/agent/status — what the UI may know (mode label, evidence mode). Never keys, base URLs or limits internals. Non-admins always see the public (offline planner) mode. */
export function GET(req: Request) {
  const rt = getRuntime();
  return json(publicStatus(rt.config.provider === "openai-compatible" && isAdmin(req.headers) ? rt.config : rt.publicConfig));
}
