import { useEffect, useState, type ReactNode } from "react";
import type { Collection, LibraryEntry, LibraryFacets, LibraryKind, LibraryEntryStatus } from "@contract";
import { ellipsizeMiddle, fmtBytes, fmtCount, fmtDateTime, fmtRelative } from "../../i18n/format";
import { t } from "../../i18n/de";
import { Button } from "../../ui/Button";
import { Facts, Notice } from "../../ui/Bits";
import { Checkbox, SelectField } from "../../ui/Inputs";
import { IconClose, IconPlus } from "../../ui/icons";
import { Status } from "../../ui/Status";
import type { LibraryFilters } from "./useLibraryPages";

const L = t.library;

export const KIND_ORDER: LibraryKind[] = [
  "image",
  "vector",
  "model3d",
  "video",
  "audio",
  "font",
  "palette",
  "document",
  "other",
];

/* ---------- Filterspalte ---------- */

export function Filters({
  facets,
  collections,
  filters,
  onChange,
}: {
  facets: LibraryFacets | null;
  collections: Collection[];
  filters: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
}) {
  const f = L.filters;
  const toggle = <T extends string>(list: T[] | undefined, value: T): T[] =>
    list?.includes(value) ? list.filter((x) => x !== value) : [...(list ?? []), value];
  const tagEntries = Object.entries(facets?.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const dayMs = 86_400_000;
  const periods: { id: string; label: string; days: number }[] = [
    { id: "p7", label: f.period7, days: 7 },
    { id: "p30", label: f.period30, days: 30 },
    { id: "p365", label: f.period365, days: 365 },
  ];
  const setPeriod = (days: number | null) => {
    const next = { ...filters };
    if (days === null) delete next.modifiedAfter;
    else next.modifiedAfter = new Date(Date.now() - days * dayMs).toISOString();
    onChange(next);
  };
  const activePeriod = filters.modifiedAfter
    ? periods.find(
        (p) => Math.abs(Date.now() - p.days * dayMs - new Date(filters.modifiedAfter ?? 0).getTime()) < 3 * dayMs,
      )?.id
    : undefined;
  return (
    <nav className="filters" aria-label={f.title} data-testid="library-filters">
      <fieldset className="filters__group">
        <legend className="t-label">{f.kind}</legend>
        {KIND_ORDER.filter((k) => (facets?.kinds[k] ?? 0) > 0 || filters.kinds?.includes(k)).map((k) => (
          <Checkbox
            key={k}
            checked={filters.kinds?.includes(k) ?? false}
            onChange={() => onChange({ ...filters, kinds: toggle(filters.kinds, k) })}
          >
            <span className="filters__row">
              <span>{L.kinds[k]}</span>
              <span className="t-data t-mute">{fmtCount(facets?.kinds[k] ?? 0)}</span>
            </span>
          </Checkbox>
        ))}
      </fieldset>
      <fieldset className="filters__group">
        <legend className="t-label">{f.collection}</legend>
        {collections.map((c) => (
          <Checkbox
            key={c.id}
            checked={filters.collections?.includes(c.id) ?? false}
            onChange={() => onChange({ ...filters, collections: toggle(filters.collections, c.id) })}
          >
            <span className="filters__row">
              <span className="coll">
                <span className="coll__sw" style={{ background: c.hex }} aria-hidden="true" />
                {c.name}
              </span>
              <span className="t-data t-mute">{fmtCount(facets?.collections[c.id] ?? 0)}</span>
            </span>
          </Checkbox>
        ))}
      </fieldset>
      <fieldset className="filters__group">
        <legend className="t-label">{f.tags}</legend>
        {tagEntries.length === 0 ? <p className="t-meta t-mute">{f.noTags}</p> : null}
        {tagEntries.map(([tag, n]) => (
          <Checkbox
            key={tag}
            checked={filters.tags?.includes(tag) ?? false}
            onChange={() => onChange({ ...filters, tags: toggle(filters.tags, tag) })}
          >
            <span className="filters__row">
              <span>{tag}</span>
              <span className="t-data t-mute">{fmtCount(n)}</span>
            </span>
          </Checkbox>
        ))}
      </fieldset>
      <fieldset className="filters__group">
        <legend className="t-label">{f.period}</legend>
        {periods.map((p) => (
          <Checkbox key={p.id} checked={activePeriod === p.id} onChange={(on) => setPeriod(on ? p.days : null)}>
            {p.label}
          </Checkbox>
        ))}
        <Checkbox
          checked={filters.onlyConflicts ?? false}
          onChange={(on) =>
            onChange({ ...filters, ...(on ? { onlyConflicts: true } : {}), ...(!on ? { onlyConflicts: false } : {}) })
          }
        >
          {f.conflicts}
        </Checkbox>
      </fieldset>
    </nav>
  );
}

/* ---------- Zelle ---------- */

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : "";
}

