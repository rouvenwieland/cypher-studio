/**
 * Öffentliche API der Social-Layout-Engine. Ablauf in der UI:
 * 1. `fontsOfTemplate` + `ensureFonts`, Bilder über `loadResources` laden;
 * 2. `layoutSocial` (rein) → Zeichenliste und Warnungen, `collectResourceUrls` nennt nachzuladende Adressen;
 * 3. `drawSocial` für die Vorschau, `renderSocialToBlob` für den Export;
 * 4. `zoneChips` für die Messspur der Sicherheitszonen.
 */
export {
  applyTextStyle,
  canvasMeasure,
  createFontProbe,
  createScratchContext,
  fontShorthand,
  type Canvas2D,
  type FontSpec,
} from "./canvas-text";
export {
  AA_LARGE,
  AA_NORMAL,
  blendOver,
  contrastRatio,
  fillColors,
  meetsAA,
  parseHexColor,
  relativeLuminance,
  worstContrast,
  type Rgb,
  type Rgba,
} from "./contrast";
export { drawSocial, pathRoundedRect, type BitmapMap } from "./draw";
export {
  applyGrain,
  clampRadius,
  gradientLine,
  mulberry32,
  scanlineRows,
  scanlineThickness,
  type GradientLine,
} from "./draw-math";
export {
  centerFocal,
  checkResolution,
  denormalizeFocal,
  focalToCrop,
  normalizeFocal,
  type ImageCrop,
  type ImageFit,
  type ResolutionCheck,
} from "./focal";
export {
  ZONE_SIDES,
  classifyZoneSide,
  unionOfZoneSides,
  zoneOverlaps,
  type SideOverlap,
  type ZoneOverlap,
  type ZoneSide,
} from "./guides";
export { zoneChips, type ZoneChip } from "./guides-overlay";
export {
  BACKGROUND_LAYER_ID,
  MIN_TEXT_CONTRAST,
  MIN_TEXT_PX_AT_REFERENCE,
  REFERENCE_WIDTH_PX,
  layoutSocial,
  type LayoutContext,
  type LogoVariant,
  type PlacedFill,
  type PlacedGrain,
  type PlacedImage,
  type PlacedLayer,
  type PlacedLogo,
  type PlacedScanlines,
  type PlacedShape,
  type PlacedText,
  type PlacedTextLine,
  type SocialLayout,
  type SocialWarning,
} from "./layout";
export {
  JPEG_QUALITY,
  createDefaultTarget,
  renderSocialToBlob,
  type ExportFormat,
  type RenderOptions,
  type RenderTarget,
  type RenderTargetFactory,
} from "./render";
export {
  collectResourceUrls,
  disposeBitmaps,
  ensureFonts,
  fontsOfTemplate,
  loadResources,
  type FetchedResponse,
  type FontLoader,
  type LoadDeps,
  type LoadedResources,
} from "./resources";
export {
  applyTextTransform,
  fitText,
  wrapText,
  type FitLayer,
  type FitResult,
  type MeasureFn,
  type SocialTextLayer,
  type WrapOptions,
  type WrapResult,
} from "./textfit";
