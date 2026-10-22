"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronUp, GitCompareArrows, X } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { toFaDigits } from "@/lib/format";

/**
 * Compare selection (≤ 4 products): non-sensitive, kept in sessionStorage so Back/refresh/navigation don't drop it.
 * Only stable product ids and display titles are stored.
 */
export interface CompareItem {
  id: string;
  title: string;
}
const KEY = "hamghadam.compare.v1";
const MAX = 4;
const EVT = "hamghadam:compare";
const EMPTY: CompareItem[] = [];
let snapshot: CompareItem[] = EMPTY;
let loaded = false;

function read(): CompareItem[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as CompareItem[];
    return Array.isArray(v) ? v.filter((x) => x && /^product_[0-9a-f]+$/.test(x.id)).slice(0, MAX) : EMPTY;
  } catch {
    return EMPTY;
  }
}
function write(items: CompareItem[]) {
  snapshot = items;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage blocked: selection lives for this page only */
  }
  window.dispatchEvent(new Event(EVT));
}
function getSnapshot() {
  if (!loaded) { snapshot = read(); loaded = true; }
  return snapshot;
}
function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener("storage", cb); };
}

export function useCompare() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const toggle = useCallback((item: CompareItem) => {
    const cur = getSnapshot();
    if (cur.some((x) => x.id === item.id)) write(cur.filter((x) => x.id !== item.id));
    else if (cur.length < MAX) write([...cur, item]);
  }, []);
  const clear = useCallback(() => write(EMPTY), []);
  return { items, toggle, clear, full: items.length >= MAX };
}

export function CompareToggle({ id, title }: CompareItem) {
  const { items, toggle, full } = useCompare();
  const reasonId = useId();
  const on = items.some((x) => x.id === id);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Chip selected={on} onClick={() => toggle({ id, title })} disabled={!on && full} aria-describedby={!on && full ? reasonId : undefined} aria-label={`${on ? "در مقایسه" : "مقایسه"}: ${title}؛ ${on ? "حذف از مقایسه" : "افزودن به مقایسه"}`} className="rounded-xl px-3 text-xs">
        {on ? <Check aria-hidden size={16} /> : <GitCompareArrows aria-hidden size={16} />}
        {on ? "در مقایسه" : "مقایسه"}
      </Chip>
      {!on && full ? <span id={reasonId} className="max-w-32 text-[0.6875rem] leading-5 text-ink-2">حداکثر ۴ محصول؛ ابتدا یکی را حذف کنید.</span> : null}
    </span>
  );
}

export function CompareTray() {
  const { items, clear, toggle } = useCompare();
  const [expanded, setExpanded] = useState(false);
  const trayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const root = document.documentElement;
    // Reserve the measured space, including when names wrap or the list expands.
    const measure = () => root.style.setProperty("--compare-tray-height", `${tray.getBoundingClientRect().height + 12}px`);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(tray);
    return () => { observer.disconnect(); root.style.removeProperty("--compare-tray-height"); };
  }, [items.length]);
  if (items.length === 0) return null;
  const ready = items.length >= 2;
  return (
    <aside ref={trayRef} aria-label="سبد مقایسه" className="compare-tray fixed inset-x-3 z-40 mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" aria-expanded={expanded} aria-controls="compare-tray-items" onClick={() => setExpanded((v) => !v)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold">
          <GitCompareArrows aria-hidden size={18} className="text-brand" />
          <span>مقایسهٔ {toFaDigits(items.length)} محصول</span>
          {expanded ? <ChevronDown aria-hidden size={15} /> : <ChevronUp aria-hidden size={15} />}
        </button>
        {ready ? (
          <Link href={`/compare/products?ids=${items.map((i) => i.id).join(",")}`} className="ui-button inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover">مشاهده‌ی مقایسه</Link>
        ) : <p role="status" className="text-xs text-ink-2">یک محصول دیگر انتخاب کنید</p>}
      </div>
      <div id="compare-tray-items" hidden={!expanded}>
        <ul className="mt-2 flex max-h-[30dvh] min-w-0 flex-wrap gap-1.5 overflow-y-auto border-t border-line pt-3">
          {items.map((i) => (
            <li key={i.id} className="flex max-w-full items-center gap-1 rounded-xl bg-surface-2 ps-3 text-xs sm:max-w-[16rem]">
              <span className="truncate">
                <bdi>{i.title}</bdi>
              </span>
              <button type="button" onClick={() => toggle(i)} aria-label={`حذف ${i.title.slice(0, 30)} از مقایسه`} className="grid size-11 shrink-0 place-items-center text-ink-2">
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-2">حداکثر {toFaDigits(MAX)} محصول؛ انتخاب‌ها در همین تب می‌مانند.</p>
          <Button variant="ghost" onClick={() => { clear(); setExpanded(false); }} className="shrink-0 px-3 text-xs">پاک کردن</Button>
        </div>
      </div>
    </aside>
  );
}
