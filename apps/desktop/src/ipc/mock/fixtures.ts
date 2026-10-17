/**
 * Feste Beispieldaten des Mock-Modus (alles deutsch, realistisch, aber erfunden).
 * Versionen, Größen und Prüfsummen sind Beispielwerte wie in CONCEPT.md; echte Werte kommen aus dem signierten Manifest.
 */
import type {
  Brand,
  CatalogLink,
  Collection,
  GarmentColor,
  LicenseInfo,
  NetworkInfo,
  Palette,
  PrintProfile,
  ProgramCategory,
  ProgramId,
  Settings,
} from "@contract";

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

export const USER = "Lena";
export const PROGRAMS_DIR = `C:\\Users\\${USER}\\AppData\\Local\\de.cypherxcypher.studio\\data\\programs`;
export const LIBRARY_ROOT = "D:\\Sync\\Cypher";

export interface CatalogProgram {
  id: ProgramId;
  name: string;
  vendor: string;
  category: ProgramCategory;
  description: string;
  license: LicenseInfo;
  host: string;
  hostLabel: string;
  urlPath: (version: string) => string;
  fileName: (version: string) => string;
  /** Version, die der Katalog als neueste liefert */
  latest: string;
  channel: "stable" | "lts";
  releasedAt: string;
  downloadSize: number;
  unpackedSize: number;
  mirrorRedirects: boolean;
  pack: { packId: string; title: string; version: string };
}

