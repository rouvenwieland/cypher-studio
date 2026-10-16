import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { formatCombo } from "../lib/keys";

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={450} skipDelayDuration={200} disableHoverableContent>
      {children}
    </Tooltip.Provider>
  );
}

/** Tooltip mit Name und Kürzel. Der Name steht zusätzlich als zugänglicher Name am Auslöser. */
export function Tip({ label, combo, children, side = "top" }: { label: string; combo?: string | undefined; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={8}>
          <span>{label}</span>
          {combo ? <kbd className="kbd">{formatCombo(combo)}</kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
