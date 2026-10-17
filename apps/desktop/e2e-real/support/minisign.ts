/**
 * Testschlüssel und Signatur im minisign-Format, nur für die E2E-Suite (nie ein echter Schlüssel).
 * Format: https://jedisct1.github.io/minisign/#signature-format  (Algorithmus „ED“: Ed25519 über BLAKE2b-512 der Daten).
 * Die App prüft mit der Rust-Bibliothek `minisign-verify`; ob dieser Schreiber stimmt, entscheidet also die App selbst.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export interface TestKey {
  /** Inhalt der öffentlichen Schlüsseldatei (`.pub`) */
  publicKeyText: string;
  /** Signatur-Datei (`.minisig`) für `data` */
  signFile(data: Buffer, trustedComment?: string): string;
}

const SPKI_PREFIX_LENGTH = 12; // DER-Kopf eines Ed25519-Schlüssels vor den 32 Schlüsselbytes

export function createTestKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ type: "spki", format: "der" }).subarray(SPKI_PREFIX_LENGTH);
  const keyId = randomBytes(8);
  const publicKeyText =
    `untrusted comment: minisign public key: TESTSCHLUESSEL E2E\n` +
    `${Buffer.concat([Buffer.from("Ed"), keyId, rawPublic]).toString("base64")}\n`;

  return {
    publicKeyText,
    signFile(data, trustedComment = "timestamp:0\tfile:catalog.json\tE2E-Testsignatur") {
      const prehashed = createHash("blake2b512").update(data).digest();
      const signature = sign(null, prehashed, privateKey);
      const sigLine = Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64");
      const global = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey);
      return (
        `untrusted comment: signature from E2E test key\n${sigLine}\n` +
        `trusted comment: ${trustedComment}\n${global.toString("base64")}\n`
      );
    },
  };
}
