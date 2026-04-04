import { irisPost } from "../lib.js";

export const permissionHook = {
  "permission.ask": async (input, output) => {
    // Config-driven permission enforcement via master policy
    try {
      const result = (await irisPost("/policy/check-permission", {
        permission: input.permission,
      })) as { denied: boolean };
      if (result.denied) {
        output.status = "deny";
        return;
      }
    } catch {
      // If policy check fails, fall back to hardcoded deny for safety
    }
    // Hardcoded fallback — always deny edit and bash as defense-in-depth
    if (input.permission === "edit" || input.permission === "bash") {
      output.status = "deny";
    }
  },
} as const;
