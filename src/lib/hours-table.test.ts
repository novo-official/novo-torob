// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DeclaredHours } from "@/domain/types";
import { hoursTable, safeShopLink } from "./hours-table";

const days = (over: Partial<DeclaredHours["days"]> = {}): DeclaredHours["days"] => ({
  sat: { kind: "declared", windows: [{ start: "09:00", end: "21:00" }] }, sun: { kind: "declared", windows: [{ start: "09:00", end: "13:00" }, { start: "16:00", end: "24:00" }] },
  mon: { kind: "closed" }, tue: { kind: "unknown" }, wed: { kind: "unsupported" }, thu: { kind: "unknown" }, fri: { kind: "closed" }, ...over,
});

describe("declared hours table", () => {
  it("labels declared windows, closed days, and unknown/unsupported as NOT closed", () => {
    const t = hoursTable({ hasSchedule: true, days: days() });
    expect(t[0]).toMatchObject({ label: "شنبه", known: true });
    expect(t[1]!.text).toContain(" و ");
    expect(t[2]).toMatchObject({ text: "تعطیل (طبق اعلام)", known: true });
    expect(t[3]).toMatchObject({ text: "اعلام نشده", known: false });
    expect(t[4]!.known).toBe(false);
  });
  it("a window ending 24:00 is shown as midnight", () => expect(hoursTable({ hasSchedule: true, days: days() })[1]!.text).toContain("۰۰:۰۰"));
});

describe("public links", () => {
  it("accepts https websites and real instagram.com profiles", () => {
    expect(safeShopLink("website", "https://www.example.ir/")).toEqual({ href: "https://www.example.ir/", label: "example.ir" });
    expect(safeShopLink("instagram", "https://www.instagram.com/tie_center/")).toEqual({ href: "https://www.instagram.com/tie_center/", label: "@tie_center" });
  });
  it("rejects javascript:, tel:, credentials, non-instagram hosts and junk", () => {
    for (const bad of ["javascript:alert(1)", "tel:+98912", "mailto:a@b.c", "https://user:pw@example.com", "https://localhost", "not a url", "", null, undefined]) expect(safeShopLink("website", bad as string)).toBeNull();
    expect(safeShopLink("instagram", "https://evil.com/instagram.com/x")).toBeNull();
    expect(safeShopLink("instagram", "https://notinstagram.com/x")).toBeNull();
  });
});
