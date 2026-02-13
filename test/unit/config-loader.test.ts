import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { substituteEnv } from "../../src/config/loader.js";
import { parseConfig } from "../../src/config/schema.js";

describe("substituteEnv", () => {
  beforeEach(() => {
    process.env["TEST_TOKEN"] = "my-secret-token";
    process.env["TEST_PORT"] = "9999";
  });

  afterEach(() => {
    delete process.env["TEST_TOKEN"];
    delete process.env["TEST_PORT"];
  });

  it("substitutes env vars in text", () => {
    expect(substituteEnv("token: ${env:TEST_TOKEN}")).toBe(
      "token: my-secret-token",
    );
  });

  it("substitutes multiple env vars", () => {
    expect(
      substituteEnv("${env:TEST_TOKEN}:${env:TEST_PORT}"),
    ).toBe("my-secret-token:9999");
  });

  it("throws for missing env var", () => {
    expect(() => substituteEnv("${env:MISSING_VAR}")).toThrow(
      "Missing environment variable: MISSING_VAR",
    );
  });

  it("leaves text without env vars unchanged", () => {
    expect(substituteEnv("no substitution here")).toBe(
      "no substitution here",
    );
  });

  it("only matches uppercase var names", () => {
    const text = "${env:lowercase}";
    expect(substituteEnv(text)).toBe(text);
  });
});

describe("parseConfig", () => {
  it("parses minimal config with defaults", () => {
    const config = parseConfig({});
    expect(config.gateway.port).toBe(19876);
    expect(config.gateway.hostname).toBe("127.0.0.1");
    expect(config.security.defaultDmPolicy).toBe("pairing");
    expect(config.opencode.port).toBe(4096);
    expect(config.opencode.autoSpawn).toBe(true);
  });

  it("parses full config", () => {
    const config = parseConfig({
      gateway: { port: 8080 },
      channels: {
        tg: { type: "telegram", enabled: true, token: "abc" },
      },
      security: { defaultDmPolicy: "open" },
    });
    expect(config.gateway.port).toBe(8080);
    expect(config.channels["tg"]?.type).toBe("telegram");
    expect(config.security.defaultDmPolicy).toBe("open");
  });

  it("rejects invalid dm policy", () => {
    expect(() =>
      parseConfig({ security: { defaultDmPolicy: "invalid" } }),
    ).toThrow();
  });

  it("rejects invalid channel type", () => {
    expect(() =>
      parseConfig({
        channels: { x: { type: "invalid", enabled: true } },
      }),
    ).toThrow();
  });
});
