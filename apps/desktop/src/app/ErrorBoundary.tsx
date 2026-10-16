import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n/de";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Bits";

interface Props {
  children: ReactNode;
  /** Wechselt der Schlüssel (Route), wird der Fehlerzustand zurückgesetzt */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** Fehlergrenze je Bildschirm: Ein Absturz im Modul nimmt weder Rail noch Aufträge mit. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Bildschirm abgestürzt", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const b = t.common.errorBoundary;
    return (
      <main className="page" id="main" data-region="preview" tabIndex={-1} aria-label={t.common.region.main}>
        <div className="empty">
          <h1 className="t-title">{b.title}</h1>
          <Notice
            kind="error"
            title={b.title}
            actions={
              <>
                <Button onClick={() => this.setState({ error: null })}>{b.reload}</Button>
                <Button
                  onClick={() => {
                    window.location.hash = "/start";
                    this.setState({ error: null });
                  }}
                >
                  {b.home}
                </Button>
                <Button variant="text" onClick={() => void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n${error.stack ?? ""}`)}>
                  {b.copyDetails}
                </Button>
              </>
            }
          >
            {b.text}
          </Notice>
          <pre className="t-data selectable">{error.message}</pre>
        </div>
      </main>
    );
  }
}
