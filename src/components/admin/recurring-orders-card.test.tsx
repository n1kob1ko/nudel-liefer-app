import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecurringOrderAction, updateRecurringOrderAction } from "@/server/recurring-actions";
import type { RecurringRuleView } from "@/server/recurring-orders";

import de from "../../../messages/de.json";
import { RecurringOrdersCard, type RecurringProductChoice } from "./recurring-orders-card";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/server/recurring-actions", () => ({
  createRecurringOrderAction: vi.fn(),
  updateRecurringOrderAction: vi.fn(),
  setRecurringOrderActiveAction: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const PRODUCTS: RecurringProductChoice[] = [
  { id: "p-crate", label: "Nudeln (Kiste)", unit: "CRATE" },
  { id: "p-pack", label: "Nudeln (Sackerl)", unit: "PACK" },
];

/** A stored rule that uses every NUD-171 field. */
const RULE: RecurringRuleView = {
  id: "r-1",
  customerId: "c-1",
  weekdays: [2],
  monthlyRules: [{ kind: "nthWeekday", nth: 1, weekday: 1 }],
  everyNWeeks: 1,
  anchorDate: "2099-05-05",
  seasonFrom: null,
  seasonTo: null,
  exceptions: ["2099-05-20"],
  skipFrom: "2099-07-01",
  skipTo: "2099-07-14",
  windowFromTime: "08:00",
  windowToTime: "11:30",
  endsOn: "2099-06-30",
  maxDeliveries: null,
  state: "active",
  confirmedAt: new Date("2099-05-01T10:00:00Z"),
  confirmedBy: "Chefin",
  lines: [
    {
      id: "l-1",
      productId: "p-crate",
      productName: { de: "Nudeln (Kiste)", meta: { source: "de", machine: {}, updatedAt: "x" } },
      unit: "CRATE",
      quantity: 2,
    },
  ],
  dayItems: [
    {
      weekday: 2,
      productId: "p-crate",
      productName: { de: "Nudeln (Kiste)", meta: { source: "de", machine: {}, updatedAt: "x" } },
      unit: "CRATE",
      quantity: 7,
    },
  ],
  nextDates: ["2099-05-12", "2099-05-19", "2099-05-26"],
};

function renderCard(rules: RecurringRuleView[] = []) {
  render(
    <NextIntlClientProvider
      locale="de"
      messages={de as unknown as AbstractIntlMessages}
      onError={(error) => {
        throw error;
      }}
    >
      <RecurringOrdersCard
        customerId="c-1"
        customerActive
        rules={rules}
        products={PRODUCTS}
        today="2099-05-05"
      />
    </NextIntlClientProvider>,
  );
}

