import type { SetupEvent } from "@contract";
import { call } from "../../ipc/commands";
import { channel } from "../../ipc/channel";
import { watchJobBriefly } from "../../app/stores";

/**
 * Nach der Installation: Einrichtungsvorschau holen und, wenn es keine Konflikte gibt, die vorgewählten Bausteine anwenden.
 * Konflikte entscheidet immer der Mensch (Programm-Detail → Einrichtung): Cypher Studio überschreibt nichts still.
 */
export async function applyDefaultSetup(programId: string, installationId: string): Promise<{ count: number; needsYou: boolean }> {
  const view = await call("programs_list");
  const program = view.programs.find((p) => p.id === programId);
  const summary = program?.setup;
  const scope = summary?.scopes.find((s) => s.installationIds.includes(installationId));
  if (!summary || !scope) return { count: 0, needsYou: false };
  const plan = await call("setup_preview", { req: { packId: summary.packId, scopeId: scope.scopeId } });
  if (plan.conflicts.length > 0) return { count: 0, needsYou: true };
  const components = plan.components.filter((c) => c.defaultSelected).map((c) => c.id);
  const record = await call("setup_apply", {
    req: { planId: plan.planId, components, resolutions: {} },
    onEvent: channel<SetupEvent>((e) => {
      if (e.type === "started") watchJobBriefly(e.jobId);
    }),
  });
  return { count: record.components.length, needsYou: false };
}
