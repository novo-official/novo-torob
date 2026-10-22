"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import { GitCompareArrows, X } from "lucide-react";
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
  const on = items.some((x) => x.id === id);
  return (
    <Chip selected={on} onClick={() => toggle({ id, title })} disabled={!on && full} aria-label={`${on ? "حذف از مقایسه" : "افزودن به مقایسه"}: ${title.slice(0, 40)}`}>
      <GitCompareArrows aria-hidden size={16} />
      {on ? "در مقایسه" : "مقایسه"}
    </Chip>
  );
}

export function CompareTray() {
  const { items, clear, toggle } = useCompare();
  if (items.length === 0) return null;
  const ready = items.length >= 2;
  return (
    <aside aria-label="سبد مقایسه" className="fixed inset-x-3 bottom-[4.5rem] z-40 mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-3 shadow-lg md:bottom-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold">مقایسه ({toFaDigits(items.length)} از {toFaDigits(MAX)})</p>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex max-w-[11rem] items-center gap-1 rounded-full bg-surface-2 ps-3 text-xs">
              <span className="truncate">
                <bdi>{i.title}</bdi>
              </span>
              <button type="button" onClick={() => toggle(i)} aria-label={`حذف ${i.title.slice(0, 30)} از مقایسه`} className="grid size-11 shrink-0 place-items-center text-ink-2">
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          {ready ? (
            <Link href={`/compare/products?ids=${items.map((i) => i.id).join(",")}`} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover">
              مشاهده‌ی مقایسه
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center px-2 text-xs text-ink-2">دست‌کم ۲ محصول انتخاب کنید</span>
          )}
          <Button variant="ghost" onClick={clear} className="px-3 text-xs">
            پاک کردن
          </Button>
        </div>
      </div>
    </aside>
  );
}
