import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import de from "../../../messages/de.json";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

function Harness({ side = "bottom" as const }: { side?: "bottom" | "right" }) {
  const [open, setOpen] = useState(true);
  return (
    <NextIntlClientProvider locale="de" messages={de}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side}>
          <SheetTitle>Problem melden</SheetTitle>
          <SheetDescription>Was ist passiert?</SheetDescription>
        </SheetContent>
      </Sheet>
    </NextIntlClientProvider>
  );
}

/** jsdom has no layout: give the sheet a height so "far enough" can be judged. */
function sheetWithHeight(height: number) {
  const sheet = screen.getByRole("dialog");
  Object.defineProperty(sheet, "offsetHeight", { configurable: true, value: height });
  return sheet;
}

const grabArea = () => document.querySelector('[data-slot="sheet-drag-area"]') as HTMLElement;

function drag(
  from: number,
  to: number,
  ms: number,
  end: "pointerUp" | "pointerCancel" = "pointerUp",
) {
  const area = grabArea();
  // fireEvent builds the event first, so `timeStamp` (read-only) is set on the event object.
  const at = (
    type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
    y: number,
    t: number,
  ) => {
    const event = new MouseEvent(type.toLowerCase(), { bubbles: true, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    Object.defineProperty(event, "timeStamp", { value: t });
    fireEvent(area, event);
  };
  at("pointerDown", from, 1000);
  at("pointerMove", to, 1000 + ms / 2);
  const transformWhileHeld = screen.getByRole("dialog").style.transform;
  const transitionWhileHeld = screen.getByRole("dialog").style.transition;
  at(end, to, 1000 + ms);
  return { transformWhileHeld, transitionWhileHeld };
}

afterEach(cleanup);

describe("bottom sheet: swipe to dismiss", () => {
  it("follows the finger without any tween while it is held", () => {
    render(<Harness />);
    sheetWithHeight(400);
    const held = drag(100, 160, 2000);
    expect(held.transformWhileHeld).toBe("translateY(60px)");
    expect(held.transitionWhileHeld).toMatch(/^none/);
  });

  it("closes after a long drag down and leaves from where it was let go", async () => {
    render(<Harness />);
    const sheet = sheetWithHeight(400);
    drag(100, 300, 2000);
    expect(sheet.style.getPropertyValue("--sheet-from")).toBe("200px");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes after a short, quick flick", async () => {
    render(<Harness />);
    sheetWithHeight(400);
    drag(100, 170, 90);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("settles back after a short, slow drag", () => {
    render(<Harness />);
    const sheet = sheetWithHeight(400);
    drag(100, 150, 2000);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(sheet.style.transform).toBe("translateY(0)");
  });

  it("resists being pulled up and never closes that way", () => {
    render(<Harness />);
    sheetWithHeight(400);
    const held = drag(300, 100, 100);
    const moved = Number.parseFloat(held.transformWhileHeld.replace("translateY(", ""));
    expect(moved).toBeLessThan(0);
    expect(moved).toBeGreaterThan(-200);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays open when the system cancels the gesture", () => {
    render(<Harness />);
    sheetWithHeight(400);
    drag(100, 380, 300, "pointerCancel");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no grab area on a side drawer", () => {
    render(<Harness side="right" />);
    expect(grabArea()).toBeNull();
  });
});
