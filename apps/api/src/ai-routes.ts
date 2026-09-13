import { registerAiRoutes as registerCoreAiRoutes } from "./ai-routes-core.js";

export {
  VISION_COACH_PROMPT,
  buildCatalogKnowledgeContext,
  buildLiveWindowContext,
  buildPlatformContext,
  buildVisionCoachContext,
} from "./ai-routes-core.js";
export type { VisionAnalysisRecord } from "./ai-routes-core.js";

export function registerAiRoutes(...args: Parameters<typeof registerCoreAiRoutes>) {
  return registerCoreAiRoutes(...args);
}
