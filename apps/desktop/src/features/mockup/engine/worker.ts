/**
 * Einstiegspunkt des Web Workers (Typ module, kein eval, kein Inline-Code).
 * Alles Inhaltliche steckt in `worker-core.ts` und `render2d.ts`.
 */
import { PlanExecutor } from "./render2d";
import type { WorkerResponse } from "./protocol";
import { createWorkerHandler } from "./worker-core";

/** Der Teil des Worker-Bereichs, den wir brauchen (`self` ist wegen der DOM-Typen als Window typisiert). */
interface WorkerScope {
  postMessage(message: WorkerResponse, options: { transfer: Transferable[] }): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = self as unknown as WorkerScope;

const handle = createWorkerHandler(
  {
    post(message, transfer) {
      scope.postMessage(message, { transfer });
    },
  },
  new PlanExecutor(),
);

scope.addEventListener("message", (event) => {
  handle(event.data);
});
