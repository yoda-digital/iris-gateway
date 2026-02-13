import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "../../src/plugins/registry.js";

describe("PluginRegistry", () => {
  it("registers and retrieves tools", () => {
    const reg = new PluginRegistry();
    const api = reg.createApi("test-plugin", {} as any, console as any, "/tmp");
    api.registerTool("echo", {
      description: "Echo input",
      args: {},
      async execute(args) { return args; },
    });
    expect(reg.tools.has("echo")).toBe(true);
    expect(reg.tools.get("echo")!.description).toBe("Echo input");
  });

  it("registers channels", () => {
    const reg = new PluginRegistry();
    const api = reg.createApi("test", {} as any, console as any, "/tmp");
    const factory = vi.fn();
    api.registerChannel("matrix", factory);
    expect(reg.channels.has("matrix")).toBe(true);
  });

  it("registers services", () => {
    const reg = new PluginRegistry();
    const api = reg.createApi("test", {} as any, console as any, "/tmp");
    api.registerService("notifier", { start: vi.fn(), stop: vi.fn() });
    expect(reg.services.has("notifier")).toBe(true);
  });

  it("registers hooks via hookBus", async () => {
    const reg = new PluginRegistry();
    const api = reg.createApi("test", {} as any, console as any, "/tmp");
    const handler = vi.fn();
    api.registerHook("gateway.ready", handler);
    await reg.hookBus.emit("gateway.ready", undefined as never);
    expect(handler).toHaveBeenCalled();
  });

  it("generates a plugin manifest", () => {
    const reg = new PluginRegistry();
    const api = reg.createApi("test", {} as any, console as any, "/tmp");
    api.registerTool("translate", {
      description: "Translate text",
      args: {},
      async execute() { return {}; },
    });
    const manifest = reg.getManifest();
    expect(manifest.tools.translate).toBeDefined();
    expect(manifest.tools.translate.description).toBe("Translate text");
  });
});