export function Thumb({ entry, className }: { entry: LibraryEntry; className?: string }) {
  if (entry.thumbnailUrl)
    return (
      <img
        className={className ? `thumb ${className}` : "thumb"}
        src={entry.thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <span className={className ? `thumb thumb--type ${className}` : "thumb thumb--type"} aria-hidden="true">
      <span className="t-data thumb__ext">{`.${extOf(entry.fileName).toUpperCase()}`}</span>
    </span>
  );
}

export function Cell({
  entry,
  selected,
  active,
  index,
  onClick,
  onDoubleClick,
  nameChars,
}: {
  entry: LibraryEntry;
  selected: boolean;
  active: boolean;
  index: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  /** So viele Zeichen passen unter das Vorschaubild; längere Namen werden in der Mitte gekürzt, die Endung bleibt */
  nameChars: number;
}) {
  const g = L.grid;
  return (
    <div
      role="option"
      aria-selected={selected}
      className={selected ? "cell cell--on" : "cell"}
      tabIndex={active ? 0 : -1}
      data-roving-index={index}
      data-testid={`cell-${index}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="cell__img">
        <Thumb entry={entry} />
        {selected ? (
          <span className="cell__check" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
        ) : null}
      </div>
      <span className="cell__name t-meta" title={entry.fileName}>
        {ellipsizeMiddle(entry.fileName, nameChars)}
      </span>
      <span className="cell__meta t-data t-mute">
        {g.typeAndSize(extOf(entry.fileName).toUpperCase(), fmtBytes(entry.size))}
        {entry.conflict ? <span className="cell__conflict"> · {g.conflictBadge}</span> : null}
      </span>
    </div>
  );
}

export function Skeleton() {
  return <div className="cell cell--skel" aria-hidden="true" />;
}

/* ---------- Inspektor ---------- */

function TagEditor({
  entry,
  onChange,
  readOnly,
}: {
  entry: LibraryEntry;
  onChange: (tags: string[]) => void;
  readOnly: boolean;
}) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);
  const commit = (tags: string[]) => {
    onChange(tags);
    setSaved(true);
  };
  const add = () => {
    const v = text.trim().toLowerCase();
    if (v && !entry.meta.tags.includes(v)) commit([...entry.meta.tags, v]);
    setText("");
  };
  const i = L.inspector;
  return (
    <div className="stack">
      <div className="cluster">
        <h3 className="t-label">{i.tags}</h3>
        {saved ? (
          <span className="t-meta status status--ok" role="status">
            {i.tagSaved}
          </span>
        ) : null}
      </div>
      <ul className="cluster tags" aria-label={i.tags}>
        {entry.meta.tags.map((tag) => (
          <li key={tag} className="tag">
            {tag}
            {readOnly ? null : (
              <button
                type="button"
                className="tag__x"
                aria-label={i.removeTag(tag)}
                onClick={() => commit(entry.meta.tags.filter((x) => x !== tag))}
              >
                <IconClose size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {readOnly ? (
        <p className="t-meta t-mute">{i.readOnly}</p>
      ) : (
        <form
          className="input-group"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={i.tagPlaceholder}
            aria-label={i.addTag}
            data-testid="tag-input"
          />
          <Button type="submit" aria-label={i.addTag} data-testid="tag-add">
            <IconPlus size={16} />
          </Button>
        </form>
      )}
    </div>
  );
}

export function EntryInspector({
  entry,
  collections,
  programName,
  onOpen,
  onToPrint,
  onToMockup,
  onToCutout,
  onReveal,
  onTags,
  onStatus,
  onCollection,
}: {
  entry: LibraryEntry;
  collections: Collection[];
  programName: string | null;
  onOpen: () => void;
  onToPrint: () => void;
  onToMockup: () => void;
  onToCutout: () => void;
  onReveal: () => void;
  onTags: (tags: string[]) => void;
  onStatus: (s: LibraryEntryStatus) => void;
  onCollection: (id: string | null) => void;
}) {
  const i = L.inspector;
  const isRaster = entry.kind === "image";
  return (
    <div className="stack stack--loose entry" data-testid="entry-inspector">
      <div className="entry__preview">
        <Thumb entry={entry} />
      </div>
      <h3 className="t-section entry__name selectable">{entry.fileName}</h3>
      <Facts
        rows={[
          { label: i.facts.path, value: <span className="t-data selectable">{entry.relPath}</span> },
          { label: i.facts.size, value: <span className="t-data">{fmtBytes(entry.size)}</span> },
          ...(entry.widthPx && entry.heightPx
            ? [
                {
                  label: i.facts.dimensions,
                  value: <span className="t-data">{`${entry.widthPx} × ${entry.heightPx} px`}</span>,
                },
              ]
            : []),
          {
            label: i.facts.modified,
            value: (
              <span className="t-data">{`${fmtRelative(entry.modifiedAt)} · ${fmtDateTime(entry.modifiedAt)}`}</span>
            ),
          },
          { label: i.facts.author, value: entry.meta.author || "—" },
        ]}
      />
      {entry.conflict ? (
        <Notice kind="warn" title={i.conflictTitle} role="status">
          {i.conflictText(entry.conflict.originalRelPath)}
        </Notice>
      ) : null}
      <SelectField
        label={L.filters.collection}
        value={entry.meta.collection ?? ""}
        onChange={(v) => onCollection(v || null)}
        options={[
          { value: "", label: L.multi.noCollection },
          ...collections.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <SelectField
        label={i.facts.status}
        value={entry.meta.status}
        onChange={(v) => onStatus(v as LibraryEntryStatus)}
        options={(["draft", "approved", "archived"] as const).map((s) => ({ value: s, label: i.status[s] }))}
      />
      <TagEditor entry={entry} onChange={onTags} readOnly={false} />
      {entry.sidecarMissing ? <p className="t-meta t-mute">{i.sidecarMissing}</p> : null}
      <div className="stack entry__actions">
        <Button variant="action" combo="mod+enter" onClick={onOpen} data-testid="entry-open">
          {programName ? i.openIn(programName) : i.openDefault}
        </Button>
        {isRaster ? (
          <Button onClick={onToPrint} data-testid="entry-print">
            {i.checkPrint}
          </Button>
        ) : null}
        {isRaster ? <Button onClick={onToMockup}>{i.mockup}</Button> : null}
        {isRaster ? <Button onClick={onToCutout}>{i.cutout}</Button> : null}
        <Button onClick={onReveal}>{i.reveal}</Button>
      </div>
    </div>
  );
}

/** Zeilen der Listenansicht */
export function ListRow({
  entry,
  selected,
  active,
  index,
  collections,
  onClick,
  onDoubleClick,
}: {
  entry: LibraryEntry;
  selected: boolean;
  active: boolean;
  index: number;
  collections: Collection[];
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}): ReactNode {
  const coll = collections.find((c) => c.id === entry.meta.collection);
  return (
    <div
      role="option"
      aria-selected={selected}
      className={selected ? "lrow lrow--on" : "lrow"}
      tabIndex={active ? 0 : -1}
      data-roving-index={index}
      data-testid={`row-${index}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="lrow__name t-trunc" title={entry.fileName}>
        {entry.fileName}
      </span>
      <span className="t-meta">{L.kinds[entry.kind]}</span>
      <span className="t-label lrow__coll">{coll?.name ?? ""}</span>
      <span className="t-meta t-trunc">{entry.meta.tags.join(", ")}</span>
      <span className="t-data">{fmtRelative(entry.modifiedAt)}</span>
      <span className="t-data lrow__size">{fmtBytes(entry.size)}</span>
    </div>
  );
}

export function FilterChips({
  items,
  onRemove,
  onClear,
}: {
  items: { id: string; label: string }[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="chips" role="group" aria-label={L.filters.active} data-testid="filter-chips">
      {items.map((it) => (
        <span key={it.id} className="tag">
          {it.label}
          <button
            type="button"
            className="tag__x"
            aria-label={L.filters.removeFilter(it.label)}
            onClick={() => onRemove(it.id)}
          >
            <IconClose size={12} />
          </button>
        </span>
      ))}
      <Button variant="text" small onClick={onClear} data-testid="filters-clear">
        {L.filters.clear}
      </Button>
    </div>
  );
}

export function StatusScan({ done, total }: { done: string; total: string }) {
  return <Status kind="plain">{L.grid.scanning(done, total)}</Status>;
}
