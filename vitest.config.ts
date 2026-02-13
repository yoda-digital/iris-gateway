import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/bridge/opencode-client.ts",
        "src/channels/telegram/index.ts",
        "src/channels/discord/index.ts",
        "src/channels/discord/client.ts",
        "src/channels/whatsapp/index.ts",
        "src/channels/whatsapp/connection.ts",
        "src/channels/slack/index.ts",
        "src/channels/adapter.ts",
        "src/cli/banner.ts",
        "src/cli/program.ts",
        "src/cli/commands/gateway.ts",
        "src/cli/commands/doctor.ts",
        "src/cli/commands/send.ts",
        "src/cli/commands/session.ts",
        "src/gateway/lifecycle.ts",
        "src/config/types.ts",
        "src/utils/types.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
