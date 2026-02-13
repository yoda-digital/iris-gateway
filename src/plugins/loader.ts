import { existsSync, readdirSync } from "node:fs";
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
