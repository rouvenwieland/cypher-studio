import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../../i18n/de";
import { clamp } from "../../lib/assert";

const c = t.cutout.compare;

/**
 * Vorher/Nachher mit Trennlinie: Ziehen, Pfeiltasten (5 %), Umschalt (25 %). Die Kante des Ergebnisses sieht man
 * auf dem gewählten Hintergrund, nie auf einem Verlauf.
 */
export function CompareView({
  beforeUrl,
  afterUrl,
  backdrop,
  alt,
}: {
  beforeUrl: string;
  afterUrl: string | null;
  backdrop: string;
  alt: string;
}) {
  const [pct, setPct] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const setFrom = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setPct(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 25 : 5;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPct((p) => clamp(p - step, 0, 100));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPct((p) => clamp(p + step, 0, 100));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPct(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPct(100);
    }
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFrom(e.clientX);
  };
  return (
    <div
      className="cmp"
      ref={box}
      data-backdrop={backdrop}
      data-testid="compare"
      onPointerDown={onDown}
      onPointerMove={(e) => drag.current && setFrom(e.clientX)}
      onPointerUp={() => (drag.current = false)}
    >
      <div className="cmp__layer cmp__layer--before">
        <img src={beforeUrl} alt={alt} />
      </div>
      {afterUrl ? (
        <div className="cmp__layer cmp__layer--after" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
          <img src={afterUrl} alt="" />
        </div>
      ) : null}
      {afterUrl ? (
        <>
          <span className="cmp__tag cmp__tag--l t-label">{c.before}</span>
          <span className="cmp__tag cmp__tag--r t-label">{c.after}</span>
          <div
            className="cmp__handle"
            style={{ left: `${pct}%` }}
            role="slider"
            tabIndex={0}
            aria-label={c.divider}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-valuetext={c.value(Math.round(100 - pct))}
            onKeyDown={onKey}
            data-testid="compare-handle"
          >
            <span className="cmp__grip" />
          </div>
        </>
      ) : null}
    </div>
  );
}
