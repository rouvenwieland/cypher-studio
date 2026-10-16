import { describe, expect, it } from "vitest";
import { abortable, throwIfAborted } from "./abort";
import {
  abortError,
  isAbortError,
  isMockupEngineError,
  isMockupErrorCode,
  MockupEngineError,
  toEngineError,
} from "./errors";

describe("throwIfAborted", () => {
  it("wirft aborted nur bei ausgelöstem Signal", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrowError(expect.objectContaining({ code: "aborted" }) as Error);
  });
});

describe("abortable", () => {
  it("reicht Ergebnis und Fehler ohne Signal unverändert durch", async () => {
    await expect(abortable(Promise.resolve(5), undefined)).resolves.toBe(5);
    await expect(abortable(Promise.reject(new Error("x")), undefined)).rejects.toThrow("x");
  });

  it("liefert das Ergebnis, wenn das Signal nicht ausgelöst wird, und entfernt seinen Hörer", async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.resolve("ok"), controller.signal)).resolves.toBe("ok");
    controller.abort(); // nach Abschluss ohne Wirkung
  });

  it("lehnt sofort ab, wenn das Signal schon ausgelöst ist, und verschluckt das spätere Scheitern des Versprechens", async () => {
    const controller = new AbortController();
    controller.abort();
    const late = Promise.reject(new Error("später"));
    await expect(abortable(late, controller.signal)).rejects.toMatchObject({ code: "aborted" });
  });

  it("lehnt bei Abbruch während des Wartens ab, das Versprechen läuft unberührt weiter", async () => {
    const controller = new AbortController();
    let resolve: (value: number) => void = () => undefined;
    const slow = new Promise<number>((r) => {
      resolve = r;
    });
    const waiting = abortable(slow, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "aborted" });
    resolve(1);
    await expect(slow).resolves.toBe(1);
  });

  it("macht aus Fehlern ohne Error-Typ einen Error", async () => {
    const controller = new AbortController();
    // Bewusst kein Error-Objekt: prüft die Umwandlung fremder Ablehnungsgründe.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const nonError = Promise.reject("nur Text");
    await expect(abortable(nonError, controller.signal)).rejects.toThrow("nur Text");
  });
});

describe("errors", () => {
  it("MockupEngineError trägt Code und Ursache", () => {
    const cause = new Error("wurzel");
    const error = new MockupEngineError("invalid-input", "kaputt", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MockupEngineError");
    expect(error.code).toBe("invalid-input");
    expect(error.cause).toBe(cause);
    expect(isMockupEngineError(error)).toBe(true);
    expect(isMockupEngineError(new Error("x"))).toBe(false);
  });

  it("erkennt Abbrüche (eigene und DOM-AbortError)", () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new MockupEngineError("disposed", "x"))).toBe(false);
    const dom = new Error("The operation was aborted");
    dom.name = "AbortError";
    expect(isAbortError(dom)).toBe(true);
    expect(isAbortError("aborted")).toBe(false);
  });

  it("toEngineError behält vorhandene Fehler und wandelt fremde um", () => {
    const own = new MockupEngineError("no-variant", "x");
    expect(toEngineError(own, "worker-failed")).toBe(own);
    const dom = new Error("abgebrochen");
    dom.name = "AbortError";
    expect(toEngineError(dom, "worker-failed").code).toBe("aborted");
    const wrapped = toEngineError(new TypeError("typ"), "encode-failed");
    expect(wrapped.code).toBe("encode-failed");
    expect(wrapped.message).toBe("typ");
    expect(wrapped.cause).toBeInstanceOf(TypeError);
    expect(toEngineError("text", "worker-failed").message).toBe("text");
  });

  it("isMockupErrorCode prüft gegen die feste Liste", () => {
    expect(isMockupErrorCode("aborted")).toBe(true);
    expect(isMockupErrorCode("erfunden")).toBe(false);
    expect(isMockupErrorCode(3)).toBe(false);
  });
});
