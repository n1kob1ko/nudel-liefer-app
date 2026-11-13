"use client";

import { type PointerEvent as ReactPointerEvent, useRef } from "react";

import { rubberBand, shouldDismiss } from "./rubber-band";

type Drag = { pointerId: number; startY: number; startTime: number; height: number };

/**
 * Swipe-to-dismiss for a bottom sheet (motion rules 14 and 19). Spread the returned handlers on the
 * drag handle; `getSheet` returns the sheet element that should follow the finger.
 *
 * While the finger is down the sheet follows it 1:1 with no transition (nothing tweens while it is
 * held). Pulling up, where the sheet cannot go, meets a rubber band. On release the sheet either
 * leaves (far enough, or flicked) or settles back on the drawer curve. A second finger is ignored,
 * so switching fingers mid-drag cannot make the sheet jump.
 *
 * `onDismiss` closes the sheet; its exit keyframe starts from `--sheet-from`, which is set to where
 * the sheet was let go, so it carries on from under the finger instead of jumping back first.
 */
export function useSheetDrag(getSheet: () => HTMLElement | null, onDismiss: () => void) {
  const drag = useRef<Drag | null>(null);

  function offset(event: ReactPointerEvent, current: Drag): number {
    const delta = event.clientY - current.startY;
    return delta >= 0 ? delta : -rubberBand(-delta, current.height * 0.3);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const sheet = getSheet();
    if (drag.current || !sheet || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // An entrance that is still running would win over the inline transform: land it first.
    sheet.getAnimations?.().forEach((animation) => animation.finish());
    sheet.style.transition = "none";
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: event.timeStamp,
      height: sheet.offsetHeight || 1,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    const sheet = getSheet();
    if (!current || !sheet || event.pointerId !== current.pointerId) return;
    sheet.style.transform = `translateY(${offset(event, current)}px)`;
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    const sheet = getSheet();
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (!sheet) return;
    const distance = event.clientY - current.startY;
    const cancelled = event.type === "pointercancel";
    if (
      !cancelled &&
      shouldDismiss(distance, event.timeStamp - current.startTime, current.height)
    ) {
      sheet.style.setProperty("--sheet-from", `${Math.max(0, distance)}px`);
      onDismiss();
      return;
    }
    sheet.style.transition = "transform var(--dur-sheet-out) var(--ease-drawer)";
    sheet.style.transform = "translateY(0)";
    const settle = () => {
      sheet.style.transition = "";
      sheet.style.transform = "";
      sheet.removeEventListener("transitionend", settle);
    };
    sheet.addEventListener("transitionend", settle);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };
}
