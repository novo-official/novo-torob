import type { DayStatus, DeclaredHours, OpenState, OpenStatus, TimeWindow, Weekday } from "@/domain/types";

/** Iranian week starts on Saturday. Index = offset from Saturday. */
export const WEEKDAYS: readonly Weekday[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as const;
const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;

export const TEHRAN_TZ = "Asia/Tehran";

export interface ParsedHours {
  hours: DeclaredHours;
  /** Machine-readable notes for quality flags. */
  placeholderShifts: number;
  unsupportedDays: number;
  invalid: boolean;
}

const unknownDays = (): Record<Weekday, DayStatus> => ({
  sat: { kind: "unknown" }, sun: { kind: "unknown" }, mon: { kind: "unknown" }, tue: { kind: "unknown" },
  wed: { kind: "unknown" }, thu: { kind: "unknown" }, fri: { kind: "unknown" },
});

export const NO_SCHEDULE: DeclaredHours = { hasSchedule: false, days: unknownDays() };

function parseClock(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * Parse the dataset's `weekly_hours` JSON defensively.
 *  - start == end (e.g. 00:00–00:00) is a PLACEHOLDER: ignored, never "24/7".
 *  - end 00:00 with start > 00:00 means "until midnight" → stored as 24:00.
 *  - end < start crosses midnight (kept as-is; evaluated across the day boundary).
 *  - a legitimate 00:00–23:45 window is kept.
 *  - missing / invalid schedule → hasSchedule=false (unknown, NOT closed).
 */
export function parseWeeklyHours(raw: string | null | undefined): ParsedHours {
  const none = (invalid: boolean): ParsedHours => ({ hours: { hasSchedule: false, days: unknownDays() }, placeholderShifts: 0, unsupportedDays: 0, invalid });
  if (raw === null || raw === undefined || raw === "" || raw === "null") return none(false);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return none(true);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return none(true);
  const obj = json as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return none(false);

  const days = unknownDays();
  let placeholderShifts = 0;
  let unsupportedDays = 0;
  let invalid = false;
  let anyKnown = false;

  for (const d of WEEKDAYS) {
    const entry = obj[d] as { status?: unknown; shifts?: unknown } | undefined;
    if (!entry || typeof entry !== "object") continue;
    const status = entry.status;
    if (status === "closed") {
      days[d] = { kind: "closed" };
      anyKnown = true;
      continue;
    }
    if (status === "unsupported") {
      days[d] = { kind: "unsupported" };
      unsupportedDays++;
      continue;
    }
    if (status !== "declared") {
      invalid = true;
      continue;
    }
    const windows: TimeWindow[] = [];
    const shifts = Array.isArray(entry.shifts) ? entry.shifts : [];
    for (const sh of shifts as Array<{ start_time?: unknown; end_time?: unknown }>) {
      const a = parseClock(sh?.start_time);
      let b = parseClock(sh?.end_time);
      if (a === null || b === null) {
        invalid = true;
        continue;
      }
      if (a === b) {
        placeholderShifts++;
        continue;
      }
      if (b === 0 && a > 0) b = DAY_MIN; // until midnight
      windows.push({ start: fmt(a), end: b === DAY_MIN ? "24:00" : fmt(b) });
    }
    windows.sort((x, y) => x.start.localeCompare(y.start));
    // A "declared" day with no real window carries no information → unknown (not closed, not 24/7).
    days[d] = windows.length > 0 ? { kind: "declared", windows } : { kind: "unknown" };
    if (windows.length > 0) anyKnown = true;
  }
  return { hours: { hasSchedule: anyKnown, days }, placeholderShifts, unsupportedDays, invalid };
}

// ---------- evaluation (Asia/Tehran, "as declared") ----------

export interface TehranLocal {
  weekday: Weekday;
  minutes: number; // minutes since local midnight
  offsetMinutes: number; // local - UTC
  iso: string; // local ISO with offset
}

const WEEKDAY_FROM_INTL: Record<string, Weekday> = { Sat: "sat", Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri" };

const fmtParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TEHRAN_TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function toTehranLocal(instant: Date): TehranLocal {
  const p: Record<string, string> = {};
  for (const part of fmtParts.formatToParts(instant)) p[part.type] = part.value;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const localAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, minute, Number(p.second));
  const offsetMinutes = Math.round((localAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const iso = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return { weekday: WEEKDAY_FROM_INTL[p.weekday!]!, minutes: hour * 60 + minute, offsetMinutes, iso };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

interface Interval { start: number; end: number } // week-minute space, may exceed WEEK_MIN (wraps)

function weekIntervals(hours: DeclaredHours): Interval[] {
  const out: Interval[] = [];
  WEEKDAYS.forEach((d, i) => {
    const day = hours.days[d];
    if (day.kind !== "declared") return;
    for (const w of day.windows) {
      const s = i * DAY_MIN + toMin(w.start);
      let e = i * DAY_MIN + toMin(w.end);
      if (e <= s) e += DAY_MIN; // crosses midnight
      out.push({ start: s, end: e });
    }
  });
  return out;
}

export interface HoursEvaluation {
  status: OpenStatus;
  evidence: {
    tehranTime: string;
    weekday: Weekday;
    dayKind: DayStatus["kind"];
    window: TimeWindow | null;
    note: string;
  };
}

/**
 * Evaluate DECLARED hours at an instant in Asia/Tehran.
 *  - open    : inside a declared window (including the tail of a previous day's midnight-crossing window)
 *  - closed  : the day is declared with windows (or explicitly closed) and the instant is outside them
 *  - unknown : no schedule, unsupported day, or a day with no real window — NEVER mapped to closed.
 * "as declared": this is what the shop reported, not live proof that it is open.
 */
export function evaluateHours(hours: DeclaredHours, instant: Date): HoursEvaluation {
  const local = toTehranLocal(instant);
  const dayIdx = WEEKDAYS.indexOf(local.weekday);
  const t = dayIdx * DAY_MIN + local.minutes;
  const day = hours.days[local.weekday];
  const base = { tehranTime: local.iso, weekday: local.weekday, dayKind: day.kind };

  if (!hours.hasSchedule) {
    return { status: { state: "unknown", declared: true, reasonCode: "NO_SCHEDULE" }, evidence: { ...base, window: null, note: "برنامه‌ی کاری ثبت نشده است." } };
  }

  const intervals = weekIntervals(hours);
  const covering = intervals.find((iv) => (t >= iv.start && t < iv.end) || (t + WEEK_MIN >= iv.start && t + WEEK_MIN < iv.end));
  const shift = (n: number): string => new Date(instant.getTime() + n * 60000).toISOString();

  if (covering) {
    const rel = t >= covering.start && t < covering.end ? covering.end - t : covering.end - (t + WEEK_MIN);
    const startMin = ((covering.start % DAY_MIN) + DAY_MIN) % DAY_MIN;
    const endMin = covering.end % DAY_MIN;
    return {
      status: { state: "open", declared: true, reasonCode: "WITHIN_WINDOW", nextChange: { at: shift(rel), to: "closed" } },
      evidence: { ...base, window: { start: fmt(startMin), end: endMin === 0 ? "24:00" : fmt(endMin) }, note: "داخل بازه‌ی اعلام‌شده (طبق اعلام فروشگاه)." },
    };
  }

  // Not covered: what do we actually know about today?
  if (day.kind === "unknown" || day.kind === "unsupported") {
    return {
      status: { state: "unknown", declared: true, reasonCode: day.kind === "unsupported" ? "UNSUPPORTED_DAY" : "NO_REAL_WINDOWS" },
      evidence: { ...base, window: null, note: "برای این روز ساعت واقعی اعلام نشده؛ نامشخص است، نه بسته." },
    };
  }

  // next opening within the coming week
  let next: { at: string } | undefined;
  let best = Infinity;
  for (const iv of intervals) {
    for (const k of [0, WEEK_MIN]) {
      const d = iv.start + k - t;
      if (d > 0 && d < best) best = d;
    }
  }
  if (best !== Infinity) next = { at: shift(best) };
  const closedStatus: OpenStatus = {
    state: "closed" as OpenState,
    declared: true,
    reasonCode: day.kind === "closed" ? "DAY_CLOSED" : "OUTSIDE_WINDOW",
    ...(next ? { nextChange: { at: next.at, to: "open" as OpenState } } : {}),
  };
  return {
    status: closedStatus,
    evidence: { ...base, window: null, note: day.kind === "closed" ? "این روز طبق اعلام فروشگاه تعطیل است." : "خارج از بازه‌های اعلام‌شده‌ی امروز." },
  };
}
