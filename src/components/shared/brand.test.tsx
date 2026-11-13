import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Brand } from "./brand";

describe("Brand", () => {
  afterEach(cleanup);

  it("shows the mark and the name, the mark hidden from screen readers", () => {
    render(<Brand data-testid="brand" />);
    const brand = screen.getByTestId("brand");
    expect(brand.tagName).toBe("P");
    expect(brand).toHaveTextContent(/^Routenplanner$/);
    expect(screen.getByTestId("brand-mark")).toHaveAttribute("aria-hidden", "true");
  });

  it("is the page title on the start page", () => {
    render(<Brand as="h1" />);
    expect(screen.getByRole("heading", { level: 1, name: "Routenplanner" })).toBeInTheDocument();
  });
});
