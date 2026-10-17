import { Fragment, type ReactNode } from "react";
import { GlyphError, GlyphInfo, GlyphOk, GlyphWarn } from "./icons";

export interface MzItem {
  label: string;
  value: ReactNode;
  /** Beginnt eine neue Zeile (lange Werte wie Pfade), ohne „·“ am Zeilenende. */
  newLine?: boolean;
}

/** Messzeile: Paare aus Etikett und Wert, getrennt durch „·“ (CONCEPT.md 5, Bausteine des Gerüsts). */
export function MessZeile({
  items,
  plain,
  stacked,
  label,
}: {
  items: MzItem[];
  plain?: boolean | undefined;
  /** Untereinander statt in einer Zeile (schmaler Inspektor): Etikett links, Wert rechts, ohne „·“. */
  stacked?: boolean | undefined;
  label?: string | undefined;
}) {
  const cls = ["mz", plain ? "mz--plain" : "", stacked ? "mz--stack" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} {...(label ? { role: "group", "aria-label": label } : {})}>
      {items.map((item, i) => (
        <Fragment key={`${item.label}-${i}`}>
          {i > 0 && item.newLine ? <span className="mz__break" aria-hidden="true" /> : null}
          <span className="mz__item">
            {/* Das „·“ gehört zum folgenden Eintrag: bricht der um, nimmt er es mit */}
            {i > 0 && !item.newLine ? (
              <span className="mz__sep" aria-hidden="true">
                ·
              </span>
            ) : null}
            <span className="mz__label">{item.label}</span>
            <span className="mz__value">{item.value}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Fakten als zweispaltige Tabelle (Dialoge): Etikett links, Wert rechts. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode; sub?: ReactNode; id?: string }[] }) {
  return (
    <dl className="facts">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt className="facts__label t-label">{r.label}</dt>
          <dd className="facts__value" {...(r.id ? { id: r.id } : {})}>
            {r.value}
            {r.sub ? <span className="facts__sub t-meta">{r.sub}</span> : null}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

type NoticeKind = "error" | "warn" | "ok" | "info";

/** Fehlerfläche nach der Formel: Was ist passiert · was ist sicher · was kannst du tun (DESIGN.md §7). */
export function Notice({
  kind,
  title,
  children,
  actions,
  role,
  testId,
}: {
  kind: NoticeKind;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status" | undefined;
  testId?: string | undefined;
}) {
  const G = kind === "error" ? GlyphError : kind === "warn" ? GlyphWarn : kind === "ok" ? GlyphOk : GlyphInfo;
  return (
    <div
      className={`notice notice--${kind}`}
      {...(role ? { role } : kind === "error" ? { role: "alert" } : {})}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <G size={20} />
      <div className="notice__body">
        <strong className="notice__title">{title}</strong>
        {children ? <div className="t-meta">{children}</div> : null}
        {actions ? <div className="notice__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Leerer Zustand: was fehlt + was der nächste Schritt bewirkt (CONCEPT.md 7). */
export function EmptyState({
  title,
  children,
  actions,
  testId,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string | undefined;
}) {
  return (
    <div className="empty" {...(testId ? { "data-testid": testId } : {})}>
      {title ? <h2 className="t-section">{title}</h2> : null}
      <p className="t-read">{children}</p>
      {actions ? <div className="cluster">{actions}</div> : null}
    </div>
  );
}

/** Balken mit echtem Wert (0..1). Kein Spinner: ist der Wert unbekannt, steht Text da. */
export function Bar({
  value,
  label,
  valueText,
  thin,
}: {
  value: number;
  label: string;
  valueText: string;
  thin?: boolean | undefined;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={thin ? "bar bar--thin" : "bar"}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={valueText}
    >
      <div className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
