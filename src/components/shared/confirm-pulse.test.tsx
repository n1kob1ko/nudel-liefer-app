import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConfirmPulse } from "./confirm-pulse";

afterEach(cleanup);

describe("ConfirmPulse", () => {
  it("stays still on the first render and pulses once the value has changed", () => {
    const { rerender } = render(
      <ConfirmPulse value={7500} data-testid="total">
        75,00 €
      </ConfirmPulse>,
    );
    expect(screen.getByTestId("total").className).not.toContain("confirm-pulse");

    rerender(
      <ConfirmPulse value={6500} data-testid="total">
        65,00 €
      </ConfirmPulse>,
    );
    expect(screen.getByTestId("total").className).toContain("confirm-pulse");
    expect(screen.getByTestId("total").textContent).toBe("65,00 €");
  });

  it("pulses again when the value changes back", () => {
    const { rerender } = render(<ConfirmPulse value={1}>a</ConfirmPulse>);
    rerender(<ConfirmPulse value={2}>b</ConfirmPulse>);
    const first = screen.getByText("b");
    rerender(<ConfirmPulse value={1}>a</ConfirmPulse>);
    const second = screen.getByText("a");
    expect(second.className).toContain("confirm-pulse");
    // A fresh element, so the CSS animation starts again instead of being skipped.
    expect(second).not.toBe(first);
  });
});
