import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ctxOf } from "@/domain/inquiry.test";
import { InquiryWorkspace } from "./inquiry-workspace";
import { storageKey } from "@/lib/inquiry-storage";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => "/missions/new", useSearchParams: () => new URLSearchParams() }));

const ctx = ctxOf({}, { shop: { ...ctxOf().shop, website: { href: "https://example.ir/", label: "example.ir" }, instagram: null } });
const KEY = storageKey({ product: ctx.product.id, shop: ctx.shop.id, offer: ctx.offer.id });
const FORBIDDEN = /ارسال\s*شد|ارسال\s*شده|پیام شما فرستاده|موجودی تأیید شد(?!»)|تحویل داده شد/;
const ui = () => render(<InquiryWorkspace ctx={ctx} visitDefault="2026-10-22T12:00" back="/compare?product=product_aaaaaaaa" />);

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { window.sessionStorage.clear(); replace.mockClear(); fetchSpy = vi.spyOn(globalThis, "fetch"); });
afterEach(() => { cleanup(); fetchSpy.mockRestore(); });

describe("InquiryWorkspace — manual mode", () => {
  it("shows the recorded facts with dataset provenance, the unknowns, and NO contact channel", () => {
    const { container } = ui();
    expect(screen.getByTestId("ctx-price")).toHaveTextContent("۴٬۱۰۰٬۰۰۰ تومان");
    expect(screen.getAllByText(/قیمت امروز نیست/).length).toBeGreaterThan(0);
    expect(screen.getByText("موجودی تأییدنشده")).toBeInTheDocument();
    expect(screen.getByText(/راه ارتباطی تأییدشده‌ای وجود ندارد/)).toBeInTheDocument();
    expect(container.querySelector('a[href^="tel:"], a[href^="sms:"], a[href*="wa.me"], a[href*="whatsapp"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\b09\d{9}\b/);
  });
  it("public links are plain external profile links opened only by the user, with noopener", () => {
    ui();
    const a = screen.getByRole("link", { name: /وب‌سایت: example\.ir/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("rel")).toContain("noreferrer");
    expect(a.getAttribute("href")).toBe("https://example.ir/");
  });
  it("copy: success says «copied», NOT «sent», moves DRAFT → COPIED and makes no network call", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { container } = ui();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("پیش‌نویس");
    await user.click(screen.getByTestId("copy"));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toContain("«دوربین داهوا HDW1200CLQP-IL-A»");
    expect(await screen.findByTestId("live-msg")).toHaveTextContent("متن کپی شد");
    expect(screen.getByTestId("status-badge")).toHaveTextContent("متن کپی شد (ارسال نشده)");
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("clipboard denied/unsupported: honest fallback, status stays DRAFT until the user confirms a manual copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    ui();
    await user.click(screen.getByTestId("copy"));
    expect(await screen.findByText(/کپی خودکار انجام نشد/)).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("پیش‌نویس");
    await user.click(screen.getByTestId("manual-copy-done"));
    expect(screen.getByTestId("status-badge")).toHaveTextContent("متن کپی شد (ارسال نشده)");
  });
  it("COPIED, CONTACTED and REPLY are three different states set only by the user's own clicks", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    ui();
    await user.click(screen.getByTestId("copy"));
    expect(screen.getByTestId("status-badge")).toHaveTextContent("متن کپی شد");
    await user.click(screen.getByTestId("mark-contacted"));
    expect(screen.getByTestId("status-badge")).toHaveTextContent("شما می‌گویید پرسیده‌اید");
    await user.type(screen.getByLabelText("متن پاسخ (اختیاری)"), "سلام");
    await user.click(screen.getByTestId("stock-yes"));
    await user.click(screen.getByTestId("reply-submit"));
    expect(screen.getByTestId("status-badge")).toHaveTextContent("گزارش شما: موجود است (تأییدنشده)");
  });
  it("reported price change: bare number is ambiguous (toman vs rial asked), then compared with the recorded price", async () => {
    const user = userEvent.setup();
    ui();
    await user.type(screen.getByLabelText(/قیمت امروزی/), "4592000");
    expect(screen.getByTestId("amount-status")).toHaveTextContent("تومان است یا ریال");
    await user.click(screen.getByTestId("reply-submit"));
    expect(screen.getByTestId("reply-error")).toHaveTextContent("واحد مبلغ روشن نیست");
    await user.click(screen.getByTestId("unit-toman"));
    await user.click(screen.getByTestId("stock-yes"));
    await user.click(screen.getByTestId("model-same"));
    await user.click(screen.getByTestId("reply-submit"));
    const panel = screen.getByTestId("decision-panel");
    expect(within(panel).getByTestId("price-delta")).toHaveTextContent("۴۹۲٬۰۰۰ تومان بیشتر (۱۲٪)");
    expect(within(panel).getByTestId("price-compare")).toHaveTextContent("ثبت‌شده در داده");
    expect(within(panel).getByTestId("price-compare")).toHaveTextContent("گزارش شما از فروشنده");
    expect(within(panel).getByTestId("next-COMPARE_AGAIN")).toBeInTheDocument();
    expect(within(panel).getByTestId("outcome-claim")).toHaveTextContent("ادعای فروشنده");
    expect(screen.getByTestId("ctx-price")).toHaveTextContent("۴٬۱۰۰٬۰۰۰ تومان"); // the recorded price is untouched
  });
  it("pasted text only SUGGESTS: nothing changes until the user applies it", async () => {
    const user = userEvent.setup();
    ui();
    await user.type(screen.getByLabelText("متن پاسخ (اختیاری)"), "متأسفانه موجود نیست");
    const sug = screen.getByTestId("suggestions");
    expect(screen.getByTestId("stock-unknown")).toHaveAttribute("aria-checked", "true");
    await user.click(within(sug).getByRole("button", { name: /موجود نیست/ }));
    expect(screen.getByTestId("stock-no")).toHaveAttribute("aria-checked", "true");
  });
  it("injection-shaped reply text is shown as plain text (no elements created) and long text is bounded", async () => {
    const user = userEvent.setup();
    const { container } = ui();
    const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>';
    await user.click(screen.getByLabelText("متن پاسخ (اختیاری)"));
    await user.paste(evil);
    await user.click(screen.getByTestId("stock-no"));
    await user.click(screen.getByTestId("reply-submit"));
    const item = screen.getByTestId("reply-item");
    expect(item.textContent).toContain("<img src=x");
    expect(container.querySelector("img, script")).toBeNull();
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    expect((screen.getByLabelText("متن پاسخ (اختیاری)") as HTMLTextAreaElement).maxLength).toBe(1200);
  });
  it("reported unavailable → find another seller keeps product + variant; no replies → await state", async () => {
    const user = userEvent.setup();
    ui();
    expect(screen.getByTestId("next-AWAIT_REPLY")).toBeInTheDocument();
    await user.click(screen.getByTestId("stock-no"));
    await user.click(screen.getByTestId("reply-submit"));
    expect(screen.getByTestId("next-FIND_OTHER_SELLER")).toHaveAttribute("href", "/sellers?product=product_aaaaaaaa");
    expect(screen.getByTestId("next-ALTERNATIVE_PRODUCT")).toBeInTheDocument();
  });
  it("no response / follow-up: «پاسخی نیامد» offers a shorter follow-up text and other sellers", async () => {
    const user = userEvent.setup();
    ui();
    await user.click(screen.getByTestId("no-response"));
    expect(screen.getByTestId("outcome-headline")).toHaveTextContent("پاسخی نیامده");
    await user.click(screen.getByTestId("next-FOLLOW_UP"));
    expect((screen.getByTestId("draft") as HTMLTextAreaElement).value).toContain("دوباره مزاحم");
    expect(screen.getByTestId("next-FIND_OTHER_SELLER")).toBeInTheDocument();
  });
  it("persists only this tab's manual state (sessionStorage) across a remount; reset clears it; keys carry no phone/coords", async () => {
    const user = userEvent.setup();
    const first = ui();
    await user.click(screen.getByTestId("stock-yes"));
    await user.click(screen.getByTestId("reply-submit"));
    const raw = window.sessionStorage.getItem(KEY)!;
    expect(raw).toContain("USER_REPORTED");
    expect(raw).not.toMatch(/DEMO|phone|09\d{9}|lat|lon/i);
    first.unmount();
    ui();
    expect(await screen.findByTestId("reply-item")).toBeInTheDocument();
    await user.click(screen.getByTestId("reset"));
    expect(window.sessionStorage.getItem(KEY)).toContain("DRAFT");
    expect(screen.queryByTestId("reply-item")).toBeNull();
  });
  it("changing the planned visit time navigates with the visit param (server re-evaluates declared hours)", async () => {
    ui();
    const input = screen.getByTestId("visit-input");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "2026-10-24T17:30" } });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toContain("visit=2026-10-24T17%3A30");
    expect(replace.mock.calls[0]![0]).toContain("offer=offer_cccccccc");
  });
});

