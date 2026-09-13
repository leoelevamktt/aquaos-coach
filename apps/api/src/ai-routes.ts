import { registerAiRoutes as registerCoreAiRoutes } from "./ai-routes-core.js";
import { installRkfKnowledgeInjection } from "./rkf-knowledge-injection.js";

export {
  VISION_COACH_PROMPT,
  buildCatalogKnowledgeContext,
  buildLiveWindowContext,
  buildPlatformContext,
  buildVisionCoachContext,
} from "./ai-routes-core.js";
export type { VisionAnalysisRecord } from "./ai-routes-core.js";

export function registerAiRoutes(...args: Parameters<typeof registerCoreAiRoutes>) {
  installRkfKnowledgeInjection();
  return registerCoreAiRoutes(...args);
}
