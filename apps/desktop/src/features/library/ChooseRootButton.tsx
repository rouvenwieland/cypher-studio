import { t } from "../../i18n/de";
import { Button } from "../../ui/Button";
import { useChooseRoot } from "./ChooseRoot";

/** Knopf „Ordner wählen“ mit dem gemeinsamen Dialog (Zusammenfassung vor der Bestätigung). */
export function ChooseRootButton({
  variant = "default",
  label,
}: {
  variant?: "default" | "primary" | "action";
  label?: string;
}) {
  const choose = useChooseRoot();
  return (
    <>
      <Button variant={variant} onClick={choose.start} disabled={choose.busy} data-testid="choose-folder">
        {label ?? t.library.chooseFolder}
      </Button>
      {choose.dialog}
    </>
  );
}
