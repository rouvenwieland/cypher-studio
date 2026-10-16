import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LibraryEntry, LibraryEntryStatus } from "@contract";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { fmtCount } from "../../i18n/format";
import { t } from "../../i18n/de";
import { useDrops, useJobs, useToasts } from "../../app/stores";
import { useEffectiveTheme, useSettings } from "../../app/theme";
import { useDebounced } from "../../lib/useDebounced";
import { useElementSize } from "../../lib/useElementSize";
import { Notice, EmptyState } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Bench } from "../../ui/Frames";
import { Segmented, SelectField } from "../../ui/Inputs";
import { IconGrid, IconList, IconSearch, IconNext, IconBack } from "../../ui/icons";
import { ActionMenu } from "../../ui/Overlays";
import { useInstallUi } from "../install/store";
import { ChooseRootButton } from "./ChooseRootButton";
import { Cell, EntryInspector, FilterChips, Filters, ListRow, Skeleton, Thumb, KIND_ORDER } from "./LibraryParts";
import { PAGE_SIZE, useLibraryPages, type LibraryFilters } from "./useLibraryPages";
import "./library.css";

const L = t.library;
const GAP = 16;

function useThumb(): number {
  const settings = useSettings();
  const d = settings.data?.ui.density ?? "normal";
  return d === "compact" ? 128 : d === "large" ? 200 : 160;
}

