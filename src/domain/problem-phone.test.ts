import { describe, expect, it } from "vitest";

import { DEFAULT_PROBLEM_PHONE, problemPhoneSchema, telHref } from "./problem-phone";

describe("problem phone", () => {
  it("builds a tel: link with only digits and a leading plus", () => {
    expect(telHref("+43 (0)1 / 234-56 78")).toBe("tel:+43012345678");
    expect(telHref(" 0660 123 45 67 ")).toBe("tel:06601234567");
    expect(telHref(DEFAULT_PROBLEM_PHONE)).toBe("tel:+4310000000");
  });

  it("accepts typed numbers and rejects text", () => {
    expect(problemPhoneSchema.safeParse(" +43 660 123 45 67 ").data).toBe("+43 660 123 45 67");
    expect(problemPhoneSchema.safeParse("0660/1234567").success).toBe(true);
    expect(problemPhoneSchema.safeParse("Büro anrufen").success).toBe(false);
    expect(problemPhoneSchema.safeParse("12").success).toBe(false);
    expect(problemPhoneSchema.safeParse("").success).toBe(false);
  });
});
