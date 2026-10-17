import type { AppError, BusyReason, EntityKind, IoOp } from "@contract";
import { assertNever } from "../lib/assert";
import { fmtBytes } from "./format";

/**
 * Fehlertexte nach der Formel: Was ist passiert (title + text) · was ist sicher (safe) · was du tun kannst (Knöpfe im Aufrufer).
 * Jede `AppError.kind` ist abgedeckt – der Compiler (assertNever) und ein Test prüfen das.
 */
export interface ErrorMessage {
  title: string;
  text: string;
  safe: string;
}

const ENTITY: Record<EntityKind, string> = {
  program: "Das Programm",
  installation: "Die Installation",
  plan: "Die Vorschau",
  job: "Der Auftrag",
  fileHandle: "Die Datei",
  libraryEntry: "Der Bibliothekseintrag",
  project: "Das Projekt",
  template: "Die Vorlage",
  printProfile: "Das Druckprofil",
  setupScope: "Die Einrichtung",
  setupRecord: "Die Einrichtung",
  mockupTemplate: "Die Mockup-Vorlage",
  socialTemplate: "Die Social-Vorlage",
  garmentColor: "Die Textilfarbe",
  artifact: "Die Datei",
  catalogLink: "Der Verweis",
  setupPack: "Das Einrichtungspaket",
};

const IO_OP: Record<IoOp, string> = {
  read: "Lesen",
  write: "Schreiben",
  rename: "Umbenennen",
  remove: "Löschen",
  createDir: "Ordner anlegen",
  copy: "Kopieren",
  metadata: "Dateiinfo lesen",
  spawn: "Starten",
  mount: "Einbinden",
};

const BUSY: Record<BusyReason, string> = {
  jobRunning: "Dafür läuft gerade schon ein Auftrag. Warte, bis er fertig ist, oder brich ihn unter Aufträge ab.",
  setupRunning: "Eine Einrichtung läuft gerade. Warte, bis sie fertig ist.",
  updateRunning: "Ein Update läuft gerade. Warte, bis es fertig ist.",
  programRunning: "Das Programm ist noch geöffnet. Speichere und schließe es, dann geht es weiter.",
};

