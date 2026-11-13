// @vitest-environment node
import { revalidateTag } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_TAG } from "./settings";
import { resetSettingsCacheForTests } from "./settings-cache-reset";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

describe("resetSettingsCacheForTests", () => {
  beforeEach(() => {
    vi.mocked(revalidateTag).mockClear();
  });

  it("does nothing unless the test pages are enabled", () => {
    expect(resetSettingsCacheForTests({})).toBe(false);
    expect(resetSettingsCacheForTests({ ENABLE_ERROR_TEST_PAGES: "false" })).toBe(false);
    expect(resetSettingsCacheForTests({ ENABLE_ERROR_TEST_PAGES: "1" })).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("expires the cached settings at once when the test pages are enabled", () => {
    expect(resetSettingsCacheForTests({ ENABLE_ERROR_TEST_PAGES: "true" })).toBe(true);
    // `expire: 0`: the next read is a cache miss, no stale copy is served in between.
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(SETTINGS_TAG, { expire: 0 });
  });
});
