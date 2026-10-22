"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyAll, createMission, missionReducer, newMissionId, type MissionEvent, type MissionResult, type ShoppingMissionV1 } from "@/domain/mission";
import { getMissionStore, type MissionStore, type StoreFailure, type Where } from "@/lib/mission-store";

export type LoadState = "loading" | "ready" | "missing" | "unreadable";
export interface UseMission {
  state: LoadState;
  mission: ShoppingMissionV1 | null;
  where: Where | null;
  /** last storage problem (blocked/quota/unavailable); the flow keeps working from memory */
  issue: StoreFailure | null;
  /** another tab changed this mission: the newer version was loaded */
  conflict: boolean;
  dispatch: (e: MissionEvent, opts?: { readyNow?: boolean }) => MissionResult;
  saveToDevice: (keepNotes: boolean) => Promise<boolean>;
  forgetFromDevice: () => Promise<boolean>;
  remove: () => Promise<boolean>;
  dismissConflict: () => void;
}

const nowIso = () => new Date().toISOString();

/**
 * Owns ONE mission in the browser. Events are applied synchronously on a ref (so fast double-clicks / rapid switching compose in order
 * instead of racing stale React state), then persisted through a single FIFO queue with compare-and-set on `rev`.
 * `seed` builds a brand-new TEMPORARY mission when the id is not found and the URL carried a valid context.
 */
export function useMission(id: string, seed: MissionEvent[] | null, store: MissionStore = getMissionStore()): UseMission {
  const [state, setState] = useState<LoadState>("loading");
  const [mission, setMission] = useState<ShoppingMissionV1 | null>(null);
  const [where, setWhere] = useState<Where | null>(null);
  const [issue, setIssue] = useState<StoreFailure | null>(null);
  const [conflict, setConflict] = useState(false);
  const cur = useRef<ShoppingMissionV1 | null>(null);
  const whereRef = useRef<Where>("TAB");
  const savedRev = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  const seedRef = useRef(seed);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      const r = await store.load(id);
      if (cancelled) return;
      if (r.found) {
        cur.current = r.found.mission; whereRef.current = r.found.where; savedRev.current = r.found.mission.rev;
        setMission(r.found.mission); setWhere(r.found.where); setState("ready");
        return;
      }
      if (r.unreadable) { setState("unreadable"); return; }
      if (seedRef.current) {
        const made = applyAll(createMission(id, nowIso()), seedRef.current, nowIso());
        if (made.ok) {
          cur.current = made.mission; whereRef.current = "TAB"; savedRev.current = null;
          setMission(made.mission); setWhere("TAB"); setState("ready");
          const res = await store.save(made.mission, "TAB", null);
          if (cancelled) return;
          if (res.ok) { savedRev.current = made.mission.rev; whereRef.current = res.where; setWhere(res.where); if (res.where === "MEMORY") setIssue("BLOCKED"); }
          else setIssue(res.reason);
          return;
        }
      }
      setState("missing");
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [id, store]);

  const enqueue = useCallback((next: ShoppingMissionV1) => {
    queue.current = queue.current.then(async () => {
      if (!alive.current) return;
      const res = await store.save(next, whereRef.current, savedRev.current);
      if (!alive.current) return;
      if (res.ok) {
        savedRev.current = next.rev;
        if (res.where !== whereRef.current) { whereRef.current = res.where; setWhere(res.where); }
        setIssue(res.where === "MEMORY" ? "BLOCKED" : null);
      } else if (res.reason === "CONFLICT") {
        const fresh = await store.load(id);
        if (fresh.found && alive.current) { cur.current = fresh.found.mission; savedRev.current = fresh.found.mission.rev; whereRef.current = fresh.found.where; setMission(fresh.found.mission); setWhere(fresh.found.where); setConflict(true); }
      } else setIssue(res.reason);
    });
  }, [id, store]);

  const dispatch = useCallback((e: MissionEvent, opts?: { readyNow?: boolean }): MissionResult => {
    const m = cur.current;
    if (!m) return { ok: false, error: "NOT_ACTIVE", messageFa: "ماموریت بارگذاری نشده است." };
    const r = missionReducer(m, e, nowIso(), opts);
    if (r.ok && r.changed) { cur.current = r.mission; setMission(r.mission); enqueue(r.mission); }
    return r;
  }, [enqueue]);

  const saveToDevice = useCallback(async (keepNotes: boolean): Promise<boolean> => {
    if (!cur.current) return false;
    if (!keepNotes && cur.current.notes) dispatch({ type: "SET_NOTES", text: null, consent: false });
    await queue.current;
    const m = cur.current!;
    const res = await store.saveToDevice(m, keepNotes);
    if (!alive.current) return res.ok;
    if (res.ok) { whereRef.current = "DEVICE"; savedRev.current = m.rev; setWhere("DEVICE"); setIssue(null); } else setIssue(res.reason);
    return res.ok;
  }, [dispatch, store]);

  const forgetFromDevice = useCallback(async (): Promise<boolean> => {
    const m = cur.current;
    if (!m) return false;
    await queue.current;
    const ok = await store.forgetFromDevice(m.id);
    if (!ok) return false;
    whereRef.current = "TAB"; setWhere("TAB");
    const res = await store.save(m, "TAB", null);
    if (res.ok) { savedRev.current = m.rev; whereRef.current = res.where; setWhere(res.where); }
    return true;
  }, [store]);

  const remove = useCallback(async (): Promise<boolean> => {
    await queue.current;
    const ok = await store.remove(id);
    if (ok) { cur.current = null; setMission(null); setState("missing"); }
    return ok;
  }, [id, store]);

  return { state, mission, where, issue, conflict, dispatch, saveToDevice, forgetFromDevice, remove, dismissConflict: () => setConflict(false) };
}

export { newMissionId };
