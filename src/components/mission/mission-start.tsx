"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { applyAll, createMission, newMissionId } from "@/domain/mission";
import { ButtonLink } from "@/components/ui";
import { getMissionStore } from "@/lib/mission-store";
import { seedEvents } from "@/lib/mission-seed";
import { buildMissionPageHref, buildMissionStartHref, parseMissionSeed } from "@/lib/mission-url";

/** Creates a TEMPORARY (this-tab) mission from a validated context and opens it. Nothing is stored on the device without the user's explicit save. */
export function MissionStart() {
  const sp = useSearchParams();
  const router = useRouter();
  const once = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const seed = parseMissionSeed((k) => sp.get(k));
    const events = seedEvents(seed);
    const at = new Date().toISOString();
    const id = newMissionId();
    const made = applyAll(createMission(id, at), events, at);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!made.ok) { setErr(made.messageFa); return; }
    void getMissionStore().save(made.mission, "TAB", null).then((res) => {
      // when every browser store is blocked the URL carries the (non-sensitive) ids so a refresh can rebuild the mission
      const base = buildMissionPageHref(id);
      router.replace(res.ok && res.where === "MEMORY" ? `${base}?${new URL(buildMissionStartHref(seed), "http://x").searchParams.toString()}` : base);
    });
  }, [sp, router]);
  if (err) return <div role="alert" className="space-y-3 rounded-xl bg-danger-bg p-4 text-danger-ink" data-testid="start-error"><p>{err}</p><ButtonLink href="/discover">شروع از مشاور</ButtonLink></div>;
  return <p role="status" className="flex items-center gap-2 rounded-xl bg-surface-2 p-4 text-sm" data-testid="mission-starting"><Loader2 aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />در حال ساختن ماموریت…</p>;
}
