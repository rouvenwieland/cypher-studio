import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n/de";
import { Button } from "../../ui/Button";
import { FitText } from "../../ui/FitText";
import { useDocumentTitle } from "../../ui/Frames";
import { IconClose } from "../../ui/icons";

const k = t.onboarding.kennung;

/** Lesbar aus den Tokens: 0 ms heißt „reduzierte Bewegung“ (System oder Einstellung). */
function takt(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-suchlauf-takt").trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 800;
}

/**
 * Kennung (Hero-Moment, lauter Moment 1): Testbild in Fenstergröße. Der Suchlauf schneidet Kanal 1 (Orange) → 2 (Gelb) →
 * 3 (Cyan) im 800-ms-Takt und rastet auf STUDIO ein. Jede Taste oder jeder Klick springt zum Ende; reduziert: sofort das Standbild.
 */
export function Kennung({ version, onStart, onLater }: { version: string; onStart: () => void; onLater: () => void }) {
  useDocumentTitle(t.onboarding.title);
  const [channel, setChannel] = useState<0 | 1 | 2>(() => (takt() === 0 ? 2 : 0));
  const [done, setDone] = useState(() => takt() === 0);
  const timers = useRef<number[]>([]);

  const finish = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setChannel(2);
    setDone(true);
  }, []);

  useEffect(() => {
    const dt = takt();
    if (dt === 0) return;
    timers.current = [window.setTimeout(() => setChannel(1), dt), window.setTimeout(() => setChannel(2), 2 * dt), window.setTimeout(() => setDone(true), 3 * dt)];
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!done) {
        e.preventDefault();
        finish();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, finish, onStart]);

  return (
    <div className="kennung" data-channel={channel} data-done={done} data-testid="kennung" onPointerDown={() => !done && finish()} role="region" aria-label={k.label}>
      <svg className="kennung__grid" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1={i * 100} y1={0} x2={i * 100} y2={800} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 100} x2={1200} y2={i * 100} />
        ))}
        <circle cx={600} cy={400} r={340} />
        <circle cx={600} cy={400} r={4} />
        <line x1={560} y1={400} x2={640} y2={400} />
        <line x1={600} y1={360} x2={600} y2={440} />
      </svg>
      <div className="kennung__top">
        <Button variant="text" onClick={onLater} data-testid="kennung-later">
          <IconClose size={14} />
          {t.onboarding.later}
        </Button>
      </div>
      <div className="kennung__center">
        <h1 className="kennung__title">
          <FitText text={k.cypher} size={260} minSize={60} maxSize={420} label={`${k.cypher} ${k.studio}`} snap />
          <span aria-hidden="true">
            <FitText text={k.studio} size={260} minSize={60} maxSize={420} snap />
          </span>
        </h1>
        <p className="kennung__line t-data">{k.line(version)}</p>
      </div>
      <div className="kennung__bars" aria-hidden="true">
        {k.channels.map((name, i) => (
          <span key={name} className={`kennung__bar kennung__bar--${i}${i === channel ? " kennung__bar--on" : ""}`}>
            <span className="t-data">{`${i + 1} ${name}`}</span>
          </span>
        ))}
      </div>
      <div className="kennung__word t-label" aria-hidden="true">
        {k.channelWord(channel + 1)}
      </div>
      <div className="kennung__go">
        {done ? (
          <Button variant="action" combo="enter" onClick={onStart} data-testid="kennung-start" data-autofocus>
            {k.start}
          </Button>
        ) : (
          <span className="t-meta kennung__hint">{k.skipHint}</span>
        )}
      </div>
      <p className="sr-only" role="status">
        {done ? k.line(version) : ""}
      </p>
    </div>
  );
}