export const CATALOG: readonly CatalogProgram[] = [
  {
    id: "krita",
    name: "Krita",
    vendor: "Stichting Krita Foundation",
    category: "raster",
    description: "Motive malen, Fotos bearbeiten, Druckdateien als PNG ausgeben.",
    license: {
      spdx: "GPL-3.0-or-later",
      name: "GNU General Public License v3.0 or later",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    host: "download.kde.org",
    hostLabel: "download.kde.org (offizielle Quelle)",
    urlPath: (v) => `/stable/krita/${v.split(".").slice(0, 3).join(".")}/krita-x64-${v}.zip`,
    fileName: (v) => `krita-x64-${v}.zip`,
    latest: "5.3.4.1",
    channel: "stable",
    releasedAt: "2026-10-02T09:00:00Z",
    downloadSize: 182 * MIB,
    unpackedSize: 540 * MIB,
    mirrorRedirects: true,
    pack: { packId: "krita", title: "Cypher-Einrichtung für Krita", version: "2026.10.0" },
  },
  {
    id: "inkscape",
    name: "Inkscape",
    vendor: "Inkscape-Projekt (Software Freedom Conservancy)",
    category: "vector",
    description: "Vektorgrafiken zeichnen und Druckvorlagen in Millimetern anlegen.",
    license: {
      spdx: "GPL-2.0-or-later",
      name: "GNU General Public License v2.0 or later",
      url: "https://www.gnu.org/licenses/gpl-2.0.html",
    },
    host: "inkscape.org",
    hostLabel: "inkscape.org (offizielle Quelle)",
    urlPath: (v) => `/gallery/item/inkscape-${v}-x64.7z`,
    fileName: (v) => `inkscape-${v}-x64.7z`,
    latest: "1.4.4",
    channel: "stable",
    releasedAt: "2026-09-21T09:00:00Z",
    downloadSize: 120 * MIB,
    unpackedSize: 410 * MIB,
    mirrorRedirects: false,
    pack: { packId: "inkscape", title: "Cypher-Einrichtung für Inkscape", version: "2026.10.0" },
  },
  {
    id: "blender",
    name: "Blender",
    vendor: "Blender Foundation",
    category: "3d",
    description: "3D-Szenen bauen und Mockup-Grundbilder rendern.",
    license: {
      spdx: "GPL-3.0-or-later",
      name: "GNU General Public License v3.0 or later",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    host: "download.blender.org",
    hostLabel: "download.blender.org (offizielle Quelle)",
    urlPath: (v) => `/release/Blender5.2/blender-${v}-windows-x64.zip`,
    fileName: (v) => `blender-${v}-windows-x64.zip`,
    latest: "5.2.2",
    channel: "stable",
    releasedAt: "2026-09-30T09:00:00Z",
    downloadSize: 380 * MIB,
    unpackedSize: 1_100 * MIB,
    mirrorRedirects: false,
    pack: { packId: "blender", title: "Cypher-Einrichtung für Blender", version: "2026.10.0" },
  },
  {
    id: "kdenlive",
    name: "Kdenlive",
    vendor: "KDE e. V.",
    category: "video",
    description: "Reels und Videos schneiden, Titel mit Cypher-Schriften setzen.",
    license: {
      spdx: "GPL-3.0-or-later",
      name: "GNU General Public License v3.0 or later",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    host: "download.kde.org",
    hostLabel: "download.kde.org (offizielle Quelle)",
    urlPath: (v) => `/stable/kdenlive/${v.slice(0, 5)}/windows/kdenlive-${v}.exe`,
    fileName: (v) => `kdenlive-${v}.exe`,
    latest: "26.08.2",
    channel: "stable",
    releasedAt: "2026-10-08T09:00:00Z",
    downloadSize: 140 * MIB,
    unpackedSize: 480 * MIB,
    mirrorRedirects: true,
    pack: { packId: "kdenlive", title: "Cypher-Einrichtung für Kdenlive", version: "2026.10.0" },
  },
];

export const LINKS: CatalogLink[] = [
  {
    id: "affinity",
    name: "Affinity",
    description: "Kostenloses Grafikprogramm eines kommerziellen Herstellers.",
    note: "Nicht quelloffen; nur Verweis, keine Installation durch Cypher Studio.",
  },
];

export const COLLECTIONS: Collection[] = [
  { id: "rauschen", name: "Rauschen", hex: "#e4f531" },
  { id: "mittelwelle", name: "Mittelwelle", hex: "#1f2bd0" },
  { id: "gold-lounge", name: "Gold-Lounge", hex: "#c9a03f" },
];

export const GARMENTS: GarmentColor[] = [
  {
    id: "schwarz",
    name: "Schwarz",
    hex: "#141210",
    textileHex: "#161412",
    providerColorName: "Black",
    heather: false,
    underbase: true,
    textOnGarment: "#efeee9",
  },
  {
    id: "weiss",
    name: "Weiß",
    hex: "#f2efe8",
    textileHex: "#f4f1ea",
    providerColorName: "White",
    heather: false,
    underbase: false,
    textOnGarment: "#0d0d0d",
  },
  {
    id: "grau-meliert",
    name: "Grau meliert",
    hex: "#8c8a86",
    textileHex: "#8f8d89",
    providerColorName: "Heather Grey",
    heather: true,
    underbase: true,
    textOnGarment: "#0d0d0d",
  },
  {
    id: "navy",
    name: "Navy",
    hex: "#1d2738",
    textileHex: "#1f2a3d",
    providerColorName: "French Navy",
    heather: false,
    underbase: true,
    textOnGarment: "#efeee9",
  },
  {
    id: "sand",
    name: "Sand",
    hex: "#cdbb9a",
    textileHex: "#cfbd9d",
    providerColorName: "Sand",
    heather: false,
    underbase: true,
    textOnGarment: "#0d0d0d",
  },
  {
    id: "creme",
    name: "Creme",
    hex: "#efe4cc",
    textileHex: "#f0e6cf",
    providerColorName: "Natural",
    heather: false,
    underbase: false,
    textOnGarment: "#0d0d0d",
  },
];

export const PALETTES: Palette[] = [
  {
    id: "cypher-motiv",
    name: "Cypher Kollektionen",
    colors: [
      { name: "Tinte", hex: "#0d0d0d" },
      { name: "Papier", hex: "#efeee9" },
      { name: "News", hex: "#ff4f12" },
      { name: "Shop", hex: "#e4f531" },
      { name: "Studio", hex: "#00d4d8" },
      { name: "Rauschen", hex: "#0b0b0a" },
      { name: "Mittelwelle Blau", hex: "#1f2bd0" },
      { name: "Mittelwelle Weiß", hex: "#f3f4f7" },
      { name: "Gold-Lounge Gold", hex: "#c9a03f" },
      { name: "Gold-Lounge Dunkel", hex: "#a47c2a" },
      { name: "Gold-Lounge Schwarz", hex: "#0d0a05" },
      { name: "Textil Schwarz", hex: "#141210" },
      { name: "Textil Weiß", hex: "#f2efe8" },
      { name: "Textil Grau meliert", hex: "#8c8a86" },
      { name: "Textil Navy", hex: "#1d2738" },
      { name: "Textil Sand", hex: "#cdbb9a" },
      { name: "Textil Creme", hex: "#efe4cc" },
    ],
  },
];

export function brandFixture(): Brand {
  return {
    collections: COLLECTIONS,
    garmentColors: GARMENTS,
    palettes: PALETTES,
    fonts: [],
    logos: [],
  };
}

const PROFILE_BASE = {
  provider: "shirtigo" as const,
  targetDpi: 300,
  errorBelowDpi: 150,
  minPxPerSide: 1000,
  maxPxPerSide: 10500,
  warnFileBytes: 48 * MIB,
  maxFileBytes: 64 * MIB,
  acceptedUploadFormats: ["png", "jpeg"] as ("png" | "jpeg")[],
  color: { exportProfile: "adobeRgb" as const, acceptedProfiles: ["adobeRgb", "srgb"] as ("adobeRgb" | "srgb")[] },
  alpha: {
    semiMin: 13,
    semiMax: 252,
    ghostMax: 12,
    edgeRadiusPx: 2,
    warnShare: 0.001,
    errorShare: 0.01,
    severityOnLightGarment: "info" as const,
    severityForDtf: "error" as const,
  },
  strokes: { warnBelowPx: 10, criticalBelowPx: 5 },
  topMarginHintMm: 80,
  source: { urls: ["https://help.shirtigo.de/"], checkedAt: "2026-10-16T08:00:00Z" },
};

export const PRINT_PROFILES: PrintProfile[] = [
  {
    ...PROFILE_BASE,
    id: "shirtigo-tee-front",
    product: { id: "tee", providerProductId: "organic-shirt", label: "Unisex-Shirt (Creator 2.0)" },
    placement: "front",
    techniques: ["dtg", "dtf"],
    title: "Unisex-Shirt · vorne",
    printAreaMm: { width: 330, height: 450 },
    safeAreaMm: { width: 280, height: 360 },
    widthPresets: [
      { id: "chestCentered", label: "Brust zentriert", widthMm: 280, maxWidthMm: null },
      { id: "chestEmblem", label: "Brust links", widthMm: 90, maxWidthMm: 150 },
    ],
    defaultWidthMm: 280,
    assumption: false,
  },
  {
    ...PROFILE_BASE,
    id: "shirtigo-hoodie-front",
    product: { id: "hoodie", providerProductId: "cruiser-hoodie", label: "Hoodie (Cruiser 2.0)" },
    placement: "front",
    techniques: ["dtg", "dtf"],
    title: "Hoodie · vorne",
    printAreaMm: { width: 330, height: 280 },
    safeAreaMm: { width: 280, height: 240 },
    widthPresets: [
      { id: "chestCentered", label: "Brust zentriert", widthMm: 280, maxWidthMm: null },
      { id: "chestEmblem", label: "Brust links", widthMm: 90, maxWidthMm: 150 },
    ],
    defaultWidthMm: 280,
    assumption: true,
  },
  {
    ...PROFILE_BASE,
    id: "shirtigo-tee-back",
    product: { id: "tee", providerProductId: "organic-shirt", label: "Unisex-Shirt (Creator 2.0)" },
    placement: "back",
    techniques: ["dtg", "dtf"],
    title: "Unisex-Shirt · hinten",
    printAreaMm: { width: 330, height: 450 },
    safeAreaMm: null,
    widthPresets: [{ id: "backShoulder", label: "Rücken Schulterhöhe", widthMm: 300, maxWidthMm: 330 }],
    defaultWidthMm: 300,
    assumption: false,
  },
  {
    ...PROFILE_BASE,
    id: "shirtigo-hoodie-back",
    product: { id: "hoodie", providerProductId: "cruiser-hoodie", label: "Hoodie (Cruiser 2.0)" },
    placement: "back",
    techniques: ["dtg", "dtf"],
    title: "Hoodie · hinten",
    printAreaMm: { width: 330, height: 390 },
    safeAreaMm: null,
    widthPresets: [{ id: "backShoulder", label: "Rücken Schulterhöhe", widthMm: 300, maxWidthMm: 330 }],
    defaultWidthMm: 300,
    assumption: true,
  },
];

export function networkFixture(): NetworkInfo {
  return {
    endpoints: [
      {
        purpose: "catalog",
        host: "studio.cypherxcypher.de",
        urlPattern: "https://studio.cypherxcypher.de/catalog/v1/catalog.json",
        when: "onStart",
        enabled: true,
      },
      {
        purpose: "appUpdate",
        host: "studio.cypherxcypher.de",
        urlPattern: "https://studio.cypherxcypher.de/releases/latest.json",
        when: "onStart",
        enabled: true,
      },
      {
        purpose: "appUpdate",
        host: "github.com",
        urlPattern: "https://github.com/cypher-kollektiv/cypher-studio/releases/latest/download/latest.json",
        when: "onDemand",
        enabled: true,
      },
      {
        purpose: "programDownload",
        host: "download.kde.org",
        urlPattern: "https://download.kde.org/stable/krita/…",
        when: "afterConsent",
        enabled: true,
      },
      {
        purpose: "programDownload",
        host: "inkscape.org",
        urlPattern: "https://inkscape.org/gallery/item/…",
        when: "afterConsent",
        enabled: true,
      },
      {
        purpose: "programDownload",
        host: "download.blender.org",
        urlPattern: "https://download.blender.org/release/…",
        when: "afterConsent",
        enabled: true,
      },
      {
        purpose: "modelDownload",
        host: "huggingface.co",
        urlPattern: "https://huggingface.co/…/isnet-general-use.onnx",
        when: "afterConsent",
        enabled: true,
      },
    ],
    recent: [
      { at: "2026-10-16T10:10:04Z", host: "studio.cypherxcypher.de", purpose: "catalog", status: 200, bytes: 48_211 },
      { at: "2026-10-16T10:10:05Z", host: "studio.cypherxcypher.de", purpose: "appUpdate", status: 200, bytes: 1_204 },
      {
        at: "2026-10-15T08:41:12Z",
        host: "download.kde.org",
        purpose: "programDownload",
        status: 200,
        bytes: 190_840_832,
      },
      { at: "2026-10-15T08:39:50Z", host: "studio.cypherxcypher.de", purpose: "catalog", status: 200, bytes: 48_211 },
    ],
    telemetry: false,
  };
}

export function defaultSettings(nowIso: string): Settings {
  return {
    schemaVersion: 1,
    updates: { frequency: "weekly", lastCheckAt: nowIso },
    catalog: { autoRefresh: true },
    programsDir: PROGRAMS_DIR,
    projectsDir: `${LIBRARY_ROOT}\\Projekte`,
    libraryRoot: LIBRARY_ROOT,
    downloads: { keepCache: false, maxParallel: 2 },
    linux: { appImageMode: "auto", graphicsCompat: false },
    profile: { displayName: USER },
    ui: {
      theme: "system",
      density: "normal",
      motion: "system",
      zoomPercent: 100,
      measureColor: "cyan",
      surround: { paper: "light", ink: "dark" },
      calibrationPxPerMm: null,
      singleKeyShortcuts: true,
      shortcutOverrides: {},
    },
    onboarding: {
      status: "done",
      step: 6,
      selectedPrograms: ["krita", "inkscape"],
      applySetup: true,
      updatedAt: nowIso,
    },
  };
}
export { fakeSha256 as fakeSha } from "./rng";
