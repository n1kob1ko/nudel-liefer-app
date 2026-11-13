import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  afterEach(cleanup);

  it("keeps the original delivered/problems API working", () => {
    render(
      <ProgressBar
        delivered={3}
        problems={1}
        total={20}
        label="Fortschritt"
        valueText="4 von 20 erledigt"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Fortschritt" });
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "20");
    expect(bar).toHaveAttribute("aria-valuetext", "4 von 20 erledigt");
    // Problems are red in the whole app (redesign RD2): green is delivered, red is a problem.
    const tones = [...bar.querySelectorAll("[data-tone]")].map((slice) =>
      slice.getAttribute("data-tone"),
    );
    expect(tones).toEqual(["success", "destructive"]);
  });

  it("renders one slice per segment with the tone from the status map", () => {
    render(
      <ProgressBar
        total={20}
        label="Fortschritt"
        valueText="3 geliefert, 1 Problem, 16 offen"
        segments={[
          { value: 3, tone: "success" },
          { value: 1, tone: "warning" },
        ]}
      />,
    );
    const slices = screen.getByTestId("progress-bar").children;
    expect(slices).toHaveLength(2);
    expect(slices[0]).toHaveAttribute("data-tone", "success");
    expect(slices[1]).toHaveAttribute("data-tone", "warning");
    expect(slices[0]).toHaveStyle({ width: "15%" });
  });

  it("omits empty segments and does not divide by zero", () => {
    render(
      <ProgressBar
        total={0}
        label="Fortschritt"
        segments={[
          { value: 0, tone: "success" },
          { value: 0, tone: "warning" },
        ]}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeEmptyDOMElement();
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });
});
