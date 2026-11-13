import { ImageIcon, PencilLineIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { TOUR_STATUSES } from "@/domain/tour-status";

import {
  orderSourceIcon,
  orderTone,
  stopTone,
  stopToneWithNext,
  type Tone,
  toneClasses,
  toneDot,
  tourTone,
  unitLabelKey,
} from "./status";

const TONES: Tone[] = ["neutral", "primary", "success", "warning", "destructive", "info"];

/** The real `OrderStatus` enum (prisma/schema.prisma) — kept here so a schema change fails loudly. */
const ORDER_STATUSES = ["DRAFT", "CONFIRMED", "CANCELLED"] as const;

describe("status map", () => {
  it("covers every tone with a soft background, matching text and a dot colour", () => {
    for (const tone of TONES) {
      expect(toneClasses[tone]).toMatch(/^bg-/);
      expect(toneClasses[tone]).toContain("text-");
      expect(toneDot[tone]).toMatch(/^bg-/);
    }
  });

  it("maps every stored stop status", () => {
    expect(stopTone("PENDING")).toBe("neutral");
    expect(stopTone("DELIVERED")).toBe("success");
    expect(stopTone("PROBLEM")).toBe("destructive");
    // UI-derived values that are not stored on the stop.
    expect(stopTone("FAILED")).toBe("destructive");
    expect(stopTone("CANCELLED")).toBe("warning");
    expect(stopTone("QUEUED")).toBe("warning");
  });

  it("maps every stored tour status", () => {
    expect(TOUR_STATUSES.map(tourTone)).toEqual([
      "neutral", // DRAFT
      "info", // OPTIMIZED
      "primary", // RELEASED
      "primary", // IN_PROGRESS
      "success", // COMPLETED
    ]);
    expect(tourTone("PLANNED")).toBe("info");
    expect(tourTone("DONE")).toBe("success");
  });

  it("maps every stored order status", () => {
    expect(ORDER_STATUSES.map(orderTone)).toEqual(["neutral", "success", "destructive"]);
  });

  it("never throws on an unknown status and falls back to neutral", () => {
    expect(stopTone("SOMETHING_NEW")).toBe("neutral");
    expect(tourTone("SOMETHING_NEW")).toBe("neutral");
    expect(orderTone("SOMETHING_NEW")).toBe("neutral");
    expect(stopTone("")).toBe("neutral");
  });

  it("lets the next stop win over its stored status", () => {
    expect(stopToneWithNext("PENDING", true)).toBe("primary");
    expect(stopToneWithNext("DELIVERED", true)).toBe("primary");
    expect(stopToneWithNext("PENDING", false)).toBe("neutral");
    expect(stopToneWithNext("PROBLEM", false)).toBe("destructive");
  });

  it("accepts lower-case enum values", () => {
    expect(stopTone("delivered")).toBe("success");
    expect(tourTone("released")).toBe("primary");
    expect(orderTone("cancelled")).toBe("destructive");
  });

  it("gives every order source an icon", () => {
    expect(orderSourceIcon("MANUAL")).toBe(PencilLineIcon);
    expect(orderSourceIcon("SCREENSHOT")).toBe(ImageIcon);
    expect(orderSourceIcon("manually-entered")).toBe(PencilLineIcon);
  });

  it("builds the message keys the components pass to next-intl", () => {
    expect(unitLabelKey("PACK")).toBe("units.PACK");
    expect(unitLabelKey("kg")).toBe("units.KG");
  });
});
