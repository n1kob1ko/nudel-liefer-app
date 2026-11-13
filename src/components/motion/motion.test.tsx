import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flyTo } from "./fly-to";
import { IconSwap } from "./icon-swap";
import { Stagger } from "./stagger";
import { SuccessPulse } from "./success-pulse";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Stagger", () => {
  it("numbers its rows so each one arrives 30 ms after the one before", () => {
    render(
      <Stagger as="ul" data-testid="list">
        <li>eins</li>
        <li className="font-bold">zwei</li>
        <li style={{ color: "red" }}>drei</li>
      </Stagger>,
    );
    const rows = screen.getByTestId("list").querySelectorAll("li");
    expect(rows[0]!.style.getPropertyValue("--i")).toBe("0");
    expect(rows[2]!.style.getPropertyValue("--i")).toBe("2");
    expect(rows[2]!.style.color).toBe("red");
    expect(rows[1]).toHaveClass("stagger-item", "font-bold");
  });

  it("stops counting at the cap, so a long list is not kept waiting", () => {
    render(
      <Stagger data-testid="list">
        {Array.from({ length: 20 }, (_, index) => (
          <p key={index}>{index}</p>
        ))}
      </Stagger>,
    );
    const rows = screen.getByTestId("list").querySelectorAll("p");
    expect(rows[11]!.style.getPropertyValue("--i")).toBe("11");
    expect(rows[19]!.style.getPropertyValue("--i")).toBe("11");
  });

  it("leaves text and empty children alone", () => {
    render(
      <Stagger data-testid="list">
        {null}
        nur Text
        <p>Zeile</p>
      </Stagger>,
    );
    expect(screen.getByTestId("list")).toHaveTextContent("nur TextZeile");
    expect(screen.getByText("Zeile").style.getPropertyValue("--i")).toBe("0");
  });
});

describe("SuccessPulse", () => {
  it("stays still on mount, even when it starts active", () => {
    const { container } = render(
      <SuccessPulse active>
        <button>Geliefert</button>
      </SuccessPulse>,
    );
    expect(container.querySelector('[data-slot="pulse-ring"]')).toBeNull();
  });

  it("pulses once each time the action goes through", () => {
    const { container, rerender } = render(
      <SuccessPulse active={false}>
        <button>Geliefert</button>
      </SuccessPulse>,
    );
    rerender(
      <SuccessPulse active>
        <button>Geliefert</button>
      </SuccessPulse>,
    );
    const first = container.querySelector('[data-slot="pulse-ring"]');
    expect(first).not.toBeNull();
    expect(first).toHaveAttribute("aria-hidden", "true");
    rerender(
      <SuccessPulse active={false}>
        <button>Geliefert</button>
      </SuccessPulse>,
    );
    rerender(
      <SuccessPulse active>
        <button>Geliefert</button>
      </SuccessPulse>,
    );
    // A new element (keyed by the count), so the animation restarts.
    expect(container.querySelector('[data-slot="pulse-ring"]')).not.toBe(first);
  });
});

describe("IconSwap", () => {
  it("does not animate on mount", () => {
    render(<IconSwap iconKey="sun" icon={<span>Sonne</span>} />);
    expect(screen.getByText("Sonne").parentElement).not.toHaveClass("icon-enter");
  });

  it("keeps the old icon on screen while the new one comes in, then removes it", () => {
    vi.useFakeTimers();
    const { rerender } = render(<IconSwap iconKey="sun" icon={<span>Sonne</span>} />);
    rerender(<IconSwap iconKey="moon" icon={<span>Mond</span>} />);

    const leaving = screen.getByText("Sonne").parentElement!;
    expect(leaving).toHaveAttribute("data-state", "exit");
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveClass("icon-exit");
    expect(screen.getByText("Mond").parentElement).toHaveClass("icon-enter");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Sonne")).toBeNull();
    expect(screen.getByText("Mond")).toBeInTheDocument();
  });
});

describe("flyTo", () => {
  const box = (left: number, top: number) => ({ left, top }) as DOMRect;

  function element(left: number, top: number) {
    const node = document.createElement("div");
    node.getBoundingClientRect = () => box(left, top);
    const animate = vi.fn(() => ({}) as Animation);
    node.animate = animate as unknown as typeof node.animate;
    return { node, animate };
  }

  it("moves nothing for people who asked for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { node, animate } = element(100, 100);
    expect(flyTo(node, box(0, 0))).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("moves nothing when the element is where it was", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { node, animate } = element(40, 40);
    expect(flyTo(node, box(40, 40))).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("runs x and y on different curves, which bends the path into an arc", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { node, animate } = element(200, 300);
    expect(flyTo(node, box(20, 60))).not.toBeNull();
    expect(animate).toHaveBeenCalledTimes(2);
    const [xFrames, xOptions] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    const [yFrames, yOptions] = animate.mock.calls[1] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(xFrames[0]!.transform).toBe("translateX(-180px)");
    expect(yFrames[0]!.transform).toBe("translateY(-240px)");
    expect(xOptions.easing).not.toBe(yOptions.easing);
    expect(xOptions.composite).toBe("add");
  });
});
