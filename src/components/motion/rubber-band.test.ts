import { describe, expect, it } from "vitest";

import { clampWithRubberBand, rubberBand, shouldDismiss } from "./rubber-band";

describe("rubberBand", () => {
  it("does nothing without a pull", () => {
    expect(rubberBand(0, 300)).toBe(0);
    expect(rubberBand(-20, 300)).toBe(0);
    expect(rubberBand(50, 0)).toBe(0);
  });

  it("follows the finger less and less, and never further than the element is big", () => {
    const pulls = [10, 50, 100, 400, 2000, 100_000].map((distance) => rubberBand(distance, 300));
    pulls.forEach((moved, index) => {
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(300);
      if (index > 0) expect(moved).toBeGreaterThan(pulls[index - 1]!);
    });
    expect(rubberBand(100, 300)).toBeLessThan(100);
    // The resistance grows: the second 100 px move the element less than the first 100 px did.
    expect(rubberBand(200, 300) - rubberBand(100, 300)).toBeLessThan(rubberBand(100, 300));
  });
});

describe("clampWithRubberBand", () => {
  it("leaves a value inside the limits alone", () => {
    expect(clampWithRubberBand(50, 0, 100, 300)).toBe(50);
    expect(clampWithRubberBand(0, 0, 100, 300)).toBe(0);
    expect(clampWithRubberBand(100, 0, 100, 300)).toBe(100);
  });

  it("gives way a little past either limit", () => {
    const below = clampWithRubberBand(-80, 0, 100, 300);
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-80);
    const above = clampWithRubberBand(180, 0, 100, 300);
    expect(above).toBeGreaterThan(100);
    expect(above).toBeLessThan(180);
  });
});

describe("shouldDismiss", () => {
  it("dismisses after a long drag, whatever the speed", () => {
    expect(shouldDismiss(200, 3000, 400)).toBe(true);
  });

  it("dismisses after a short, quick flick", () => {
    expect(shouldDismiss(60, 80, 400)).toBe(true);
  });

  it("stays for a short, slow drag, a twitch, or a drag the wrong way", () => {
    expect(shouldDismiss(60, 900, 400)).toBe(false);
    expect(shouldDismiss(8, 4, 400)).toBe(false);
    expect(shouldDismiss(-200, 100, 400)).toBe(false);
  });
});
