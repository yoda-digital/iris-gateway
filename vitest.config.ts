import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Entry points — no testable logic
        "src/index.ts",
        // Bridge — tracked separately in #87
        "src/bridge/opencode-client.ts",
        // Channel adapter bootstrap files without direct tests
        "src/channels/discord/client.ts",
        "src/channels/whatsapp/connection.ts",
        // CLI — integration-tested via cli-integration.test.ts, not unit-testable
        "src/cli/banner.ts",
        "src/cli/program.ts",
        "src/cli/commands/gateway.ts",
        "src/cli/commands/doctor.ts",
        "src/cli/commands/send.ts",
        "src/cli/commands/session.ts",
        // Type-only files — no executable code
        "src/config/types.ts",
        "src/utils/types.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    },
  },
});
