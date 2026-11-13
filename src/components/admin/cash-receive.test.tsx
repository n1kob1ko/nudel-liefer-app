import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowButtons } from "@/components/ui/row-actions";

import de from "../../../messages/de.json";
import { CashReceiveButton } from "./cash-receive";

const recordOfficeCashAction = vi.fn(
  async (): Promise<
    { ok: true; stopId: string; collectedCents: number } | { ok: false; error: string }
  > => ({
    ok: true,
    stopId: "s1",
    collectedCents: 4250,
  }),
);
const refresh = vi.fn();

vi.mock("@/server/payment-actions", () => ({
  recordOfficeCashAction: (...args: unknown[]) => recordOfficeCashAction(...(args as [])),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderButton() {
  return render(
    <NextIntlClientProvider locale="de" messages={de as unknown as AbstractIntlMessages}>
      <RowButtons>
        <CashReceiveButton
          stopId="s1"
          customerName="Gasthaus Linde"
          dateText="16.11.2026"
          dueCents={4250}
        />
      </RowButtons>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CashReceiveButton (NUD-209)", () => {
  it("prefills what was due and records it with one tap", async () => {
    renderButton();
    fireEvent.click(screen.getByTestId("cash-receive-s1"));
    expect(screen.getByTestId("cash-receive-amount")).toHaveValue("42,50");
    fireEvent.click(screen.getByTestId("cash-receive-confirm"));
    await waitFor(() =>
      expect(recordOfficeCashAction).toHaveBeenCalledWith({ stopId: "s1", collectedCents: 4250 }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("refuses an amount it cannot read and shows the server's reason", async () => {
    renderButton();
    fireEvent.click(screen.getByTestId("cash-receive-s1"));
    fireEvent.change(screen.getByTestId("cash-receive-amount"), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("cash-receive-confirm"));
    expect(await screen.findByText(de.admin.payments.cash.receive.errors.invalid)).toBeVisible();
    expect(recordOfficeCashAction).not.toHaveBeenCalled();

    recordOfficeCashAction.mockResolvedValueOnce({ ok: false, error: "not_completed" });
    fireEvent.change(screen.getByTestId("cash-receive-amount"), { target: { value: "40" } });
    fireEvent.click(screen.getByTestId("cash-receive-confirm"));
    expect(
      await screen.findByText(de.admin.payments.cash.receive.errors.not_completed),
    ).toBeVisible();
    expect(recordOfficeCashAction).toHaveBeenCalledWith({ stopId: "s1", collectedCents: 4000 });
  });
});
