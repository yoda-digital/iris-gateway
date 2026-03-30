import { Hono } from "hono";
import type { OpenCodeBridge } from "../opencode-client.js";
import {
  type SkillsDeps,
  buildHandlerDirs,
  handleSkillCreate, handleSkillList, handleSkillDelete, handleSkillValidate, handleSkillSuggest,
  handleAgentCreate, handleAgentList, handleAgentDelete, handleAgentValidate,
  handleRulesRead, handleRulesUpdate, handleRulesAppend,
  handleToolsList, handleToolsCreate,
} from "./skills-handlers.js";

export type { SkillsDeps };

export function skillsRouter(deps: SkillsDeps & { bridge?: OpenCodeBridge | null }): Hono {
  const app = new Hono();
  const dirs = buildHandlerDirs(deps);

  app.post("/skills/create", (c) => handleSkillCreate(c, deps, dirs));
  app.get("/skills/list", (c) => handleSkillList(c, dirs));
  app.post("/skills/delete", (c) => handleSkillDelete(c, dirs));
  app.post("/skills/validate", (c) => handleSkillValidate(c, dirs));
  app.post("/skills/suggest", (c) => handleSkillSuggest(c, dirs));

  app.post("/agents/create", (c) => handleAgentCreate(c, deps, dirs));
  app.get("/agents/list", (c) => handleAgentList(c, dirs));
  app.post("/agents/delete", (c) => handleAgentDelete(c, dirs));
  app.post("/agents/validate", (c) => handleAgentValidate(c, dirs));

  app.get("/rules/read", (c) => handleRulesRead(c, dirs));
  app.post("/rules/update", (c) => handleRulesUpdate(c, dirs));
  app.post("/rules/append", (c) => handleRulesAppend(c, dirs));

  app.get("/tools/list", (c) => handleToolsList(c, dirs));
  app.post("/tools/create", (c) => handleToolsCreate(c, dirs));

  return app;
}
