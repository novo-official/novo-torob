import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SellerQa } from "./seller-qa";

const FORBIDDEN = /ارسال\s*شد|ارسال\s*شده|موجود است(?!؟)|پیام شما فرستاده/;

describe("SellerQa (local-only workspace)", () => {
  it("shows the safe default: no verified contact channel", () => {
    render(<SellerQa />);
    expect(screen.getByText("راه ارتباطی تأییدشده در داده‌ها موجود نیست")).toBeInTheDocument();
  });

  it("asks for a product name before producing a draft", () => {
    render(<SellerQa />);
    expect(screen.queryByRole("button", { name: "کپی متن" })).not.toBeInTheDocument();
  });

  it("builds a draft, copies it for the USER, and never claims it was sent", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { container } = render(<SellerQa />);

    await user.type(screen.getByLabelText("نام یا مدل کالا"), "دوربین DH-HAC-HDW1200CLQP");
    const draft = screen.getByLabelText("پیش‌نویس پیام") as HTMLTextAreaElement;
    expect(draft.value).toContain("«دوربین DH-HAC-HDW1200CLQP»");

    await user.click(screen.getByRole("button", { name: "کپی متن" }));
    expect(writeText).toHaveBeenCalledWith(draft.value);
    expect(await screen.findByText(/متن کپی شد/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it("makes no network request at all", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SellerQa />);
    await user.type(screen.getByLabelText("نام یا مدل کالا"), "پمپ");
    await user.click(screen.getByRole("button", { name: "کپی متن" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records a manual response labelled unverified and tracks unresolved questions", async () => {
    const user = userEvent.setup();
    render(<SellerQa />);
    await user.type(screen.getByLabelText("نام یا مدل کالا"), "پمپ آب");

    expect(screen.getByText(/۲ پرسش بی‌پاسخ/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("پاسخی که شنیدید یا خواندید"), "تا فردا می‌رسد");
    await user.click(screen.getByRole("button", { name: "ثبت پاسخ" }));

    const status = screen.getByRole("heading", { name: "وضعیت ماموریت" }).closest("div")!;
    expect(within(status).getByText("ثبت دستی توسط شما — تأییدنشده")).toBeInTheDocument();
    expect(screen.getByText(/۱ پرسش بی‌پاسخ/)).toBeInTheDocument();
  });
});
