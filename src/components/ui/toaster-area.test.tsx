import { act, cleanup, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { ToasterArea } from "./toaster-area";

let pathname = "/admin/orders";
vi.mock("@/i18n/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

/** sonner draws its list only once a toast exists; the offset is a CSS variable on that list. */
async function bottomOffset() {
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <ToasterArea />
    </NextIntlClientProvider>,
  );
  act(() => {
    toast("Gesendet");
  });
  const list = await waitFor(() => {
    const found = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(found).not.toBeNull();
    return found!;
  });
  return list.style.getPropertyValue("--offset-bottom");
}

describe("ToasterArea (NUD-212)", () => {
  it("keeps the toasts of the day plan above its send bar", async () => {
    pathname = "/admin/planning";
    expect(await bottomOffset()).toBe("104px");
  });

  it("leaves the other office pages at the default place", async () => {
    pathname = "/admin/orders";
    expect(await bottomOffset()).not.toBe("104px");
  });
});
