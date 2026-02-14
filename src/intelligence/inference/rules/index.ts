import type { InferenceRule } from "../engine.js";
import { timezoneFromHoursRule } from "./timezone-from-hours.js";
import { languageStabilityRule } from "./language-stability.js";
import { engagementTrendRule } from "./engagement-trend.js";
import { responseCadenceRule } from "./response-cadence.js";
import { sessionPatternRule } from "./session-pattern.js";

export const builtinInferenceRules: InferenceRule[] = [
  timezoneFromHoursRule,
  languageStabilityRule,
  engagementTrendRule,
  responseCadenceRule,
  sessionPatternRule,
];
