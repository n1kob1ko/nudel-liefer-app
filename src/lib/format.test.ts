import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";

import { createAppFormatters } from "./format";

const f = (locale: string) => createAppFormatters(createFormatter({ locale }));

describe("createAppFormatters", () => {
  it("shows quantities as whole numbers, per locale", () => {
    expect(f("de").quantity(5)).toBe("5");
    expect(f("de").quantity("5")).toBe("5");
    expect(f("de").quantity(1200)).toBe("1.200");
    expect(f("zh-Hans").quantity(1200)).toBe("1,200");
  });

  it("formats calendar dates without shifting the day", () => {
    const deliveryDate = new Date("2026-10-17T00:00:00.000Z");
    expect(f("de").calendarDate(deliveryDate)).toBe("17.10.2026");
    expect(f("sr-Latn").calendarDate(deliveryDate)).toMatch(/2026/);
  });

  it("formats moments in the factory time zone", () => {
    const moment = new Date("2026-10-17T22:30:00.000Z"); // 00:30 next day in Vienna (CEST)
    expect(f("de").time(moment)).toBe("00:30");
    expect(f("de").dateShort(moment)).toContain("18");
  });

  it("shows the day of a moment as the factory saw it, not as UTC did", () => {
    const moment = new Date("2026-10-17T22:30:00.000Z"); // already the 18th in Vienna
    expect(f("de").dayOfMoment(moment)).toBe("18.10.2026");
    expect(f("de").calendarDate(moment)).toBe("17.10.2026");
  });

  it("shows a correction with its sign, so a deduction and a surcharge cannot be confused", () => {
    // Intl puts a no-break space before the euro sign; normalised so the test reads plainly.
    const plain = (text: string) => text.replace(/\u00a0/g, " ");
    expect(plain(f("de").signedAmount(-1000))).toBe("-10,00 €");
    expect(plain(f("de").signedAmount(250))).toBe("+2,50 €");
    expect(plain(f("en").signedAmount(-1000))).toBe("-€10.00");
  });
});