export default function Library() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const push = useToasts((s) => s.push);
  const openInstall = useInstallUi((s) => s.open);
  const settings = useSettings();
  const status = useCmd("library_status", undefined);
  const projects = useCmd("projects_list", undefined, { retry: false });
  const programs = useCmd("programs_list", undefined, { staleTime: 30_000 });
  const scanJob = useJobs((s) => s.active.find((j) => j.kind === "libraryScan"));
  const theme = useEffectiveTheme(settings.data?.ui);

  const [filters, setFilters] = useState<LibraryFilters>({ sort: "modifiedDesc" });
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 200);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState(0);
  const [active, setActive] = useState(0);
  const [quick, setQuick] = useState<number | null>(null);
  const [tagsDialog, setTagsDialog] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const size = useElementSize(scroller);
  const thumb = useThumb();

  const projectId = params.get("projekt");
  const effective: LibraryFilters = useMemo(() => ({ ...filters, ...(debounced.trim() ? { text: debounced.trim() } : {}), ...(projectId ? { projectId } : {}) }), [filters, debounced, projectId]);

  const columns = view === "list" ? 1 : Math.max(1, Math.floor((size.width - 2 * GAP + GAP) / (thumb + GAP)));
  const imgH = Math.round(thumb * 0.75);
  const rowH = view === "list" ? 36 : imgH + 76;
  const [visiblePages, setVisiblePages] = useState<number[]>([0]);
  const data = useLibraryPages(effective, visiblePages);
  const rowCount = Math.ceil(data.total / columns);
  const virt = useVirtualizer({ count: rowCount, getScrollElement: () => scroller.current, estimateSize: () => rowH, overscan: 4, gap: view === "list" ? 0 : GAP, paddingStart: GAP, paddingEnd: GAP });
  const items = virt.getVirtualItems();
  const firstIndex = (items[0]?.index ?? 0) * columns;
  const lastIndex = Math.min(data.total - 1, ((items[items.length - 1]?.index ?? 0) + 1) * columns - 1);
  const pagesKey = `${Math.floor(firstIndex / PAGE_SIZE)}-${Math.floor(Math.max(firstIndex, lastIndex) / PAGE_SIZE)}`;
  useEffect(() => {
    const [a, b] = pagesKey.split("-").map(Number);
    const next: number[] = [];
    for (let p = a ?? 0; p <= (b ?? 0); p++) next.push(p);
    setVisiblePages((cur) => (cur.length === next.length && cur.every((v, i) => v === next[i]) ? cur : next));
  }, [pagesKey]);

  // Filter oder Suche wechseln: Auswahl und Position zurücksetzen
  useEffect(() => {
    setSelected(new Set());
    setActive(0);
    scroller.current?.scrollTo({ top: 0 });
  }, [effective]);

  const entryAt = (i: number) => data.at(i);
  const selectedEntries = data.loaded().filter((e) => selected.has(e.id));
  const single = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
  const collections = status.data?.collections ?? [];

  // Suche per Strg+F
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (index: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const entry = entryAt(index);
    if (!entry) return;
    setActive(index);
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
      const next = new Set(selected);
      for (let i = a; i <= b; i++) {
        const en = entryAt(i);
        if (en) next.add(en.id);
      }
      setSelected(next);
      return;
    }
    setAnchor(index);
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      setSelected(next);
    } else {
      setSelected(new Set([entry.id]));
    }
  };

  const handleOf = async (entry: LibraryEntry) => call("library_entry_handle", { req: { entryId: entry.id } });
  const toModule = (entry: LibraryEntry, path: string) => {
    void handleOf(entry)
      .then((h) => {
        useDrops.getState().push([h]);
        void navigate(path);
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).title }));
  };
  const open = (entry: LibraryEntry) => {
    const pid = entry.openWith;
    if (!pid) {
      void call("app_reveal", { req: { target: { kind: "libraryEntry", entryId: entry.id } } });
      return;
    }
    const prog = programs.data?.programs.find((p) => p.id === pid);
    if (prog && prog.installations.length === 0) {
      openInstall({ programId: pid });
      return;
    }
    void handleOf(entry)
      .then((h) => call("program_launch", { req: { programId: pid, files: [h.id] } }))
      .then(() => push({ kind: "info", text: t.programs.launchedToast(prog?.name ?? pid) }))
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }));
  };
  const patch = (entry: LibraryEntry, p: Parameters<typeof call<"library_update_meta">>[1]["req"]["patch"]) => {
    void call("library_update_meta", { req: { entryId: entry.id, patch: p } })
      .then(() => qc.invalidateQueries({ queryKey: ["library_query"] }))
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }));
  };
  const bulk = (req: { addTags?: string[]; collection?: string | null }) => {
    const ids = selectedEntries.map((e) => e.id);
    void call("library_bulk_meta", { req: { entryIds: ids, ...req } })
      .then((n) => {
        push({ kind: "info", text: L.multi.applied(n) });
        void qc.invalidateQueries({ queryKey: ["library_query"] });
      })
      .catch((e: unknown) => push({ kind: "error", text: errorText(toAppError(e)).text }));
  };

  const onGridKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    const move = (to: number) => {
      const i = Math.max(0, Math.min(data.total - 1, to));
      e.preventDefault();
      setActive(i);
      virt.scrollToIndex(Math.floor(i / columns), { align: "auto" });
      if (e.shiftKey) select(i, { ctrlKey: false, metaKey: false, shiftKey: true });
      else if (!mod) {
        const en = entryAt(i);
        if (en) {
          setAnchor(i);
          setSelected(new Set([en.id]));
        }
      }
      const focusLater = (n: number) => {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-roving-index="${i}"]`);
        if (el) el.focus();
        else if (n > 0) requestAnimationFrame(() => focusLater(n - 1));
      };
      requestAnimationFrame(() => focusLater(8));
    };
    switch (e.key) {
      case "ArrowRight":
        move(active + 1);
        break;
      case "ArrowLeft":
        move(active - 1);
        break;
      case "ArrowDown":
        move(active + columns);
        break;
      case "ArrowUp":
        move(active - columns);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(data.total - 1);
        break;
      case " ":
        e.preventDefault();
        if (entryAt(active)) setQuick(active);
        break;
      case "Enter": {
        const en = entryAt(active);
        if (en && !mod) {
          e.preventDefault();
          open(en);
        } else if (en && mod) {
          e.preventDefault();
          open(en);
        }
        break;
      }
      case "a":
      case "A":
        if (mod) {
          e.preventDefault();
          setSelected(new Set(data.loaded().map((en) => en.id)));
        }
        break;
      case "Escape":
        if (selected.size > 0) {
          e.preventDefault();
          setSelected(new Set());
        }
        break;
      case "t":
      case "T":
        if (!mod) {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('[data-testid="tag-input"]')?.focus();
        }
        break;
      default:
        break;
    }
  };

  const chips = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    for (const k of filters.kinds ?? []) out.push({ id: `k:${k}`, label: L.kinds[k] });
    for (const c of filters.collections ?? []) out.push({ id: `c:${c}`, label: collections.find((x) => x.id === c)?.name ?? c });
    for (const tg of filters.tags ?? []) out.push({ id: `t:${tg}`, label: tg });
    if (filters.modifiedAfter) out.push({ id: "mod", label: L.filters.period });
    if (filters.onlyConflicts) out.push({ id: "conf", label: L.filters.conflicts });
    if (projectId) out.push({ id: "proj", label: projects.data?.find((p) => p.id === projectId)?.name ?? projectId });
    return out;
  }, [filters, collections, projectId, projects.data]);
  const removeChip = (id: string) => {
    const [kind, value] = id.split(":");
    setFilters((f) => {
      const next = { ...f };
      if (kind === "k") {
        const rest = (f.kinds ?? []).filter((x) => x !== value);
        if (rest.length) next.kinds = rest;
        else delete next.kinds;
      } else if (kind === "c") {
        const rest = (f.collections ?? []).filter((x) => x !== value);
        if (rest.length) next.collections = rest;
        else delete next.collections;
      } else if (kind === "t") {
        const rest = (f.tags ?? []).filter((x) => x !== value);
        if (rest.length) next.tags = rest;
        else delete next.tags;
      } else if (id === "mod") delete next.modifiedAfter;
      else if (id === "conf") delete next.onlyConflicts;
      return next;
    });
    if (id === "proj") setParams({}, { replace: true });
  };
  const clearAll = () => {
    setFilters({ sort: filters.sort ?? "modifiedDesc" });
    setSearch("");
    setParams({}, { replace: true });
  };
  const hasFilters = chips.length > 0 || search.trim().length > 0;

  const configured = status.data?.configured ?? true;
  const total = status.data?.entryCount ?? 0;
  const scanText = scanJob ? L.grid.scanning(fmtCount(Math.round((scanJob.progress ?? 0) * total)), fmtCount(total)) : null;
  const surroundAttr = (settings.data?.ui.surround[theme === "ink" ? "ink" : "paper"] ?? (theme === "ink" ? "dark" : "light")) === "light" ? "hell" : (settings.data?.ui.surround[theme === "ink" ? "ink" : "paper"] ?? "dark") === "mid" ? "mittel" : "dunkel";

  const tools = (
    <>
      <div className="lib-search">
        <IconSearch size={16} />
        <input ref={searchRef} className="lib-search__input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L.searchPlaceholder(fmtCount(total))} aria-label={L.searchLabel} data-testid="library-search" />
      </div>
      <Segmented
        label={L.view.label}
        value={view}
        onChange={(v) => {
          setView(v);
          scroller.current?.scrollTo({ top: 0 });
        }}
        options={[
          { value: "grid", label: L.view.grid },
          { value: "list", label: L.view.list },
        ]}
      />
      <SelectField label={L.sort.label} hideLabel value={filters.sort ?? "modifiedDesc"} onChange={(v) => setFilters((f) => ({ ...f, sort: v as NonNullable<LibraryFilters["sort"]> }))} options={(["modifiedDesc", "nameAsc", "kind", "sizeDesc"] as const).map((s) => ({ value: s, label: L.sort[s] }))} />
    </>
  );
  void IconGrid;
  void IconList;

  // Leer: kein Ordner
  if (status.data && !configured) {
    return (
      <Bench title={L.title} testId="screen-library" surround={surroundAttr} preview={<div className="lib-empty"><EmptyState title={L.empty.noFolder.title} testId="library-empty" actions={<ChooseRootButton variant="action" />}>{L.empty.noFolder.text}</EmptyState></div>} inspector={<p className="section t-meta t-mute">{L.inspector.empty}</p>} inspectorTitle={L.inspector.title} />
    );
  }

  const multi = selectedEntries.length > 1;
  const bar = multi ? (
    <div className="outbar multibar" role="region" aria-label={L.grid.selectedCount(selectedEntries.length)} data-testid="multibar" data-region="output" tabIndex={-1}>
      <span className="t-section">{L.grid.selectedCount(selectedEntries.length)}</span>
      <span className="spacer" />
      <Button onClick={() => setTagsDialog(true)} data-testid="bulk-tags">
        {L.multi.setTags}
      </Button>
      <ActionMenu
        label={L.multi.collection}
        entries={[
          ...collections.map((c) => ({ id: c.id, label: c.name, onSelect: () => bulk({ collection: c.id }) })),
          { id: "none", label: L.multi.noCollection, onSelect: () => bulk({ collection: null }), separatorBefore: true },
        ]}
      />
      <Button onClick={() => selectedEntries[0] && toModule(selectedEntries[0], "/druck")}>{L.multi.checkPrint}</Button>
      <Button onClick={() => selectedEntries[0] && void call("app_reveal", { req: { target: { kind: "libraryEntry", entryId: selectedEntries[0].id } } })}>{L.multi.reveal}</Button>
      <Button variant="text" onClick={() => setSelected(new Set())}>
        {L.multi.clear}
      </Button>
    </div>
  ) : undefined;

  const showError = data.error !== null;
  const noMatch = !data.isPending && !showError && data.total === 0 && hasFilters;

  const grid = (
    <div className="lib">
      <Filters facets={data.facets} collections={collections} filters={filters} onChange={setFilters} />
      <div className="lib__main">
        <div className="lib__bar">
          <span className="t-data" data-testid="library-count" aria-live="polite">
            {L.grid.count(fmtCount(data.total), fmtCount(total || data.total))}
            {scanText ? <span className="t-mute"> · {scanText}</span> : null}
          </span>
          <FilterChips items={chips} onRemove={removeChip} onClear={clearAll} />
        </div>
        {showError ? (
          <div className="lib-empty">
            <Notice kind="error" title={L.empty.folderLost(status.data?.root ?? "")} actions={<><Button onClick={() => void qc.invalidateQueries({ queryKey: ["library_query"] })}>{L.empty.retry}</Button><ChooseRootButton label={L.empty.other} /></>} testId="library-error">
              {data.error ? errorText(data.error).safe : ""}
            </Notice>
          </div>
        ) : noMatch ? (
          <div className="lib-empty">
            <EmptyState testId="library-nomatch" actions={<Button onClick={clearAll}>{L.empty.clearFilters}</Button>}>
              {L.empty.noMatch(chips.map((c) => `‚${c.label}‘`).concat(search.trim() ? [`‚${search.trim()}‘`] : []).join(" + "))}
            </EmptyState>
          </div>
        ) : (
          <div
            ref={scroller}
            className="lib__scroll"
            role="listbox"
            aria-multiselectable="true"
            aria-label={L.grid.label}
            aria-busy={data.isFetching}
            onKeyDown={onGridKey}
            data-testid="library-grid"
            tabIndex={-1}
            onFocus={(e) => {
              if (e.target === e.currentTarget) {
                const el = e.currentTarget.querySelector<HTMLElement>(`[data-roving-index="${active}"]`) ?? e.currentTarget.querySelector<HTMLElement>("[data-roving-index]");
                el?.focus();
              }
            }}
          >
            <div className="lib__space" style={{ height: virt.getTotalSize() }}>
              {items.map((row) => (
                <div key={row.key} className={view === "list" ? "lib__row lib__row--list" : "lib__row"} style={{ transform: `translateY(${row.start}px)`, height: row.size, ...(view === "grid" ? { ["--cols" as string]: columns, ["--thumb-w" as string]: `${thumb}px`, ["--img-h" as string]: `${imgH}px` } : {}) }}>
                  {Array.from({ length: columns }, (_, c) => {
                    const index = row.index * columns + c;
                    if (index >= data.total) return null;
                    const entry = entryAt(index);
                    if (!entry) return view === "grid" ? <Skeleton key={index} /> : <div key={index} className="lrow lrow--skel" aria-hidden="true" />;
                    const isSel = selected.has(entry.id);
                    const onClick = (e: MouseEvent) => select(index, e);
                    return view === "grid" ? (
                      <Cell key={entry.id} entry={entry} selected={isSel} active={index === active} index={index} onClick={onClick} onDoubleClick={() => open(entry)} />
                    ) : (
                      <ListRow key={entry.id} entry={entry} selected={isSel} active={index === active} index={index} collections={collections} onClick={onClick} onDoubleClick={() => open(entry)} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Bench
        title={L.title}
        testId="screen-library"
        surround={surroundAttr}
        context={status.data?.root ?? null}
        tools={tools}
        previewLabel={L.grid.label}
        preview={grid}
        inspectorTitle={L.inspector.title}
        inspector={
          single ? (
            <EntryInspector
              entry={single}
              collections={collections}
              programName={single.openWith ? (programs.data?.programs.find((p) => p.id === single.openWith)?.name ?? null) : null}
              onOpen={() => open(single)}
              onToPrint={() => toModule(single, "/druck")}
              onToMockup={() => toModule(single, "/mockups")}
              onToCutout={() => toModule(single, "/freistellen")}
              onReveal={() => void call("app_reveal", { req: { target: { kind: "libraryEntry", entryId: single.id } } })}
              onTags={(tags) => patch(single, { tags })}
              onStatus={(s: LibraryEntryStatus) => patch(single, { status: s })}
              onCollection={(id) => patch(single, { collection: id })}
            />
          ) : (
            <p className="section t-meta t-mute" data-testid="inspector-empty">
              {multi ? L.grid.selectedCount(selectedEntries.length) : L.inspector.empty}
            </p>
          )
        }
        output={bar}
      />
      <Dialog
        open={quick !== null}
        title={quick !== null ? (entryAt(quick)?.fileName ?? L.quick.title) : L.quick.title}
        onClose={() => setQuick(null)}
        wide
        testId="quick-view"
        onKeyDown={(e) => {
          if (quick === null) return;
          if (e.key === "ArrowRight") setQuick(Math.min(data.total - 1, quick + 1));
          if (e.key === "ArrowLeft") setQuick(Math.max(0, quick - 1));
        }}
        footer={
          <>
            <IconButton icon={IconBack} label={L.quick.previous} onClick={() => quick !== null && setQuick(Math.max(0, quick - 1))} />
            <IconButton icon={IconNext} label={L.quick.next} onClick={() => quick !== null && setQuick(Math.min(data.total - 1, quick + 1))} />
            <Button onClick={() => setQuick(null)}>{L.quick.close}</Button>
          </>
        }
      >
        {quick !== null && entryAt(quick) ? (
          <div className="quick">
            <Thumb entry={entryAt(quick) as LibraryEntry} className="quick__img" />
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={tagsDialog}
        title={L.multi.tagsTitle}
        onClose={() => setTagsDialog(false)}
        testId="bulk-tags-dialog"
        footer={
          <>
            <Button onClick={() => setTagsDialog(false)}>{t.common.cancel}</Button>
            <Button
              variant="action"
              combo="mod+enter"
              onClick={() => {
                const tags = bulkText.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
                if (tags.length) bulk({ addTags: tags });
                setBulkText("");
                setTagsDialog(false);
              }}
              data-testid="bulk-tags-apply"
            >
              {L.multi.addTag}
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="t-meta">{L.multi.tagsHelp}</p>
          <input className="input" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={L.multi.addTagPlaceholder} aria-label={L.multi.addTagPlaceholder} autoFocus />
        </div>
      </Dialog>
    </>
  );
}

void KIND_ORDER;
void useCallback;