describe("InquiryWorkspace — demo mode (fiction, isolated)", () => {
  async function enterDemo(user: ReturnType<typeof userEvent.setup>) {
    expect(screen.getByTestId("mode-demo")).toBeDisabled(); // opt-in gate
    await user.click(screen.getByTestId("demo-consent"));
    await user.click(screen.getByTestId("mode-demo"));
  }
  it("requires explicit opt-in, then shows a persistent banner and per-message tags; nothing is fetched", async () => {
    const user = userEvent.setup();
    const { container } = ui();
    await enterDemo(user);
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("حالت شبیه‌سازی — فقط دمو");
    await user.click(screen.getByTestId("scenario-NOT_AVAILABLE"));
    await user.click(screen.getByTestId("demo-run"));
    const msgs = screen.getAllByTestId("demo-message");
    expect(msgs.length).toBe(2);
    for (const m of msgs) { expect(m).toHaveAttribute("data-provenance", "DEMO_SIMULATED"); expect(within(m).getByTestId("demo-tag")).toHaveTextContent("واقعی نیست"); }
    expect(screen.getByTestId("decision-panel")).toHaveAttribute("data-mode", "DEMO");
    expect(screen.getByTestId("outcome-headline")).toHaveTextContent("فقط دمو");
    expect(screen.getByTestId("next-FIND_OTHER_SELLER")).toHaveAttribute("href", "/sellers?product=product_aaaaaaaa");
    expect(screen.queryByTestId("copy")).toBeNull();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("demo never touches the manual inquiry or storage; exiting clears it and a remount is NOT in demo", async () => {
    const user = userEvent.setup();
    const first = ui();
    await enterDemo(user);
    await user.click(screen.getByTestId("scenario-PRICE_CHANGED"));
    await user.click(screen.getByTestId("demo-run"));
    expect(screen.getByTestId("price-compare")).toHaveTextContent("قیمت نمونه (شبیه‌سازی)");
    expect(window.sessionStorage.getItem(KEY) ?? "").not.toMatch(/DEMO|demo-reply|PRICE_CHANGED/);
    await user.click(screen.getByTestId("demo-exit"));
    expect(screen.queryByTestId("demo-banner")).toBeNull();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("پیش‌نویس"); // the manual inquiry is unchanged
    expect(screen.queryByTestId("reply-item")).toBeNull();
    first.unmount();
    ui();
    expect(screen.queryByTestId("demo-banner")).toBeNull();
    expect(screen.getByTestId("inquiry-workspace")).toHaveAttribute("data-mode", "MANUAL");
  });
  it("variant-different scenario blocks the false equivalence and offers a model-confirmation question", async () => {
    const user = userEvent.setup();
    ui();
    await enterDemo(user);
    await user.click(screen.getByTestId("scenario-VARIANT_DIFFERENT"));
    await user.click(screen.getByTestId("demo-run"));
    expect(screen.getByTestId("blocked")).toHaveTextContent("مسدود");
    expect(screen.queryByTestId("next-RECONFIRM_BEFORE_VISIT")).toBeNull();
    await user.click(screen.getByTestId("next-CLARIFY_VARIANT"));
    expect(screen.getByTestId("live-msg")).toHaveTextContent("مدل/نسخه‌ی دقیق");
  });
  it("no-response scenario shows a truthful system note and recovery actions", async () => {
    const user = userEvent.setup();
    ui();
    await enterDemo(user);
    await user.click(screen.getByTestId("scenario-NO_RESPONSE"));
    await user.click(screen.getByTestId("demo-run"));
    expect(screen.getByTestId("outcome-headline")).toHaveTextContent("پاسخی نیامده");
    expect(screen.getByTestId("next-FIND_OTHER_SELLER")).toBeInTheDocument();
  });
  it("the demo exit button removes every demo message", async () => {
    const user = userEvent.setup();
    ui();
    await enterDemo(user);
    await user.click(screen.getByTestId("demo-run"));
    expect(screen.getAllByTestId("demo-message").length).toBeGreaterThan(0);
    await user.click(screen.getByTestId("demo-exit"));
    expect(screen.queryAllByTestId("demo-message")).toHaveLength(0);
  });
});
