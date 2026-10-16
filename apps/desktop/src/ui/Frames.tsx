import { useEffect, type ReactNode } from "react";
import { t } from "../i18n/de";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = t.common.windowTitle(title);
  }, [title]);
}

interface TitleBarProps {
  title: string;
  context?: ReactNode;
  tools?: ReactNode;
}

function TitleBar({ title, context, tools }: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__main">
        <h1 className="t-title">{title}</h1>
        {context ? <div className="titlebar__context t-data">{context}</div> : null}
      </div>
      {tools ? <div className="titlebar__tools">{tools}</div> : null}
    </header>
  );
}

interface BenchProps {
  /** Titel des Bildschirms (genau einer, Anybody) */
  title: string;
  /** Kontext-Messzeile hinter dem Titel */
  context?: ReactNode;
  /** Profil- oder Ansichtswahl rechts in der Titelzeile */
  tools?: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  inspectorTitle?: string | undefined;
  inspectorHeadExtra?: ReactNode;
  output?: ReactNode;
  /** data-umfeld der Vorschau (hell | mittel | dunkel) */
  surround?: "hell" | "mittel" | "dunkel" | undefined;
  previewLabel?: string | undefined;
  previewNote?: ReactNode;
  testId?: string | undefined;
}

/** Arbeitsmodul: Titelzeile · Vorschau (Monitor) · Messung (Inspektor) · Ausgang (Leiste), CONCEPT.md 5. */
export function Bench({
  title,
  context,
  tools,
  preview,
  inspector,
  inspectorTitle,
  inspectorHeadExtra,
  output,
  surround,
  previewLabel,
  previewNote,
  testId,
}: BenchProps) {
  useDocumentTitle(title);
  return (
    <div className={output ? "stage" : "stage stage--plain"} {...(testId ? { "data-testid": testId } : {})}>
      <TitleBar title={title} context={context} tools={tools} />
      <div className="bench">
        <main
          className="preview"
          id="main"
          data-region="preview"
          tabIndex={-1}
          aria-label={previewLabel ?? t.common.region.preview}
          {...(surround ? { "data-umfeld": surround } : {})}
        >
          <div className="preview__stage">{preview}</div>
          {previewNote ? <p className="preview__note t-meta">{previewNote}</p> : null}
        </main>
        <aside
          className="inspector"
          data-region="inspector"
          tabIndex={-1}
          aria-label={inspectorTitle ?? t.common.region.inspector}
        >
          <div className="inspector__head">
            <h2 className="t-label">{inspectorTitle ?? t.common.labels.measurement}</h2>
            {inspectorHeadExtra}
          </div>
          <div className="inspector__body">{inspector}</div>
        </aside>
      </div>
      {output}
    </div>
  );
}

interface PlainPageProps {
  title: string;
  context?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  flush?: boolean | undefined;
  output?: ReactNode;
  testId?: string | undefined;
}

/** Seite ohne Vorschau (Start, Programme, Einstellungen …). */
export function PlainPage({ title, context, tools, children, flush, output, testId }: PlainPageProps) {
  useDocumentTitle(title);
  return (
    <div className={output ? "stage" : "stage stage--plain"} {...(testId ? { "data-testid": testId } : {})}>
      <TitleBar title={title} context={context} tools={tools} />
      <main
        className={flush ? "page page--flush" : "page"}
        id="main"
        data-region="preview"
        tabIndex={-1}
        aria-label={t.common.region.main}
      >
        {children}
      </main>
      {output}
    </div>
  );
}
