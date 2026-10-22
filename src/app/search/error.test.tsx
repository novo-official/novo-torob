import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SearchError from "./error";

it("uses Next 16.4 retry to refetch the failed search segment", () => {
  const retry = vi.fn();
  render(<SearchError error={new Error("synthetic failure")} retry={retry} />);
  fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "بازگشت به خانه" })).toHaveAttribute("href", "/");
});
