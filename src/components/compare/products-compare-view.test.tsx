import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompareResponse } from "@/domain/advisor";
import { ProductsCompareView } from "./products-compare-view";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const sampleResponse: CompareResponse = {
  products: [
    {
      card: {
        id: "product_1",
        title: "دوربین داهوا مدل HDW1200",
        categoryName: "دوربین مداربسته",
        brandName: "داهوا",
        model: "HDW1200",
        imageUrl: null,
        specCount: 5,
        offerCount: 3,
        distinctSellers: 3,
        price: { status: "reliable", label: "۲٬۰۰۰٬۰۰۰ تومان", min: 2_000_000, median: 2_000_000, max: 2_000_000, reliableCount: 1, unitHint: null, staleShare: null, spreadRatio: null, pricedOffers: 1, totalOffers: 1, excluded: {} },
        variants: { modelMismatch: 0, modelUnconfirmed: 0, unitAmbiguous: 0, noPrice: 0, implausiblePrice: 0, stale: 0 },
      },
      attributes: [
        { id: "res", label: "کیفیت تصویر", value: "۲ مگاپیکسل", confidence: "explicit" },
        { id: "mic", label: "میکروفون", value: "دارد", confidence: "explicit" },
      ],
    },
    {
      card: {
        id: "product_2",
        title: "دوربین داهوا مدل HDW1400",
        categoryName: "دوربین مداربسته",
        brandName: "داهوا",
        model: "HDW1400",
        imageUrl: null,
        specCount: 5,
        offerCount: 4,
        distinctSellers: 4,
        price: { status: "reliable", label: "۳٬۰۰۰٬۰۰۰ تومان", min: 3_000_000, median: 3_000_000, max: 3_000_000, reliableCount: 1, unitHint: null, staleShare: null, spreadRatio: null, pricedOffers: 1, totalOffers: 1, excluded: {} },
        variants: { modelMismatch: 0, modelUnconfirmed: 0, unitAmbiguous: 0, noPrice: 0, implausiblePrice: 0, stale: 0 },
      },
      attributes: [
        { id: "res", label: "کیفیت تصویر", value: "۴ مگاپیکسل", confidence: "explicit" },
        { id: "mic", label: "میکروفون", value: "دارد", confidence: "explicit" },
      ],
    },
  ],
  specRows: [
    { key: "lens", label: "نوع لنز", values: ["ثابت", "متغیر"], differs: true },
    { key: "body", label: "جنس بدنه", values: ["فلز", "فلز"], differs: false },
  ],
  sameCategory: true,
  notes: ["تفاوت‌ها فقط از مشخصات ثبت‌شده می‌آید."],
};

describe("ProductsCompareView", () => {
  it("renders both products with short titles on mobile view", () => {
    const { container } = render(<ProductsCompareView res={sampleResponse} currentIds={["product_1", "product_2"]} />);
    expect(screen.getAllByText("دوربین داهوا مدل HDW1200").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("دوربین داهوا مدل HDW1400").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("HDW1200");
    expect(container.textContent).toContain("HDW1400");
  });

  it("toggles 'only differences' correctly filtering identical specs", () => {
    render(<ProductsCompareView res={sampleResponse} currentIds={["product_1", "product_2"]} />);
    expect(screen.getAllByText("جنس بدنه").length).toBeGreaterThan(0);
    const toggle = screen.getByRole("button", { name: /فقط تفاوت‌ها/ });
    fireEvent.click(toggle);
    expect(screen.queryAllByText("جنس بدنه")).toHaveLength(0);
    expect(screen.getAllByText("نوع لنز").length).toBeGreaterThan(0);
  });

  it("removes a product and navigates with remaining IDs", () => {
    render(<ProductsCompareView res={sampleResponse} currentIds={["product_1", "product_2", "product_3"]} />);
    const removeBtn = screen.getByRole("button", { name: /حذف دوربین داهوا مدل HDW1200/ });
    fireEvent.click(removeBtn);
    expect(mockPush).toHaveBeenCalledWith("/compare/products?ids=product_2,product_3");
  });
});
