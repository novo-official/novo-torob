import { describe, expect, it } from "vitest";
import { evaluateHours, parseWeeklyHours, toTehranLocal } from "./hours";

const day = (status: string, shifts: Array<[string, string]>) => ({ status, shifts: shifts.map(([s, e]) => ({ start_time: s, end_time: e })) });
const week = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    sat: day("declared", [["09:30:00", "19:30:00"], ["00:00:00", "00:00:00"]]),
    sun: day("declared", [["09:30:00", "13:00:00"], ["16:00:00", "20:00:00"]]),
    mon: day("declared", [["10:00:00", "19:00:00"]]),
    tue: day("declared", [["10:00:00", "19:00:00"]]),
    wed: day("declared", [["10:00:00", "19:00:00"]]),
    thu: day("declared", [["10:00:00", "14:00:00"]]),
    fri: day("closed", [["00:00:00", "00:00:00"]]),
    ...over,
  });

// 2026-10-21 is a Wednesday. Tehran = UTC+03:30 → 11:00 local = 07:30Z.
const at = (isoLocal: string) => new Date(`${isoLocal}+03:30`);

describe("parseWeeklyHours", () => {
  it("strips placeholder shifts and never reads 00:00–00:00 as 24/7", () => {
    const p = parseWeeklyHours(week());
    // only Saturday's second shift is a placeholder on a declared day; Friday is a closed day
    expect(p.placeholderShifts).toBe(1);
    expect(p.hours.days.sat).toEqual({ kind: "declared", windows: [{ start: "09:30", end: "19:30" }] });
    expect(p.hours.days.fri).toEqual({ kind: "closed" });
  });
  it("keeps real split shifts", () => {
    const p = parseWeeklyHours(week());
    expect(p.hours.days.sun).toEqual({ kind: "declared", windows: [{ start: "09:30", end: "13:00" }, { start: "16:00", end: "20:00" }] });
  });
  it("keeps a legitimate 00:00–23:45 window (different from a placeholder)", () => {
    const p = parseWeeklyHours(week({ mon: day("declared", [["00:00:00", "23:45:00"]]) }));
    expect(p.hours.days.mon).toEqual({ kind: "declared", windows: [{ start: "00:00", end: "23:45" }] });
  });
  it("treats an empty object, null, 'null' and '' as NO schedule (unknown)", () => {
    for (const raw of ["{}", null, "null", "", undefined]) expect(parseWeeklyHours(raw).hours.hasSchedule).toBe(false);
  });
  it("flags invalid JSON as invalid, still unknown", () => {
    const p = parseWeeklyHours("{not json");
    expect(p.invalid).toBe(true);
    expect(p.hours.hasSchedule).toBe(false);
  });
  it("a declared day containing only a placeholder becomes unknown (not closed, not 24/7)", () => {
    const p = parseWeeklyHours(week({ mon: day("declared", [["00:00:00", "00:00:00"]]) }));
    expect(p.hours.days.mon).toEqual({ kind: "unknown" });
  });
  it("counts unsupported days as unknown-ish, separately", () => {
    const p = parseWeeklyHours(week({ tue: day("unsupported", [["08:00:00", "08:00:00"]]) }));
    expect(p.hours.days.tue).toEqual({ kind: "unsupported" });
    expect(p.unsupportedDays).toBe(1);
  });
  it("maps end 00:00 with a later start to 'until midnight' (24:00)", () => {
    const p = parseWeeklyHours(week({ mon: day("declared", [["18:00:00", "00:00:00"]]) }));
    expect(p.hours.days.mon).toEqual({ kind: "declared", windows: [{ start: "18:00", end: "24:00" }] });
  });
  it("rejects malformed clock values without throwing", () => {
    const p = parseWeeklyHours(week({ mon: day("declared", [["xx", "19:00:00"]]) }));
    expect(p.invalid).toBe(true);
  });
});

describe("toTehranLocal", () => {
  it("uses Asia/Tehran (UTC+03:30) and Saturday-based weekday names", () => {
    const l = toTehranLocal(new Date("2026-10-21T07:30:00Z"));
    expect(l.weekday).toBe("wed");
    expect(l.minutes).toBe(11 * 60);
    expect(l.offsetMinutes).toBe(210);
    expect(l.iso).toBe("2026-10-21T11:00:00+03:30");
  });
  it("rolls the local day over relative to UTC (21:00Z Wed is already Thu 00:30 in Tehran)", () => {
    expect(toTehranLocal(new Date("2026-10-21T21:00:00Z")).weekday).toBe("thu");
  });
});

