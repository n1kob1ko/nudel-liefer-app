import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { FormField } from "./form-field";

describe("Button", () => {
  afterEach(cleanup);

  it("renders its label and stays enabled by default", () => {
    render(<Button>Speichern</Button>);
    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("shows a spinner, sets aria-busy and disables itself while loading", () => {
    render(<Button loading>Speichern</Button>);
    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("keeps the label visible while loading so the button does not change width", () => {
    render(<Button loading>Geliefert</Button>);
    const button = screen.getByRole("button", { name: "Geliefert" });
    expect(button).toHaveTextContent("Geliefert");
    expect(button.querySelector(".sr-only")).toBeNull();
  });

  it("keeps the driver size at >= 48 px and lets a caller override it", () => {
    const { rerender } = render(<Button size="lg">Weiter</Button>);
    const large = screen.getByRole("button").className;
    expect(large).toContain("min-h-12");
    rerender(
      <Button size="lg" className="min-h-14 text-lg">
        Weiter
      </Button>,
    );
    const overridden = screen.getByRole("button").className;
    // tailwind-merge: the caller's min-height/type size wins over the variant's.
    expect(overridden).toContain("min-h-14");
    expect(overridden).toContain("text-lg");
    expect(overridden).not.toContain("min-h-12");
  });

  it("exposes the xl driver primary size", () => {
    render(<Button size="xl">Navigation starten</Button>);
    expect(screen.getByRole("button").className).toContain("min-h-14");
  });

  it("keeps the documented variants available", () => {
    const { rerender } = render(<Button variant="secondary">Zurück</Button>);
    expect(screen.getByRole("button").className).toContain("bg-primary-soft");
    rerender(<Button variant="success">Geliefert</Button>);
    expect(screen.getByRole("button").className).toContain("bg-success");
    rerender(<Button variant="primary">Weiter</Button>);
    expect(screen.getByRole("button").className).toContain("bg-primary");
  });

  it("fills the important action with yolk and ink, with a tactile edge", () => {
    render(<Button>Tour freigeben</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-primary", "text-primary-foreground", "btn-edge");
  });

  it("gives every variant the 0.97 press", () => {
    const variants = [
      "default",
      "primary",
      "destructive",
      "warning",
      "outline",
      "secondary",
      "ghost",
      "success",
    ] as const;
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>Knopf</Button>);
      expect(screen.getByRole("button").className, variant).toContain("active:scale-[.97]");
      unmount();
    }
  });

  it("keeps the edge to filled buttons: quiet variants stay flat", () => {
    const { rerender } = render(<Button variant="outline">Bearbeiten</Button>);
    expect(screen.getByRole("button")).not.toHaveClass("btn-edge");
    rerender(<Button variant="ghost">Abbrechen</Button>);
    expect(screen.getByRole("button")).not.toHaveClass("btn-edge");
    rerender(<Button variant="destructive">Löschen</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn-edge", "bg-destructive");
  });

  it("has a soft red variant for reporting a problem", () => {
    render(<Button variant="warning">Problem</Button>);
    expect(screen.getByRole("button")).toHaveClass(
      "bg-destructive-soft",
      "text-destructive-soft-foreground",
    );
  });

  it("lets a caller's colour win over the variant's", () => {
    render(<Button className="bg-info text-info-foreground">Info</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-info", "text-info-foreground");
    expect(button).not.toHaveClass("bg-primary");
    expect(button).not.toHaveClass("text-primary-foreground");
  });

  it("slots a single child when asChild is used (Radix Slot rejects an array)", () => {
    render(
      <Button asChild variant="outline" size="lg">
        {/* Deliberately a plain <a>: the unit test must assert the real DOM element Radix Slot
            produces, not next/link's wrapper. No navigation happens here. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above */}
        <a href="/de/admin">Zum Büro</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Zum Büro" });
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link.className).toContain("min-h-12");
    expect(link).toHaveAttribute("href", "/de/admin");
  });
});

describe("Card", () => {
  afterEach(cleanup);

  it("is a white surface with a hairline border and next to no shadow (redesign RD2)", () => {
    render(
      <Card data-testid="card">
        <CardHeader action={<Button size="sm">Neu</Button>}>
          <CardTitle>Touren</CardTitle>
        </CardHeader>
        <CardContent>Inhalt</CardContent>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("border-border");
    expect(card).toHaveClass("shadow-xs");
    expect(card).not.toHaveClass("cursor-pointer");
    expect(screen.getByText("Touren")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neu" })).toBeInTheDocument();
  });

  it("becomes a raised clickable surface with interactive", () => {
    render(<Card data-testid="card" interactive />);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("cursor-pointer", "hover:shadow-md", "active:scale-[.99]");
  });
});

describe("FormField", () => {
  afterEach(cleanup);

  it("wires label, description and error to the control", () => {
    render(
      <FormField
        id="pin"
        label="PIN"
        description="Sechs Ziffern"
        error="PIN muss 6 Ziffern haben"
        required
      >
        <input />
      </FormField>,
    );
    const field = screen.getByLabelText(/PIN/) as HTMLInputElement;
    expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = field.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy).toEqual(["pin-description", "pin-error"]);

    const description = document.getElementById("pin-description");
    expect(description).toHaveTextContent("Sechs Ziffern");
    const error = document.getElementById("pin-error");
    expect(error).toHaveTextContent("PIN muss 6 Ziffern haben");
    expect(error).toHaveAttribute("role", "alert");
  });

  it("marks the label as required and hides the marker from assistive tech", () => {
    render(
      <FormField id="name" label="Name" required>
        <input />
      </FormField>,
    );
    const label = document.querySelector("label")!;
    expect(label).toHaveAttribute("for", "name");
    // The marker sits right after the label text but outside the <label>, so the accessible
    // name stays exactly "Name" (layout refresh 2026-10).
    expect(label).toHaveTextContent(/^Name$/);
    expect(label.parentElement!.querySelector("[aria-hidden]")).toHaveTextContent("*");
  });

  it("keeps an appending aria-describedby from the caller", () => {
    render(
      <FormField id="email" label="E-Mail" description="Dienstliche Adresse" error="Pflichtfeld">
        <input aria-describedby="external-hint" />
      </FormField>,
    );
    expect(screen.getByLabelText("E-Mail")).toHaveAttribute(
      "aria-describedby",
      "external-hint email-description email-error",
    );
  });

  it("reuses the control's own id when it already has one", () => {
    render(
      <FormField label="Ort" error="Fehlt">
        <input id="city" />
      </FormField>,
    );
    const field = screen.getByLabelText("Ort");
    expect(field).toHaveAttribute("aria-describedby", "city-error");
    expect(document.querySelector("label")).toHaveAttribute("for", "city");
  });
});