export function errorText(e: AppError): ErrorMessage {
  switch (e.kind) {
    case "notFound":
      return {
        title: "Eintrag nicht gefunden",
        text: `${ENTITY[e.entity]} gibt es nicht mehr. Die Ansicht war veraltet.`,
        safe: "Es wurde nichts verändert.",
      };
    case "invalidInput":
      return {
        title: "Eingabe nicht gültig",
        text: `Das Feld „${e.field}“ passt nicht: ${e.reason}`,
        safe: "Es wurde nichts verändert.",
      };
    case "planExpired":
      return {
        title: "Die Übersicht vor dem Laden ist abgelaufen",
        text: "Sie gilt nur 10 Minuten, damit Zustimmung und Datei zusammenpassen.",
        safe: "Es wurde nichts geladen.",
      };
    case "consentMismatch":
      return {
        title: "Zustimmung und Übersicht vor dem Laden passen nicht zusammen",
        text: "Die Angaben haben sich seit der Anzeige geändert.",
        safe: "Es wurde nichts geladen.",
      };
    case "busy":
      return {
        title: e.reason === "programRunning" ? "Das Programm ist noch geöffnet" : "Es läuft schon etwas",
        text: BUSY[e.reason],
        safe: "Es wurde nichts verändert.",
      };
    case "cancelled":
      return {
        title: "Abgebrochen",
        text: "Du hast den Vorgang abgebrochen.",
        safe: "Teildateien wurden gelöscht, installiert wurde nichts.",
      };
    case "io":
      return {
        title: "Datei oder Ordner nicht erreichbar",
        text: `${IO_OP[e.op]} ${e.path ? `bei ${e.path} ` : ""}ist fehlgeschlagen. ${e.message}`.trim(),
        safe: "Deine Dateien sind nicht betroffen.",
      };
    case "permissionDenied":
      return {
        title: "Keine Berechtigung",
        text: `Cypher Studio darf ${e.path} nicht verwenden.`,
        safe: "Deine Dateien sind nicht betroffen.",
      };
    case "diskFull":
      return {
        title: "Nicht genug Platz",
        text: `Auf ${e.path} fehlen ${fmtBytes(Math.max(0, e.neededBytes - e.availableBytes))}.`,
        safe: "Es wurde nichts geladen.",
      };
    case "network":
      return {
        title: "Keine Verbindung",
        text: e.message ? `Verbindung zu ${e.host} abgebrochen: ${e.message}` : `Verbindung zu ${e.host} abgebrochen.`,
        safe: e.retryable
          ? "Nichts ist installiert. Es geht von selbst weiter, sobald du online bist."
          : "Nichts ist installiert.",
      };
    case "httpStatus":
      return {
        title: "Server antwortet mit einem Fehler",
        text: `${e.host} meldet Status ${e.status}.`,
        safe: "Nichts ist installiert.",
      };
    case "hostNotAllowed":
      return {
        title: "Quelle nicht erlaubt",
        text: `${e.host} steht nicht in der Liste der erlaubten Quellen.`,
        safe: "Es wurde nichts geladen.",
      };
    case "insecureUrl":
      return {
        title: "Unsichere Adresse",
        text: "Cypher Studio lädt nur über HTTPS.",
        safe: "Es wurde nichts geladen.",
      };
    case "checksumMismatch":
      return {
        title: "Prüfsumme stimmt nicht",
        text: "Meist ist der Download unterwegs beschädigt worden.",
        safe: "Die Datei wurde verworfen. Es wurde nichts installiert und nichts ausgeführt.",
      };
    case "sizeMismatch":
      return {
        title: "Die geladene Datei hat die falsche Größe",
        text: `Erwartet ${fmtBytes(e.expected)}, geladen ${fmtBytes(e.actual)}.`,
        safe: "Wir haben sie gelöscht. Installiert wurde nichts.",
      };
    case "signatureInvalid":
      switch (e.subject) {
        case "catalog":
          return {
            title: "Der Katalog ist nicht signiert",
            text: "Er ist nicht mit dem Schlüssel des Kollektivs signiert und wurde verworfen.",
            safe: "Der bisherige Katalog bleibt in Gebrauch.",
          };
        case "artifact":
          return {
            title: "Die Signatur der Datei stimmt nicht",
            text: "Die geladene Datei passt nicht zur Signatur des Herstellers.",
            safe: "Wir haben sie gelöscht. Installiert wurde nichts.",
          };
        case "appUpdate":
          return {
            title: "Das Update ist nicht signiert",
            text: "Es ist nicht mit dem Schlüssel des Kollektivs signiert und wurde verworfen.",
            safe: "Cypher Studio bleibt auf der installierten Version.",
          };
        default:
          return assertNever(e.subject, "SignatureSubject");
      }
    case "catalogRollback":
      return {
        title: "Älterer Katalog abgelehnt",
        text: "Der angebotene Katalog ist älter als der bekannte und wurde verworfen.",
        safe: "Der bisherige Katalog bleibt in Gebrauch.",
      };
    case "catalogIncompatible":
      return {
        title: "Cypher Studio ist zu alt für den Katalog",
        text: `Der Katalog verlangt mindestens Version ${e.minAppVersion}.`,
        safe: "Installierte Programme laufen weiter.",
      };
    case "unsupportedPlatform":
      return {
        title: "Für dieses System nicht verfügbar",
        text: "Für dein Betriebssystem gibt es dieses Programm nicht als Download.",
        safe: "Es wurde nichts geladen.",
      };
    case "archiveInvalid":
      return {
        title: "Das Archiv ist beschädigt",
        text: e.reason,
        safe: "Wir haben es gelöscht. Installiert wurde nichts.",
      };
    case "archiveUnsafeEntry":
      return {
        title: "Das Archiv enthält Gefährliches",
        text: `Der Eintrag „${e.entry}“ würde außerhalb des Zielordners schreiben.`,
        safe: "Wir haben alles gelöscht. Installiert wurde nichts.",
      };
    case "archiveTooLarge":
      return {
        title: "Das Archiv ist zu groß",
        text: `Entpackt wäre es größer als ${fmtBytes(e.limitBytes)}.`,
        safe: "Wir haben alles gelöscht. Installiert wurde nichts.",
      };
    case "installVerificationFailed":
      return {
        title: "Die Installation sieht nicht richtig aus",
        text: e.reason,
        safe: "Wir haben alles gelöscht. Dein Rechner ist unverändert.",
      };
    case "launchFailed":
      return { title: "Das Programm startet nicht", text: e.reason, safe: "Die Installation ist unverändert." };
    case "setupConflict":
      return {
        title: "Einrichtung hat Konflikte",
        text: `${e.files.length} Datei${e.files.length === 1 ? "" : "en"} wurden von dir geändert.`,
        safe: "Cypher Studio überschreibt nichts ohne deine Wahl.",
      };
    case "setupUnsupported":
      return {
        title: "Einrichtung hier nicht möglich",
        text: {
          noPack: "Für dieses Programm gibt es kein Einrichtungspaket.",
          programVersion: "Diese Programmversion kennt das Paket nicht.",
          installKind: "Diese Installationsart lässt sich nicht einrichten.",
          platform: "Auf diesem Betriebssystem geht die Einrichtung nicht.",
        }[e.reason],
        safe: "Starten und Benutzen gehen trotzdem.",
      };
    case "imageDecode":
      return { title: "Die Datei lässt sich nicht öffnen", text: e.reason, safe: "Deine Datei ist unverändert." };
    case "imageTooLarge":
      return {
        title: "Das Bild ist zu groß",
        text: `${e.widthPx} × ${e.heightPx} px sind mehr als die erlaubten ${Math.round(e.maxPixels / 1_000_000)} Megapixel.`,
        safe: "Deine Datei ist unverändert.",
      };
    case "unsupportedFormat":
      return {
        title: "Dieses Format wird nicht unterstützt",
        text: `„${e.format.toUpperCase()}“ lässt sich nicht lesen. Unterstützt: ${e.supported.map((s) => s.toUpperCase()).join(", ")}.`,
        safe: "Deine Datei ist unverändert.",
      };
    case "libraryNotConfigured":
      return {
        title: "Noch kein gemeinsamer Ordner",
        text: "Wähle den Ordner, den ihr teilt.",
        safe: "Es wurde nichts verändert.",
      };
    case "libraryRootInvalid":
      return {
        title: "Dieser Ordner geht nicht",
        text: {
          notADirectory: "Das ist kein Ordner.",
          notWritable: "In diesen Ordner darf Cypher Studio nicht schreiben.",
          insideAppData: "Der Ordner liegt im Programmdatenordner von Cypher Studio.",
          systemDirectory: "Systemordner sind als gemeinsamer Ordner gesperrt.",
        }[e.reason],
        safe: "Dein bisheriger Ordner bleibt gewählt.",
      };
    case "packInvalid":
      return { title: "Das Austauschpaket ist beschädigt", text: e.reason, safe: "Es wurde nichts importiert." };
    case "updateFailed":
      return {
        title: "Das Update ist fehlgeschlagen",
        text: e.reason,
        safe: "Cypher Studio bleibt auf der installierten Version.",
      };
    case "internal":
      return {
        title: "Etwas ist schiefgelaufen",
        text: `${e.message} (Kennung ${e.correlationId})`,
        safe: "Deine Dateien sind nicht betroffen.",
      };
    default:
      return assertNever(e, "AppError");
  }
}

/** Sicherheitswarnung statt gewöhnlichem Fehler (ARCHITEKTUR 3.6). */
export function isSecurityError(e: AppError): boolean {
  switch (e.kind) {
    case "checksumMismatch":
    case "sizeMismatch":
    case "signatureInvalid":
    case "archiveInvalid":
    case "archiveUnsafeEntry":
    case "archiveTooLarge":
    case "hostNotAllowed":
    case "insecureUrl":
      return true;
    default:
      return false;
  }
}

/** Ist Wiederholen sinnvoll? */
export function isRetryable(e: AppError): boolean {
  if (e.kind === "network") return e.retryable;
  return e.kind === "httpStatus" || e.kind === "launchFailed" || e.kind === "updateFailed";
}