const lastInput = (mock: { mock: { calls: unknown[][] } }, argument = 0) =>
  mock.mock.calls.at(-1)?.[argument] as Record<string, unknown>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecurringOrdersCard (NUD-149, NUD-171)", () => {
  it("creates a rule with the shared form's schedule, base products and monthly chip", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 3 });
    renderCard();

    fireEvent.click(screen.getByTestId("recurring-new"));
    fireEvent.change(screen.getByTestId("recurring-line-product"), {
      target: { value: "p-crate" },
    });
    fireEvent.change(screen.getByTestId("recurring-line-quantity"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByTestId("recurring-weekday-2"));
    fireEvent.click(screen.getByTestId("recurring-monthly-chip-day-1"));
    fireEvent.click(screen.getByTestId("recurring-save"));

    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput(vi.mocked(createRecurringOrderAction))).toMatchObject({
      customerId: "c-1",
      weekdays: [2],
      monthlyRules: [{ kind: "dayOfMonth", day: 1 }],
      everyNWeeks: 1,
      anchorDate: "2099-05-05",
      lines: [{ productId: "p-crate", quantity: 2 }],
      dayItems: [],
    });
  });

  it("sends own rows of a selected day as dayItems and drops them when the day is unchecked", async () => {
    vi.mocked(createRecurringOrderAction).mockResolvedValue({ ok: true, id: "r-1", generated: 0 });
    renderCard();

    fireEvent.click(screen.getByTestId("recurring-new"));
    fireEvent.change(screen.getByTestId("recurring-line-product"), {
      target: { value: "p-crate" },
    });
    fireEvent.change(screen.getByTestId("recurring-line-quantity"), { target: { value: "2" } });

    fireEvent.click(screen.getByTestId("recurring-weekday-2"));
    fireEvent.click(screen.getByTestId("recurring-weekday-4"));
    expect(screen.getByTestId("recurring-day-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("recurring-day-card-4")).toBeInTheDocument();
    expect(screen.queryByTestId("recurring-day-card-3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recurring-day-own-4"));
    fireEvent.change(screen.getByTestId("recurring-day-line-4-quantity"), {
      target: { value: "5" },
    });
    // Unchecking the day also drops its own rows.
    fireEvent.click(screen.getByTestId("recurring-weekday-2"));

    fireEvent.click(screen.getByTestId("recurring-save"));
    await waitFor(() => expect(createRecurringOrderAction).toHaveBeenCalled());
    expect(lastInput(vi.mocked(createRecurringOrderAction))).toMatchObject({
      weekdays: [4],
      dayItems: [{ weekday: 4, productId: "p-crate", quantity: 5 }],
    });
  });

  it("refuses a rule without any delivery day and names the monthly pattern as the way out", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("recurring-new"));
    fireEvent.change(screen.getByTestId("recurring-line-product"), {
      target: { value: "p-crate" },
    });
    fireEvent.change(screen.getByTestId("recurring-line-quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("recurring-save"));

    expect(screen.getByTestId("recurring-error")).toHaveAttribute("data-code", "pattern");
    expect(screen.getByTestId("recurring-error")).toHaveTextContent(
      "Bitte mindestens einen Liefertag oder ein Monatsmuster",
    );
    expect(createRecurringOrderAction).not.toHaveBeenCalled();
  });

  it("prefills every new field when a stored rule is edited", () => {
    renderCard([RULE]);

    fireEvent.click(screen.getByTestId("recurring-edit"));

    // "Mehr Optionen" is open because the rule uses it.
    expect(screen.getByTestId("recurring-more-options")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("recurring-monthly-applied")).toHaveTextContent("jeder 1. Montag");
    expect(screen.getByTestId("recurring-window-from")).toHaveValue("08:00");
    expect(screen.getByTestId("recurring-window-to")).toHaveValue("11:30");
    expect(screen.getByTestId("recurring-end-date")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("recurring-ends-on")).toHaveValue("2099-06-30");
    // The holiday range is shown next to the calendar trigger and filled in the popover.
    expect(screen.getByTestId("recurring-skip-range")).toHaveTextContent("2099");
    fireEvent.click(screen.getByTestId("recurring-exceptions-open"));
    expect(screen.getByTestId("recurring-skip-from")).toHaveValue("2099-07-01");
    expect(screen.getByTestId("recurring-skip-to")).toHaveValue("2099-07-14");
    expect(screen.getByTestId("recurring-exceptions")).toHaveTextContent("2099");
    expect(screen.getByTestId("recurring-day-state-2")).toHaveAttribute("data-state", "own");
    expect(screen.getByTestId("recurring-day-line-2-quantity")).toHaveValue("7");
  });

  it("saves an edited rule with the new rules through the update action", async () => {
    vi.mocked(updateRecurringOrderAction).mockResolvedValue({
      ok: true,
      id: "r-1",
      generated: 1,
    });
    renderCard([RULE]);

    fireEvent.click(screen.getByTestId("recurring-edit"));
    fireEvent.click(screen.getByTestId("recurring-end-count"));
    fireEvent.change(screen.getByTestId("recurring-max-deliveries"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("recurring-save"));

    await waitFor(() => expect(updateRecurringOrderAction).toHaveBeenCalled());
    expect(vi.mocked(updateRecurringOrderAction).mock.calls.at(-1)?.[0]).toBe("r-1");
    expect(lastInput(vi.mocked(updateRecurringOrderAction), 1)).toMatchObject({
      customerId: "c-1",
      weekdays: [2],
      monthlyRules: [{ kind: "nthWeekday", nth: 1, weekday: 1 }],
      windowFromTime: "08:00",
      windowToTime: "11:30",
      // The three choices are exclusive: switching to "after N deliveries" drops the date.
      endsOn: null,
      maxDeliveries: 6,
      skipFrom: "2099-07-01",
      skipTo: "2099-07-14",
      dayItems: [{ weekday: 2, productId: "p-crate", quantity: 7 }],
    });
  });

  it("shows the new rules in the rule summary", () => {
    renderCard([RULE]);

    expect(screen.getByTestId("recurring-monthly")).toHaveTextContent("jeder 1. Montag");
    expect(screen.getByTestId("recurring-window")).toHaveTextContent("08:00–11:30");
    expect(screen.getByTestId("recurring-end")).toHaveTextContent("2099");
    expect(screen.getByTestId("recurring-skip")).toHaveTextContent("Urlaub");
    expect(screen.getByTestId("recurring-day-items")).toHaveTextContent("Dienstag");
  });
});
