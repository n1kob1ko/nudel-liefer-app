import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import de from "../../../messages/de.json";
import zhHans from "../../../messages/zh-Hans.json";
import { LoginForm } from "./login-form";

/** Inline copy of the L1 auth keys (self-contained, no external fragment file). */
const L1: Record<string, AbstractIntlMessages> = {
  de: {
    auth: {
      errors: {
        pinLength: "PIN muss 6 Ziffern haben",
        usernameRequired: "Bitte Benutzername eingeben",
        credentials: "Benutzername oder PIN falsch",
        emailRequired: "Bitte E-Mail eingeben",
        passwordRequired: "Bitte Passwort eingeben",
      },
      adminLogin: {
        brandSentence: "Büro-Anmeldung Routenplanner",
        showPassword: "Anzeigen",
        hidePassword: "Verbergen",
      },
    },
  },
  "zh-Hans": {
    auth: {
      errors: {
        pinLength: "PIN 必须为 6 位数字",
        usernameRequired: "请输入用户名",
        credentials: "用户名或 PIN 错误",
        emailRequired: "请输入电子邮箱",
        passwordRequired: "请输入密码",
      },
      adminLogin: {
        brandSentence: "Routenplanner 办公室登录",
        showPassword: "显示",
        hidePassword: "隐藏",
      },
    },
  },
};

function merge(base: AbstractIntlMessages, extra: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const previous = out[key];
    out[key] =
      value && typeof value === "object" && previous && typeof previous === "object"
        ? merge(previous as AbstractIntlMessages, value as AbstractIntlMessages)
        : value;
  }
  return out;
}

const MESSAGES: Record<string, AbstractIntlMessages> = {
  de: merge(de as AbstractIntlMessages, L1.de),
  "zh-Hans": merge(zhHans as AbstractIntlMessages, L1["zh-Hans"]),
};

const actions = vi.hoisted(() => ({
  driver: vi.fn(async () => ({ error: null as string | null })),
  admin: vi.fn(async () => ({ error: null as string | null })),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/driver/login",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/auth/actions", () => ({
  driverLoginAction: actions.driver,
  adminLoginAction: actions.admin,
}));
vi.mock("@/server/locale-actions", () => ({ setLocaleAction: vi.fn() }));

function renderIn(locale: string, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const pinField = () => document.querySelector('input[name="pin"]') as HTMLInputElement;

describe("driver login", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the brand, exactly one h1, the language pills and a six-cell PIN input", () => {
    renderIn("de", <LoginForm kind="driver" />);

    expect(screen.getByTestId("login-title")).toHaveTextContent("Fahrer-Anmeldung");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("login-language-picker")).toBeInTheDocument();
    // The full-screen first-start picker owns `language-picker`; the login row must not duplicate it.
    expect(screen.queryByTestId("language-picker")).toBeNull();
    expect(screen.getByTestId("language-switcher")).toHaveValue("de");
    expect(screen.getByTestId("login-pick-sr-Latn")).toHaveTextContent("SR");
    expect(screen.getByTestId("login-pick-cs")).toHaveTextContent("CS");
    expect(screen.getByTestId("driver-login-form")).toHaveAttribute("novalidate");
    expect(document.querySelectorAll("[data-slot=pin-cell]")).toHaveLength(6);
    expect(pinField()).toHaveAttribute("inputmode", "numeric");
    expect(pinField()).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("blocks a short PIN client-side with a localized inline error (F1) and never calls the action", () => {
    renderIn("de", <LoginForm kind="driver" />);
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "fahrer-de" },
    });
    fireEvent.change(pinField(), { target: { value: "123" } });
    fireEvent.submit(screen.getByTestId("driver-login-form"));

    expect(screen.getByText("PIN muss 6 Ziffern haben")).toBeInTheDocument();
    expect(pinField()).toHaveAttribute("aria-invalid", "true");
    expect(actions.driver).not.toHaveBeenCalled();
  });

  it("submits a valid PIN, with the form data, to the existing server action", async () => {
    renderIn("de", <LoginForm kind="driver" />);
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "fahrer-de" },
    });
    // The e2e specs set the value without firing a change event; the component must send the DOM
    // value, not component state.
    pinField().value = "482916";
    fireEvent.submit(screen.getByTestId("driver-login-form"));

    await waitFor(() => expect(actions.driver).toHaveBeenCalledTimes(1));
    const payload = actions.driver.mock.calls[0]?.at(-1) as unknown as FormData;
    expect(payload.get("username")).toBe("fahrer-de");
    expect(payload.get("pin")).toBe("482916");
    expect(screen.queryByText("PIN muss 6 Ziffern haben")).not.toBeInTheDocument();
  });

  it("renders the zh-Hans error text and the zh-Hans form in the right locale", () => {
    renderIn("zh-Hans", <LoginForm kind="driver" />);
    expect(screen.getByTestId("login-title")).toHaveTextContent("司机登录");
    fireEvent.change(pinField(), { target: { value: "12" } });
    fireEvent.submit(screen.getByTestId("driver-login-form"));
    expect(screen.getByText("PIN 必须为 6 位数字")).toBeInTheDocument();
  });

  it("names the wrong credentials under the PIN field when the server rejects the login", async () => {
    actions.driver.mockResolvedValueOnce({ error: "invalid" });
    renderIn("de", <LoginForm kind="driver" />);
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "fahrer-de" },
    });
    fireEvent.change(pinField(), { target: { value: "000000" } });
    fireEvent.submit(screen.getByTestId("driver-login-form"));

    // The specs assert the generic sentence under `login-error`; the field names the reason.
    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toHaveTextContent("fehlgeschlagen"),
    );
    expect(screen.getByText("Benutzername oder PIN falsch")).toBeInTheDocument();
  });
});

describe("office login", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the split layout pieces, email/password fields and the toggle", () => {
    renderIn("de", <LoginForm kind="admin" />);

    expect(screen.getByTestId("login-title")).toHaveTextContent("Anmeldung Büro");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("admin-login-form")).toHaveAttribute("novalidate");
    expect(screen.getByLabelText("E-Mail")).toHaveAttribute("name", "email");
    const password = screen.getByLabelText("Passwort");
    expect(password).toHaveAttribute("type", "password");

    // The toggle's accessible name must not contain "Passwort": the e2e specs locate the password
    // field with `getByLabel("Passwort")` and a second match would break strict mode.
    fireEvent.click(screen.getByRole("button", { name: "Anzeigen" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Verbergen" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("shows localized inline errors instead of native validation and does not submit", () => {
    renderIn("de", <LoginForm kind="admin" />);
    fireEvent.submit(screen.getByTestId("admin-login-form"));

    expect(screen.getByText("Bitte E-Mail eingeben")).toBeInTheDocument();
    expect(screen.getByText("Bitte Passwort eingeben")).toBeInTheDocument();
    expect(actions.admin).not.toHaveBeenCalled();
  });

  it("keeps the server error under data-testid=login-error", async () => {
    actions.admin.mockResolvedValueOnce({ error: "invalid" });
    renderIn("de", <LoginForm kind="admin" />);
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByTestId("admin-login-form"));

    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toHaveTextContent(
        "Anmeldung fehlgeschlagen. Bitte Eingaben prüfen.",
      ),
    );
  });
});
