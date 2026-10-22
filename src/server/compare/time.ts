import { toTehranLocal } from "@/server/domain/hours";

/** Whole Asia/Tehran calendar days since the epoch for an instant (so ages are calendar-day differences in Tehran, not 24 h blocks). */
export function tehranDayNumber(d: Date): number {
  const l = toTehranLocal(d);
  return Math.floor((d.getTime() + l.offsetMinutes * 60_000) / 86_400_000);
}

export const tehranDate = (d: Date): string => toTehranLocal(d).iso.slice(0, 10);

/** Elapsed whole Tehran calendar days from `from` to `to`; null when `from` is not a valid date. Never negative. */
export function ageDays(from: string | null | undefined, to: Date): number | null {
  if (!from) return null;
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, tehranDayNumber(to) - tehranDayNumber(new Date(t)));
}

/**
 * «YYYY-MM-DDTHH:mm» (what <input type="datetime-local"> yields) interpreted as ASIA/TEHRAN wall-clock time.
 * Iran has no DST since 2022, but the offset is looked up for that very date instead of hard-coded.
 */
export function parseTehranLocal(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(naiveUtc).getUTCMonth() !== mo - 1) return null; // e.g. 31 Feb
  let guess = new Date(naiveUtc - 210 * 60_000);
  for (let i = 0; i < 2; i++) guess = new Date(naiveUtc - toTehranLocal(guess).offsetMinutes * 60_000);
  const back = toTehranLocal(guess).iso.slice(0, 16);
  return back === input.trim() ? guess : null;
}

/** «YYYY-MM-DDTHH:mm» in Tehran for an instant (the value an <input type="datetime-local"> expects). */
export const toTehranLocalInput = (d: Date): string => toTehranLocal(d).iso.slice(0, 16);
