import type { ReactNode } from "react";
import { GlyphError, GlyphInfo, GlyphOk, GlyphOpen, GlyphWarn, type IconComponent } from "./icons";

/** Status immer als Form + Wort + Farbe, nie Farbe allein (DESIGN.md color.status). */
export type StatusKind = "ok" | "warn" | "error" | "open" | "info" | "plain";

const GLYPH: Record<StatusKind, IconComponent> = {
  ok: GlyphOk,
  warn: GlyphWarn,
  error: GlyphError,
  open: GlyphOpen,
  info: GlyphInfo,
  plain: GlyphOpen,
};

export function StatusGlyph({ kind, size = 16 }: { kind: StatusKind; size?: number }) {
  const G = GLYPH[kind];
  return <G size={size} />;
}

export function Status({ kind, children, fg }: { kind: StatusKind; children: ReactNode; fg?: boolean | undefined }) {
  return (
    <span className={`status status--${fg ? "fg" : kind}`} data-status={kind}>
      <StatusGlyph kind={kind} />
      <span className="status__word">{children}</span>
    </span>
  );
}

/** Quadratische Lampe: Form + Wort stehen daneben (z. B. Aufträge in der Rail). */
export function Verdict({
  kind,
  word,
  count,
  testId,
}: {
  kind: "ok" | "warn" | "error" | "open";
  word: string;
  count?: ReactNode;
  testId?: string | undefined;
}) {
  const G = GLYPH[kind];
  return (
    <div className={`verdict verdict--${kind}`} role="status" {...(testId ? { "data-testid": testId } : {})}>
      <G size={28} />
      <div className="verdict__body">
        <strong className="t-verdict">{word}</strong>
        {count ? <span className="verdict__count">{count}</span> : null}
      </div>
    </div>
  );
}
