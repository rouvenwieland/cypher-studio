import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n/de";
import { IconClose } from "./icons";
import { IconButton } from "./Button";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Esc und Schließen-Knopf gesperrt, solange etwas läuft (der Dialog erklärt dann, wie man abbricht) */
  dismissible?: boolean | undefined;
  wide?: boolean | undefined;
  children: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  /** Volle Breite über den Knöpfen im festen Fuß (z. B. Zustimmung): bleibt ohne Scrollen sichtbar */
  footerLead?: ReactNode;
  /** Zusatzbeschreibung für Screenreader */
  describedBy?: string | undefined;
  testId?: string | undefined;
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDialogElement>) => void) | undefined;
}

/**
 * Modaler Dialog über das native <dialog> mit showModal() (ARCHITEKTUR 6.2): Fokusfalle und Esc kommen vom Browser,
 * der Startfokus liegt auf der Überschrift (DESIGN.md §9).
 */
export function Dialog({
  open,
  title,
  onClose,
  dismissible = true,
  wide,
  children,
  footer,
  footerStart,
  footerLead,
  describedBy,
  testId,
  onKeyDown,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const previous = useRef<Element | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      previous.current = document.activeElement;
      el.showModal();
      headingRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
      const prev = previous.current;
      if (prev instanceof HTMLElement && document.contains(prev)) prev.focus();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible) onClose();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [dismissible, onClose]);

  // Scrollbarer Inhalt muss per Tastatur erreichbar sein (WCAG 2.1.1)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog--wide" : "dialog"}
      aria-labelledby={titleId}
      {...(onKeyDown ? { onKeyDown } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {open ? (
        <>
          <header className="dialog__head">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className="dialog__title">
              {title}
            </h2>
            {dismissible ? <IconButton icon={IconClose} label={t.common.close} onClick={onClose} bare /> : null}
          </header>
          <div
            className="dialog__body"
            ref={bodyRef}
            {...(scrollable ? { tabIndex: 0, role: "region", "aria-labelledby": titleId } : {})}
          >
            {children}
          </div>
          {footer || footerStart || footerLead ? (
            <footer className="dialog__foot">
              {footerLead ? <div className="dialog__foot-lead">{footerLead}</div> : null}
              {footerStart ? <div className="dialog__foot-start">{footerStart}</div> : null}
              {footer}
            </footer>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
