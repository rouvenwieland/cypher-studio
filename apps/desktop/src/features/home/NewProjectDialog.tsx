import { useState } from "react";
import { useNavigate } from "react-router";
import { call } from "../../ipc/commands";
import { useCmd } from "../../ipc/queries";
import { toAppError } from "../../ipc/errors";
import { errorText } from "../../i18n/errors";
import { t } from "../../i18n/de";
import { useToasts } from "../../app/stores";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { SelectField, TextField } from "../../ui/Inputs";

const s = t.start.newProjectDialog;

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const status = useCmd("library_status", undefined);
  const push = useToasts((st) => st.push);
  const [name, setName] = useState("");
  const [collection, setCollection] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invalid = name.trim().length === 0 || name.trim().length > 80;

  const submit = () => {
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setProblem(null);
    call("project_create", { req: { name: name.trim(), ...(collection ? { collection } : {}) } })
      .then((p) => {
        push({ kind: "info", text: t.start.templates.popover.created(p.name) });
        setName("");
        setTouched(false);
        onClose();
        void navigate(`/bibliothek?projekt=${encodeURIComponent(p.id)}`);
      })
      .catch((e: unknown) => setProblem(errorText(toAppError(e)).text))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      title={s.title}
      onClose={onClose}
      testId="new-project-dialog"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
      footer={
        <>
          <Button onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="action" combo="mod+enter" onClick={submit} disabled={busy} data-testid="new-project-create">
            {s.create}
          </Button>
        </>
      }
    >
      <form
        className="stack stack--loose"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label={s.name} value={name} onChange={setName} placeholder={s.namePlaceholder} error={touched && invalid ? s.nameError : undefined} autoFocus maxLength={120} data-testid="new-project-name" />
        <SelectField
          label={s.collection}
          value={collection}
          onChange={setCollection}
          options={[{ value: "", label: s.collectionNone }, ...(status.data?.collections ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <p className="t-meta t-mute">{s.hint}</p>
        {problem ? (
          <p className="field__error t-meta" role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" className="sr-only" tabIndex={-1}>
          {s.create}
        </button>
      </form>
    </Dialog>
  );
}
