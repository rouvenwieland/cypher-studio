import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatCombo } from "../lib/keys";
import type { IconComponent } from "./icons";
import { Tip } from "./Tip";

export function Kbd({ combo }: { combo: string }) {
  return <kbd className="kbd">{formatCombo(combo)}</kbd>;
}

/**
 * `action` (Cyan) gehört der einen Ausgangs-Aktion und dem Bestätigen im Dialog (DESIGN §1).
 * `primary` (Tinte) ist der „nächste Schritt“ eines Zustands, z. B. Datei wählen oder Erneut versuchen.
 */
type Variant = "default" | "action" | "primary" | "ghost" | "text" | "danger";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: Variant | undefined;
  small?: boolean | undefined;
  block?: boolean | undefined;
  /** Kürzel-Notation, z. B. "mod+enter": wird als Etikett im Knopf gezeigt */
  combo?: string | undefined;
  icon?: IconComponent | undefined;
  /** gesperrt, aber fokussierbar (Klick erklärt den Grund) */
  softDisabled?: boolean | undefined;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", small, block, combo, icon: Icon, softDisabled, children, type = "button", onClick, ...rest },
  ref,
) {
  const cls = ["btn", variant !== "default" ? `btn--${variant}` : "", small ? "btn--sm" : "", block ? "btn--block" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      {...(softDisabled ? { "aria-disabled": true } : {})}
      onClick={
        softDisabled
          ? (e) => {
              onClick?.(e);
            }
          : onClick
      }
      {...rest}
    >
      {Icon ? <Icon size={16} /> : null}
      {children}
      {combo ? <span className="btn__kbd">{formatCombo(combo)}</span> : null}
    </button>
  );
});

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children" | "aria-label"
> {
  icon: IconComponent;
  label: string;
  combo?: string | undefined;
  pressed?: boolean | undefined;
  bare?: boolean | undefined;
}

/** Symbolknopf: immer mit zugänglichem Namen und Tooltip (DESIGN.md icons.regeln). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, combo, pressed, bare, type = "button", ...rest },
  ref,
) {
  return (
    <Tip label={label} combo={combo}>
      <button
        ref={ref}
        type={type}
        className={bare ? "iconbtn iconbtn--bare" : "iconbtn"}
        aria-label={label}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
        {...(combo ? { "aria-keyshortcuts": combo.replace("mod", "Control") } : {})}
        {...rest}
      >
        <Icon size={16} />
      </button>
    </Tip>
  );
});
