/** Öffentliche API der Mockup-Engine. */
export { createMockupRenderer } from "./client";
export type { CreateMockupRendererOptions, MockupRendererHandle, WorkerPort } from "./client";
export { planRender, limitOutput, MAX_CANVAS_PX } from "./plan";
export type { PlanOptions, RenderPlan, RenderStep } from "./plan";
export { quadFrame, designRectMm, designMatrix, placementMatrix } from "./geometry";
export type { Matrix2D, Placement, QuadFrame } from "./geometry";
export { selectVariant, exposureForHex } from "./variant";
export type { Exposure, VariantSelection } from "./variant";
export { MockupEngineError, isMockupEngineError, isAbortError } from "./errors";
export type { MockupErrorCode } from "./errors";
export type {
  MockupBackground,
  MockupImageType,
  MockupPlacement,
  MockupRenderInput,
  MockupRenderOptions,
  MockupRenderer,
  RendererMode,
} from "./types";
