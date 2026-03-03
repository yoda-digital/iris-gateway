import { tool } from "@opencode-ai/plugin";
import { irisPost, irisGet } from "../lib.js";

export const governanceTools = {
  governance_status: tool({
      description: "Check current governance rules and directives",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/governance/rules"));
      },
    }),,

  usage_summary: tool({
      description: "Get usage and cost summary for a user or all users",
      args: {
        senderId: tool.schema.string().optional().describe("Filter by sender ID"),
        since: tool.schema.number().optional().describe("Unix timestamp for start of period"),
        until: tool.schema.number().optional().describe("Unix timestamp for end of period"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/usage/summary", args));
      },
    }),,

  policy_status: tool({
      description:
        "View the master policy configuration — the structural ceiling for all agents, skills, and tools. Shows allowed/denied tools, permission defaults, agent creation constraints, and enforcement settings.",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/policy/status"));
      },
    }),,

  policy_audit: tool({
      description:
        "Audit ALL existing agents and skills against the master policy. Returns compliance status and violations for each. Use this to verify the system is consistent with policy.",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/policy/audit"));
      },
    }),,
} as const;
