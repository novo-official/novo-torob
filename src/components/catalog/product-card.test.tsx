import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductCard } from "@/domain/advisor";
import { ProductCardView } from "./product-card";
import { ProductImage } from "./product-image";

vi.mock("./compare-store", () => ({ CompareToggle: () => null }));
const card: ProductCard = {
  id: "product_abcdef123456", title: "سیم آزمایشی", categoryName: "سیم و کابل", brandName: null, model: null, imageUrl: null, specCount: 0, offerCount: 3, distinctSellers: 2,
  price: { status: "reliable", label: "قیمت قابل اتکا", min: 10000, max: 12000, median: 11000, reliableCount: 2, unitHint: "per_metre", staleShare: 1, spreadRatio: 1.2, pricedOffers: 3, totalOffers: 3, excluded: {} },
  variants: { modelMismatch: 1, modelUnconfirmed: 1, unitAmbiguous: 1, noPrice: 0, implausiblePrice: 0, stale: 2 },
};
describe("catalog card decision signals", () => {
  it("keeps unit, stale prices, stock uncertainty and variant warnings visible before expanding evidence", () => {
    render(<ProductCardView card={card} href="/products/product_abcdef123456" headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(card.title);
    for (const text of [/قیمت هر متر/, /بیشتر قیمت‌ها قدیمی‌اند/, /موجودی تأییدنشده/, /برخی نسخه‌ها متفاوت‌اند/, /واحد برخی قیمت‌ها نامشخص/]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(/کد مدل شبیه ولی متفاوت/)).not.toBeVisible();
  });
  it("does not promote an unreliable numeric range into a card price, and redacted titles stay redacted", () => {
    render(<ProductCardView card={{ ...card, title: "عنوان حذف‌شده برای انتشار", price: { ...card.price, status: "wide_spread", label: "قیمت قابل اتکا موجود نیست" } }} href="/products/product_abcdef123456" />);
    expect(screen.getByText("قیمت قابل اتکا موجود نیست")).toBeVisible();
    expect(screen.queryByText(/۱۰٬۰۰۰/)).toBeNull();
    expect(screen.getByRole("heading")).toHaveTextContent("عنوان این محصول در داده حذف شده است");
  });
  it("a failed image can recover when its source changes, with a labelled fallback", () => {
    const { rerender } = render(<ProductImage src="https://image.torob.com/one.png" alt="محصول آزمایشی" className="size-20" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAccessibleName("محصول آزمایشی؛ تصویر در دسترس نیست");
    rerender(<ProductImage src="https://image.torob.com/two.png" alt="محصول آزمایشی" className="size-20" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://image.torob.com/two.png");
  });
});