describe("evaluateHours", () => {
  const h = parseWeeklyHours(week()).hours;

  it("open inside a window, with the declared close as next change", () => {
    const r = evaluateHours(h, at("2026-10-21T11:00:00"));
    expect(r.status).toMatchObject({ state: "open", reasonCode: "WITHIN_WINDOW", declared: true });
    expect(r.evidence.window).toEqual({ start: "10:00", end: "19:00" });
    expect(r.status.nextChange?.to).toBe("closed");
    expect(r.status.nextChange?.at).toBe(at("2026-10-21T19:00:00").toISOString());
  });
  it("closed outside the declared window of a declared day, with next opening", () => {
    const r = evaluateHours(h, at("2026-10-21T20:00:00"));
    expect(r.status).toMatchObject({ state: "closed", reasonCode: "OUTSIDE_WINDOW" });
    expect(r.status.nextChange).toEqual({ at: at("2026-10-22T10:00:00").toISOString(), to: "open" });
  });
  it("end of window is exclusive", () => {
    expect(evaluateHours(h, at("2026-10-21T19:00:00")).status.state).toBe("closed");
    expect(evaluateHours(h, at("2026-10-21T10:00:00")).status.state).toBe("open");
  });
  it("genuine second shift: open in both, closed in the gap", () => {
    // Sunday 2026-10-25
    expect(evaluateHours(h, at("2026-10-25T10:00:00")).status.state).toBe("open");
    expect(evaluateHours(h, at("2026-10-25T14:30:00")).status.state).toBe("closed");
    expect(evaluateHours(h, at("2026-10-25T17:00:00")).status.state).toBe("open");
  });
  it("Friday declared closed → closed (DAY_CLOSED), with next opening Saturday", () => {
    const r = evaluateHours(h, at("2026-10-23T12:00:00"));
    expect(r.status).toMatchObject({ state: "closed", reasonCode: "DAY_CLOSED" });
    expect(r.status.nextChange?.at).toBe(at("2026-10-24T09:30:00").toISOString());
  });
  it("placeholder-only day is UNKNOWN, never closed and never open", () => {
    const hh = parseWeeklyHours(week({ wed: day("declared", [["00:00:00", "00:00:00"]]) })).hours;
    expect(evaluateHours(hh, at("2026-10-21T03:00:00")).status).toMatchObject({ state: "unknown", reasonCode: "NO_REAL_WINDOWS" });
  });
  it("no schedule at all → unknown at any time", () => {
    const none = parseWeeklyHours("{}").hours;
    for (const t of ["2026-10-21T03:00:00", "2026-10-21T12:00:00", "2026-10-23T12:00:00"]) {
      expect(evaluateHours(none, at(t)).status).toMatchObject({ state: "unknown", reasonCode: "NO_SCHEDULE" });
    }
  });
  it("unsupported day → unknown (UNSUPPORTED_DAY)", () => {
    const hh = parseWeeklyHours(week({ wed: day("unsupported", [["08:00:00", "08:00:00"]]) })).hours;
    expect(evaluateHours(hh, at("2026-10-21T12:00:00")).status).toMatchObject({ state: "unknown", reasonCode: "UNSUPPORTED_DAY" });
  });
  it("crossing midnight: Wed 22:00–02:00 is open Wed 23:00 and Thu 01:00, closed Thu 02:00", () => {
    const hh = parseWeeklyHours(week({ wed: day("declared", [["22:00:00", "02:00:00"]]), thu: day("declared", [["10:00:00", "14:00:00"]]) })).hours;
    expect(evaluateHours(hh, at("2026-10-21T23:00:00")).status.state).toBe("open");
    const early = evaluateHours(hh, at("2026-10-22T01:00:00"));
    expect(early.status.state).toBe("open");
    expect(early.status.nextChange?.at).toBe(at("2026-10-22T02:00:00").toISOString());
    expect(evaluateHours(hh, at("2026-10-22T02:00:00")).status.state).toBe("closed");
  });
  it("crossing midnight covers an otherwise-unknown following day (open), not unknown", () => {
    const hh = parseWeeklyHours(week({ wed: day("declared", [["22:00:00", "02:00:00"]]), thu: day("declared", [["00:00:00", "00:00:00"]]) })).hours;
    expect(evaluateHours(hh, at("2026-10-22T01:00:00")).status.state).toBe("open");
    expect(evaluateHours(hh, at("2026-10-22T05:00:00")).status.state).toBe("unknown");
  });
  it("until-midnight window (18:00–24:00) is open at 23:59 and the week wraps correctly", () => {
    const hh = parseWeeklyHours(week({ fri: day("declared", [["18:00:00", "00:00:00"]]) })).hours;
    expect(evaluateHours(hh, at("2026-10-23T23:59:00")).status.state).toBe("open");
    // Saturday 00:30 — the Friday window ended at midnight
    expect(evaluateHours(hh, at("2026-10-24T00:30:00")).status.state).toBe("closed");
  });
  it("uses Tehran time, not the server's: 21:00Z Wednesday is Thursday 00:30 local", () => {
    const hh = parseWeeklyHours(week()).hours;
    const r = evaluateHours(hh, new Date("2026-10-21T21:00:00Z"));
    expect(r.evidence.weekday).toBe("thu");
    expect(r.status.state).toBe("closed");
  });
});
