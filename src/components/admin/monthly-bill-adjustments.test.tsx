import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import { MonthlyBillAdjustments } from "./monthly-bill-adjustments";

const addMonthlyAdjustmentAction = vi.fn(
  async (): Promise<
    { ok: true; id: string; amountCents: number } | { ok: false; error: string }
  > => ({
    ok: true,
    id: "a-new",
    amountCents: -1000,
  }),
);
const removeMonthlyAdjustmentAction = vi.fn(
  async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }),
);
const refresh = vi.fn();

vi.mock("@/server/payment-actions", () => ({
  addMonthlyAdjustmentAction: (...args: unknown[]) => addMonthlyAdjustmentAction(...(args as [])),
  removeMonthlyAdjustmentAction: (...args: unknown[]) =>
    removeMonthlyAdjustmentAction(...(args as [])),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const lines = [
  { id: "a1", label: "Rabatt Stammkunde", amountText: "-10,00 €" },
  { id: "a2", label: "Leergut", amountText: "+2,50 €" },
];

function renderBill(props: Partial<Parameters<typeof MonthlyBillAdjustments>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="de" messages={de as unknown as AbstractIntlMessages}>
      <MonthlyBillAdjustments
        customerId="c1"
        month="2099-05"
        locked={false}
        hasOrders
        adjustments={lines}
        ordersTotalText="75,00 €"
        totalText="67,50 €"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const fill = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MonthlyBillAdjustments", () => {
  it("shows the orders' subtotal, every correction with its sign and the total", () => {
    renderBill();
    expect(screen.getByTestId("bill-subtotal").textContent).toContain("75,00 €");
    expect(screen.getByTestId("adjustment-a1").textContent).toContain("Rabatt Stammkunde");
    expect(screen.getByTestId("adjustment-a1").textContent).toContain("-10,00 €");
    expect(screen.getByTestId("adjustment-a2").textContent).toContain("+2,50 €");
    expect(screen.getByTestId("bill-total").textContent).toContain("67,50 €");
  });

  it("shows no breakdown while the month has no corrections", () => {
    renderBill({ adjustments: [] });
    expect(screen.queryByTestId("bill-subtotal")).toBeNull();
    expect(screen.getByTestId("adjustment-add")).toBeTruthy();
  });

  it("sends a deduction with the typed text and amount, then clears the form", async () => {
    renderBill();
    fill("adjustment-label", "Gutschrift Bruchware");
    fill("adjustment-amount", "10,50");
    fireEvent.click(screen.getByTestId("adjustment-add"));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(addMonthlyAdjustmentAction).toHaveBeenCalledWith({
      customerId: "c1",
      month: "2099-05",
      kind: "deduction",
      label: "Gutschrift Bruchware",
      amount: "10,50",
    });
    expect((screen.getByTestId("adjustment-label") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("adjustment-amount") as HTMLInputElement).value).toBe("");
  });

  it("sends a surcharge when that kind is picked", async () => {
    renderBill();
    fireEvent.click(screen.getByTestId("adjustment-kind-surcharge"));
    fill("adjustment-label", "Leergut");
    fill("adjustment-amount", "3");
    fireEvent.click(screen.getByTestId("adjustment-add"));

    await waitFor(() => expect(addMonthlyAdjustmentAction).toHaveBeenCalled());
    expect(addMonthlyAdjustmentAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "surcharge", amount: "3" }),
    );
  });

  it("asks for a text and for an amount above zero before anything is sent", () => {
    renderBill();
    fireEvent.click(screen.getByTestId("adjustment-add"));
    expect(screen.getByText("Bitte einen Text eintragen.")).toBeTruthy();

    fill("adjustment-label", "Rabatt");
    for (const amount of ["", "0", "abc", "1.000,00", "-5"]) {
      fill("adjustment-amount", amount);
      fireEvent.click(screen.getByTestId("adjustment-add"));
      expect(screen.getByText(/Bitte einen Betrag über 0 eintragen/), amount).toBeTruthy();
    }
    expect(addMonthlyAdjustmentAction).not.toHaveBeenCalled();
  });

  it("removes a correction by its id", async () => {
    renderBill();
    fireEvent.click(screen.getByTestId("adjustment-remove-a1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(removeMonthlyAdjustmentAction).toHaveBeenCalledWith({ adjustmentId: "a1" });
  });

  it("is read-only while the month is marked paid and says how to change it", () => {
    renderBill({ locked: true });
    expect(screen.queryByTestId("adjustment-add")).toBeNull();
    expect(screen.queryByTestId("adjustment-remove-a1")).toBeNull();
    expect(screen.getByTestId("adjustment-locked").textContent).toContain(
      "Bezahlt-Markierung zurücknehmen",
    );
    expect(screen.getByTestId("adjustment-a1")).toBeTruthy();
  });

  it("offers no form in a month without orders and says why", () => {
    renderBill({ adjustments: [], hasOrders: false });
    expect(screen.queryByTestId("adjustment-add")).toBeNull();
    expect(screen.getByTestId("adjustment-no-orders").textContent).toContain(
      "nur in einem Monat mit Bestellungen",
    );
  });

  it("still lets the office remove a correction that lost its orders", () => {
    renderBill({ hasOrders: false });
    expect(screen.getByTestId("adjustment-remove-a1")).toBeTruthy();
  });

  it("does not send a second correction while the first is still being saved", async () => {
    let finish: (value: { ok: true; id: string; amountCents: number }) => void = () => {};
    addMonthlyAdjustmentAction.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    renderBill();
    fill("adjustment-label", "Rabatt");
    fill("adjustment-amount", "5");
    fireEvent.click(screen.getByTestId("adjustment-add"));
    fireEvent.submit(screen.getByTestId("adjustment-add").closest("form")!);
    await waitFor(() => expect(addMonthlyAdjustmentAction).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("adjustment-add") as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true, id: "a-new", amountCents: -500 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(addMonthlyAdjustmentAction).toHaveBeenCalledTimes(1);
  });

  it("shows the add button as busy again after a correction was removed before", async () => {
    renderBill();
    fireEvent.click(screen.getByTestId("adjustment-remove-a1"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    let finish: (value: { ok: true; id: string; amountCents: number }) => void = () => {};
    addMonthlyAdjustmentAction.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    fill("adjustment-label", "Rabatt");
    fill("adjustment-amount", "5");
    fireEvent.click(screen.getByTestId("adjustment-add"));
    await waitFor(() =>
      expect(screen.getByTestId("adjustment-add").getAttribute("aria-busy")).toBe("true"),
    );
    finish({ ok: true, id: "a-new", amountCents: -500 });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("shows the server's answer when the month was marked paid in the meantime", async () => {
    addMonthlyAdjustmentAction.mockResolvedValueOnce({ ok: false, error: "locked" });
    renderBill();
    fill("adjustment-label", "Rabatt");
    fill("adjustment-amount", "5");
    fireEvent.click(screen.getByTestId("adjustment-add"));

    await waitFor(() => expect(screen.getByTestId("adjustment-error")).toBeTruthy());
    expect(screen.getByTestId("adjustment-error").textContent).toContain("als bezahlt markiert");
    expect(refresh).not.toHaveBeenCalled();
  });
});
