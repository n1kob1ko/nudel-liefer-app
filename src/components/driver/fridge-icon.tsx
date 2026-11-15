import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The fridge mark on the driver screens: the light-blue snowflake the owner picked (2026-11-15),
 * traced from his picture into one path so it stays sharp at every size and works offline. It keeps
 * its own blue gradient (not currentColor), so it reads as "cold" on the light and the dark theme.
 */
export function FridgeIcon({ className }: { className?: string }) {
  const gradient = `fridge-${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox="34 34 673 673"
      className={cn("size-5 shrink-0", className)}
      aria-hidden
      focusable="false"
      data-icon="fridge"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="36" x2="0" y2="705" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#85e5fe" />
          <stop offset="1" stopColor="#5a9edd" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradient})`}
        fillRule="evenodd"
        d="M67 515 70 511 109 489 62 461 88 413 164 457 201 436 117 387 117 355 119 353 198 308 201 304 164 284 88 328 62 280 108 254 109 251 67 226 94 180 138 204 138 148 192 148 192 236 228 257 230 247 230 159 246 149 259 144 342 192 342 149 267 106 294 58 341 86 343 85 343 36 397 36 398 86 447 58 473 106 397 150 397 191 399 192 480 144 484 144 510 158 511 257 548 236 548 148 603 148 602 203 608 202 646 180 673 226 631 251 632 254 679 280 652 327 576 284 539 304 549 312 623 354 622 387 539 436 576 457 652 413 678 461 630 489 672 512 673 515 646 561 603 537 603 593 547 592 547 504 513 484 511 484 511 581 489 595 482 597 466 589 398 549 398 592 474 635 447 682 440 680 398 655 398 704 343 705 341 655 293 683 266 635 342 592 342 549 260 597 256 597 232 584 229 570 229 484 193 504 193 593 138 593 138 537 94 561ZM284 222 284 289 342 322 342 255ZM456 222 398 255 398 322 456 289ZM199 371 258 404 314 370 256 337ZM541 371 484 337 426 370 483 404ZM342 419 284 452 284 518 342 486ZM398 419 398 486 456 518 456 452Z"
      />
    </svg>
  );
}
