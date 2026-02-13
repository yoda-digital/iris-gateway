# Iris v2 Feature Design

8 features that close the gap with OpenClaw and push past it.

## Dependency Graph

```
Plugin SDK ──────────────────────────┐
  ├── Security Scanner               │
  ├── Skill Creator (tool)           │
  ├── Agent/Subagent Creator (tool)  │
  └── Canvas + A2UI (channel)        │
                                     │
Streaming + Block Coalescing ────────┤ (independent)
Usage/Cost Tracking ─────────────────┤ (independent)
Auto-Reply Templating ───────────────┘ (independent)
```

Build order: Plugin SDK first (everything depends on it), then the rest in parallel.

---

## 1. Plugin SDK

### Problem

All extension happens by editing `iris.ts` (OpenCode plugin) or `tool-server.ts` (HTTP endpoints) or `lifecycle.ts` (adapter registration). No way to add functionality without touching core.

### Design

**Three new source modules:**

```
src/plugins/
  types.ts      — IrisPlugin, IrisPluginApi, registration interfaces
  registry.ts   — PluginRegistry (stores all registrations)
  loader.ts     — PluginLoader (Jiti-based dynamic loading)
  hook-bus.ts   — HookBus (ordered event dispatch)
```

**Plugin interface:**

```typescript
export interface IrisPlugin {
  id: string;
  name?: string;
  version?: string;
  register(api: IrisPluginApi): void | Promise<void>;
}

export interface IrisPluginApi {
  registerTool(name: string, def: PluginToolDef): void;
  registerChannel(id: string, factory: ChannelFactory): void;
  registerService(name: string, service: PluginService): void;
  registerProvider(id: string, factory: ProviderFactory): void;
  registerCli(registrar: CliRegistrar): void;
  registerHook<K extends keyof HookMap>(event: K, handler: HookHandler<K>): void;
  readonly config: Readonly<IrisConfig>;
  readonly logger: Logger;
  readonly stateDir: string;
}
```

**7 registration methods:**

| Method | What it registers | Consumed by |
|--------|-------------------|-------------|
| `registerTool` | Tool name + Zod schema + execute fn | tool-server.ts generates HTTP endpoint, iris.ts manifest |
| `registerChannel` | Channel ID + adapter factory | lifecycle.ts adapter loop |
| `registerService` | Service with start/stop lifecycle | lifecycle.ts after gateway ready |
| `registerProvider` | Model provider factory | Future: multi-model routing |
| `registerCli` | CLI command class | program.ts command registration |
| `registerHook` | Event handler with priority | HookBus dispatches at lifecycle points |

**PluginToolDef:**

```typescript
export interface PluginToolDef {
  description: string;
  args: z.ZodRawShape;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  sessionId: string;
  senderId: string | null;
  channelId: string | null;
  logger: Logger;
}
```

**PluginService:**

```typescript
export interface PluginService {
  start(ctx: ServiceContext): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceContext {
  config: Readonly<IrisConfig>;
  logger: Logger;
  stateDir: string;
  signal: AbortSignal;
}
```

**HookBus events:**

| Event | Fires when | Input | Can modify |
|-------|-----------|-------|------------|
| `message.inbound` | Message received, before security | InboundMessage | message text |
| `message.routed` | After security + session resolved | { message, sessionId } | nothing (observe) |
| `message.outbound` | Before sending response to channel | { channelId, chatId, text } | text |
| `gateway.ready` | All adapters started | GatewayContext | nothing |
| `gateway.shutdown` | Shutdown initiated | void | nothing |
| `tool.registered` | Plugin tool registered | { name, description } | nothing |

**PluginLoader:**

```typescript
export class PluginLoader {
  async loadAll(config: IrisConfig, stateDir: string): Promise<PluginRegistry> {
    const registry = new PluginRegistry();
    const paths = this.discoverPlugins(config);
    for (const path of paths) {
      const mod = await this.loadModule(path);     // Jiti
      const plugin = this.resolveExport(mod);       // extract IrisPlugin
      await plugin.register(registry.createApi(plugin.id));
    }
    return registry;
  }
}
```

**Discovery order:**
1. Explicit paths from `config.plugins[]`
2. `~/.iris/plugins/*/index.ts`
3. `./plugins/*/index.ts` (project-local)

Each path can be a directory (looks for index.ts) or a file.

**Jiti config:** TypeScript support, ESM, isolated module scope, alias `@iris/sdk` for type imports.

**Config addition:**

```typescript
// In IrisConfig
readonly plugins?: string[];
```

**Integration with lifecycle.ts:**

```typescript
// After config load, before anything else
const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);

// Channel registration: merge plugin channels into ADAPTER_FACTORIES
for (const [id, factory] of pluginRegistry.channels) {
  ADAPTER_FACTORIES[id] = factory;
}

// Tool server: pass plugin tools
const toolServer = new ToolServer({
  registry, logger, vaultStore, vaultSearch, governanceEngine,
  sessionMap, pluginTools: pluginRegistry.tools,
});

// After gateway ready:
await pluginRegistry.hookBus.emit("gateway.ready", ctx);

// Services:
for (const [name, service] of pluginRegistry.services) {
  await service.start({ config, logger, stateDir, signal });
}
```

**Integration with OpenCode plugin (iris.ts):**

Plugin tools need to be callable by the AI. Two approaches:

**Approach A (chosen):** Tool-server generates dynamic endpoints for plugin tools (`/tool/plugin/<name>`). The OpenCode plugin `iris.ts` reads a manifest file (`~/.iris/plugin-tools.json`) at startup that lists all registered plugin tools with their schemas. It generates OpenCode tool definitions from this manifest.

**Manifest format:**

```json
{
  "tools": {
    "translate": {
      "description": "Translate text to another language",
      "args": { "text": "string", "targetLang": "string" }
    }
  }
}
```

The PluginLoader writes this manifest after loading all plugins. The OpenCode plugin reads it and creates tool wrappers that call `/tool/plugin/<name>`.

### Security

**Before loading any plugin, run the SecurityScanner** (Feature 8). Block plugins with CRITICAL findings. Warn on WARN findings but load anyway.

---

## 2. Streaming + Block Coalescing

### Problem

Currently Iris accumulates the entire AI response via SSE, then sends it all at once. For long responses (>2000 chars), the user stares at a typing indicator for 30+ seconds.

### Design

**New module:**

```
src/bridge/
  stream-coalescer.ts  — buffers text, flushes on thresholds
```

**StreamCoalescer:**

```typescript
export interface CoalescerConfig {
  enabled: boolean;
  minChars: number;      // Don't flush until this many chars buffered (default 300)
  maxChars: number;      // Hard cap per chunk (from platform limit)
  idleMs: number;        // Flush after this much silence (default 800ms)
  breakOn: "paragraph" | "sentence" | "word";  // Where to split
  editInPlace: boolean;  // Edit last message instead of sending new ones
}

export class StreamCoalescer {
  private buffer = "";
  private idleTimer: Timer | null = null;
  private messageId: string | null = null;  // For edit-in-place

  constructor(
    private readonly config: CoalescerConfig,
    private readonly onFlush: (text: string, isEdit: boolean) => void,
  ) {}

  append(delta: string): void;     // Add text from SSE event
  flush(force?: boolean): void;    // Flush buffer
  end(): void;                     // Final flush + cleanup
}
```

**Flush logic:**

1. `append(delta)` adds to buffer, resets idle timer
2. If `buffer.length >= maxChars`: find break point (paragraph > sentence > word > hard cut), flush everything up to break, keep remainder
3. If `buffer.length >= minChars` and idle timer fires: flush all
4. `end()` forces final flush regardless of minChars

**Break point detection:**

```typescript
function findBreakPoint(text: string, maxLen: number, breakOn: string): number {
  const chunk = text.slice(0, maxLen);
  if (breakOn === "paragraph") {
    const idx = chunk.lastIndexOf("\n\n");
    if (idx > 0) return idx + 2;
  }
  if (breakOn === "paragraph" || breakOn === "sentence") {
    const match = chunk.match(/.*[.!?]\s/s);
    if (match) return match[0].length;
  }
  // Word boundary
  const idx = chunk.lastIndexOf(" ");
  return idx > 0 ? idx + 1 : maxLen;
}
```

**EventHandler changes:**

Currently event-handler.ts accumulates text and emits `"response"` on completion. New behavior:

```typescript
// New event: "partial" — emitted on each text delta
handleEvent(event: OpenCodeEvent): void {
  if (event.type === "message.part.updated") {
    // ... existing accumulation ...
    if (part.type === "text" && event.properties.delta) {
      this.events.emit("partial", sessionId, event.properties.delta);
    }
  }
  // ... existing "response" on message.finish ...
}
```

**MessageRouter changes:**

```typescript
// In handleInbound, after creating pending response:
const coalescer = new StreamCoalescer(
  this.getCoalescerConfig(msg.channelId),
  (text, isEdit) => {
    if (isEdit && lastMessageId) {
      adapter.editMessage?.({ messageId: lastMessageId, text, chatId: msg.chatId });
    } else {
      this.outboundQueue.enqueue({ channelId, chatId, text, replyToId: msg.id });
    }
  },
);

// Wire partial events
this.eventHandler.events.on("partial", (sid, delta) => {
  if (sid === entry.openCodeSessionId) coalescer.append(delta);
});

// On full response, end the coalescer
this.eventHandler.events.on("response", (sid, text) => {
  if (sid === entry.openCodeSessionId) coalescer.end();
});
```

**Edit-in-place strategy:**

For Telegram and Discord (which support message editing):
1. First flush: send new message, store its messageId
2. Subsequent flushes: edit that message with accumulated text
3. Final flush: last edit with complete text

This gives a "live typing" effect. For Slack/WhatsApp (no good edit support), fall back to chunked messages.

**Per-channel config in IrisConfig:**

```typescript
export interface ChannelAccountConfig {
  // ... existing fields ...
  readonly streaming?: StreamingConfig;
}

export interface StreamingConfig {
  readonly enabled: boolean;
  readonly minChars?: number;
  readonly idleMs?: number;
  readonly breakOn?: "paragraph" | "sentence" | "word";
  readonly editInPlace?: boolean;
}
```

---

## 3. Usage/Cost Tracking

### Problem

No visibility into token consumption or cost. Can't answer "how much is this costing me?"

### Design

**New module:**

```
src/usage/
  tracker.ts   — UsageTracker class
  types.ts     — UsageRecord, UsageSummary types
```

**New vault table:**

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
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_log(session_id);
```

**Data source:**

The OpenCode SDK `AssistantMessage` already carries:

```typescript
tokens: { total?, input, output, reasoning, cache: { read, write } }
cost: number
modelID: string
providerID: string
```

These arrive in the SSE event stream. The `EventHandler` already parses `message.part.updated` events. We need to capture the `AssistantMessage` metadata from the final message event.

**EventHandler addition:**

```typescript
// When message.finish is detected:
this.events.emit("usage", sessionId, {
  modelId: message.modelID,
  providerId: message.providerID,
  tokens: message.tokens,
  cost: message.cost,
});
```

**UsageTracker:**

```typescript
export class UsageTracker {
  constructor(private readonly db: VaultDB) {}

  record(entry: UsageRecord): void;           // Insert into usage_log
  summarize(opts: SummaryOpts): UsageSummary;  // Aggregate query
  forSender(senderId: string): UsageSummary;
  forSession(sessionId: string): UsageSummary;
  daily(date?: string): DailySummary;
}
```

**Tool-server endpoints:**

```
POST /usage/record       — record a usage entry
GET  /usage/summary      — aggregate summary (with query params)
GET  /usage/sender/:id   — per-sender summary
```

**OpenCode plugin tool:**

```typescript
usage_summary: tool({
  description: "Get token usage and cost summary for a user or time period",
  args: {
    senderId: tool.schema.string().optional(),
    period: tool.schema.enum(["today", "week", "month", "all"]).optional(),
  },
  async execute(args) {
    return JSON.stringify(await irisGet(`/usage/summary?${new URLSearchParams(args)}`));
  },
}),
```

**Wiring in lifecycle.ts:**

```typescript
const usageTracker = new UsageTracker(vaultDb);

// In event handler setup:
eventHandler.events.on("usage", (sessionId, usage) => {
  const entry = await sessionMap.findBySessionId(sessionId);
  usageTracker.record({
    sessionId,
    senderId: entry?.senderId ?? null,
    channelId: entry?.channelId ?? null,
    ...usage,
  });
});
```

---

## 4. Auto-Reply Templating

### Problem

Every message goes through OpenCode, even when a static response would suffice. Wastes tokens, adds latency.

### Design

**New module:**

```
src/auto-reply/
  engine.ts     — TemplateEngine (matching + rendering)
  types.ts      — Template, Trigger, TemplateContext types
```

**Template definition:**

```typescript
export interface AutoReplyTemplate {
  id: string;
  trigger: TemplateTrigger;
  response: string;              // Template string with {var} interpolation
  priority?: number;             // Higher = checked first (default 0)
  cooldown?: number;             // Seconds between activations per-sender
  once?: boolean;                // Fire only once per sender ever
  channels?: string[];           // Restrict to specific channels (null = all)
  chatTypes?: ("dm" | "group")[]; // Restrict to DM or group
  forwardToAi?: boolean;         // Still send to AI after auto-reply
}

export type TemplateTrigger =
  | { type: "exact"; pattern: string }           // Exact match (case-insensitive)
  | { type: "regex"; pattern: string }           // Regex match
  | { type: "keyword"; words: string[] }         // Any keyword present
  | { type: "command"; name: string }            // /command prefix
  | { type: "schedule"; when: ScheduleCondition }; // Time-based (always-on)

export interface ScheduleCondition {
  hours?: [number, number];      // Active during these hours [start, end)
  days?: number[];               // 0=Sun, 1=Mon, ..., 6=Sat
  timezone?: string;             // IANA timezone (default UTC)
}
```

**TemplateEngine:**

```typescript
export class TemplateEngine {
  private templates: AutoReplyTemplate[] = [];
  private cooldowns = new Map<string, number>();   // "templateId:senderId" -> timestamp
  private onceFired = new Set<string>();            // "templateId:senderId"

  constructor(templates: AutoReplyTemplate[]) {
    this.templates = templates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  match(msg: InboundMessage): TemplateMatch | null {
    for (const tpl of this.templates) {
      if (!this.channelAllowed(tpl, msg)) continue;
      if (!this.chatTypeAllowed(tpl, msg)) continue;
      if (this.isOnCooldown(tpl, msg.senderId)) continue;
      if (this.wasFiredOnce(tpl, msg.senderId)) continue;
      if (this.triggerMatches(tpl.trigger, msg)) {
        return { template: tpl, response: this.render(tpl.response, msg) };
      }
    }
    return null;
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

**Integration in MessageRouter.handleInbound:**

```typescript
// After security check, before session resolution:
const autoReply = this.templateEngine?.match(msg);
if (autoReply) {
  await adapter?.sendText({ to: msg.chatId, text: autoReply.response, replyToId: msg.id });
  if (!autoReply.template.forwardToAi) return;  // Skip OpenCode
}
```

**Config:**

```typescript
export interface IrisConfig {
  // ... existing ...
  readonly autoReply?: AutoReplyConfig;
}

export interface AutoReplyConfig {
  readonly enabled: boolean;
  readonly templates: AutoReplyTemplate[];
}
```

---

## 5. Security Scanner

### Problem

No way to validate that plugins or skills contain safe code. A malicious plugin could steal env vars, exec shell commands, or exfiltrate data.

### Design

**New module:**

```
src/security/
  scanner.ts        — SecurityScanner class
  scan-rules.ts     — Rule definitions
  scan-types.ts     — ScanResult, ScanFinding, ScanRule types
```

**Rule system:**

```typescript
export type ScanSeverity = "critical" | "warn" | "info";

export interface ScanRule {
  id: string;
  severity: ScanSeverity;
  description: string;
  type: "line" | "source";
  pattern: RegExp;
  context?: RegExp;            // Must also match for rule to fire (line rules)
  contextType?: "import" | "source"; // Where to check context
}

export interface ScanFinding {
  ruleId: string;
  severity: ScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;            // Matching line content
}

export interface ScanResult {
  safe: boolean;               // No critical findings
  scannedFiles: number;
  findings: ScanFinding[];
  critical: number;
  warn: number;
  info: number;
}
```

**Rules:**

```typescript
export const SCAN_RULES: ScanRule[] = [
  // CRITICAL: Shell execution
  {
    id: "dangerous-exec",
    severity: "critical",
    description: "Shell command execution detected",
    type: "line",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile)\s*\(/,
    context: /child_process/,
    contextType: "import",
  },
  // CRITICAL: Dynamic code execution
  {
    id: "dynamic-eval",
    severity: "critical",
    description: "Dynamic code execution (eval/Function constructor)",
    type: "line",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  // CRITICAL: Crypto mining signatures
  {
    id: "crypto-mining",
    severity: "critical",
    description: "Cryptocurrency mining signatures",
    type: "line",
    pattern: /stratum\+tcp|coinhive|cryptonight|xmrig/i,
  },
  // CRITICAL: Environment variable harvesting
  {
    id: "env-harvesting",
    severity: "critical",
    description: "Environment variables accessed near network calls",
    type: "source",
    pattern: /process\.env/,
    context: /\bfetch\b|http\.request|https\.request|axios|got\b/,
    contextType: "source",
  },
  // WARN: Data exfiltration pattern
  {
    id: "data-exfiltration",
    severity: "warn",
    description: "File read combined with network request",
    type: "source",
    pattern: /readFileSync|readFile|createReadStream/,
    context: /\bfetch\b|http\.request|https\.request/,
    contextType: "source",
  },
  // WARN: Obfuscated code
  {
    id: "obfuscated-code",
    severity: "warn",
    description: "Obfuscated code detected (hex/base64 sequences)",
    type: "line",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}|atob\s*\(.*[A-Za-z0-9+/=]{200,}/,
  },
  // WARN: Suspicious WebSocket to non-standard port
  {
    id: "suspicious-network",
    severity: "warn",
    description: "WebSocket connection to non-standard port",
    type: "line",
    pattern: /new\s+WebSocket\s*\(\s*['"`]wss?:\/\/[^'"]*:\d{4,5}/,
  },
  // WARN: Global/prototype manipulation
  {
    id: "global-override",
    severity: "warn",
    description: "Global object or prototype manipulation",
    type: "line",
    pattern: /globalThis\s*[.[=]|Object\.defineProperty\s*\(\s*global/,
  },
  // INFO: Filesystem writes
  {
    id: "fs-write",
    severity: "info",
    description: "Filesystem write operations",
    type: "line",
    pattern: /writeFileSync|writeFile|appendFile|createWriteStream/,
  },
  // INFO: DNS lookups
  {
    id: "dns-lookup",
    severity: "info",
    description: "DNS resolution calls",
    type: "line",
    pattern: /dns\.resolve|dns\.lookup|dns\.reverse/,
  },
];
```

**SecurityScanner:**

```typescript
export class SecurityScanner {
  private readonly rules = SCAN_RULES;
  private readonly maxFileSize = 1_048_576;  // 1MB
  private readonly maxFiles = 500;
  private readonly extensions = new Set([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"]);

  async scanDirectory(dir: string): Promise<ScanResult>;
  async scanFile(filePath: string): Promise<ScanFinding[]>;

  private evaluateLineRules(source: string, filePath: string): ScanFinding[];
  private evaluateSourceRules(source: string, filePath: string): ScanFinding[];
  private hasContextMatch(source: string, rule: ScanRule): boolean;
}
```

**Integration points:**

1. **Plugin loader:** `await scanner.scanDirectory(pluginPath)` before loading. Block if critical.
2. **CLI command:** `iris scan <path>` — scan any directory, print report.
3. **Skill validation:** Scan `.opencode/skills/` at startup.
4. **Tool-server endpoint:** `POST /security/scan` — scan a path, return findings.

---

## 6. Skill Creator

### Problem

Creating skills requires manual file creation with correct frontmatter schema. Users shouldn't need to know the file format.

### Design

**New tools registered in OpenCode plugin:**

```typescript
skill_create: tool({
  description: "Create a new skill for the Iris AI assistant",
  args: {
    name: tool.schema.string().describe("Skill name (lowercase, hyphenated)"),
    description: tool.schema.string().describe("What the skill does"),
    tools: tool.schema.array(tool.schema.string()).describe("Tools this skill uses"),
    instructions: tool.schema.string().describe("Step-by-step instructions for the AI"),
  },
  async execute(args) {
    return JSON.stringify(await irisPost("/skills/create", args));
  },
}),

skill_list: tool({
  description: "List all available skills",
  args: {},
  async execute() {
    return JSON.stringify(await irisGet("/skills/list"));
  },
}),

skill_delete: tool({
  description: "Delete a skill",
  args: { name: tool.schema.string() },
  async execute(args) {
    return JSON.stringify(await irisPost("/skills/delete", args));
  },
}),
```

**Tool-server endpoints:**

```
POST /skills/create   — create skill file
GET  /skills/list     — list all skills
POST /skills/delete   — delete skill
POST /skills/validate — validate skill file
```

**Endpoint implementation:**

`POST /skills/create`:
1. Validate `name` (lowercase, alphanumeric + hyphens)
2. Generate SKILL.md content:
   ```markdown
   ---
   description: {description}
   tools:
     {tools as YAML list}
   ---
   {instructions}
   ```
3. Write to `.opencode/skills/{name}/SKILL.md`
4. Security-scan the instructions (no executable code in skills, but check anyway)
5. Return `{ created: true, path: "..." }`

`GET /skills/list`:
1. Glob `.opencode/skills/*/SKILL.md`
2. Parse frontmatter from each
3. Return `{ skills: [{ name, description, tools }] }`

---

## 7. Agent/Subagent Creator

### Problem

Same as skills — creating agents requires knowledge of markdown frontmatter format and available config fields.

### Design

**New tools in OpenCode plugin:**

```typescript
agent_create: tool({
  description: "Create a new agent or subagent for the Iris AI assistant",
  args: {
    name: tool.schema.string().describe("Agent name (lowercase, alphanumeric)"),
    description: tool.schema.string().describe("When to use this agent"),
    mode: tool.schema.enum(["primary", "subagent"]).describe("Agent type"),
    tools: tool.schema.record(tool.schema.boolean()).describe("Tool availability map"),
    prompt: tool.schema.string().describe("System prompt / instructions"),
    model: tool.schema.string().optional().describe("Model override"),
    temperature: tool.schema.number().optional(),
  },
  async execute(args) {
    return JSON.stringify(await irisPost("/agents/create", args));
  },
}),

agent_list: tool({
  description: "List all agents and subagents",
  args: {},
  async execute() {
    return JSON.stringify(await irisGet("/agents/list"));
  },
}),

agent_delete: tool({
  description: "Delete an agent",
  args: { name: tool.schema.string() },
  async execute(args) {
    return JSON.stringify(await irisPost("/agents/delete", args));
  },
}),
```

**Tool-server endpoints:**

```
POST /agents/create   — create agent markdown file
GET  /agents/list     — list all agents
POST /agents/delete   — delete agent
POST /agents/validate — validate agent file
```

**Endpoint implementation:**

`POST /agents/create`:
1. Validate `name` (lowercase, alphanumeric)
2. Generate agent markdown:
   ```markdown
   ---
   description: {description}
   mode: {mode}
   model: {model}
   temperature: {temperature}
   tools:
     {tools as YAML map}
   ---
   {prompt}
   ```
3. Write to `.opencode/agents/{name}.md`
4. Return `{ created: true, path: "..." }`

`GET /agents/list`:
1. Glob `.opencode/agents/*.md`
2. Parse frontmatter from each
3. Return `{ agents: [{ name, description, mode, tools }] }`

---

## 8. Canvas + A2UI (WebChat)

### Problem

No visual interface. No web-based chat. No way for the agent to render structured UI.

### Design

**New modules:**

```
src/channels/webchat/
  index.ts          — WebChatAdapter (implements ChannelAdapter)
  normalize.ts      — WebSocket message → InboundMessage

src/canvas/
  server.ts         — CanvasServer (Hono + WebSocket upgrade)
  session.ts        — CanvasSession (state per connected client)
  components.ts     — Component type definitions
  renderer.ts       — HTML template (self-contained, no build step)
```

**CanvasServer:**

Hono-based HTTP server that serves the canvas UI and handles WebSocket connections.

```typescript
export class CanvasServer {
  private readonly app: Hono;
  private readonly sessions = new Map<string, CanvasSession>();

  constructor(private readonly deps: CanvasServerDeps) {}

  async start(port: number): Promise<void>;
  async stop(): Promise<void>;
}
```

**Routes:**

```
GET  /                     — canvas SPA (single HTML file)
GET  /canvas/:sessionId    — canvas for specific session
WS   /ws/:sessionId        — WebSocket for bidirectional comms
POST /api/message           — REST fallback for sending messages
GET  /api/sessions          — list active sessions
```

**WebSocket protocol:**

Client → Server:
```json
{ "type": "message", "text": "Hello" }
{ "type": "user_action", "componentId": "form1", "action": "submit", "data": {...} }
{ "type": "ping" }
```

Server → Client:
```json
{ "type": "response", "text": "Hi there!" }
{ "type": "partial", "delta": "Working on" }
{ "type": "canvas_update", "components": [...] }
{ "type": "typing", "active": true }
{ "type": "pong" }
```

**CanvasSession:**

```typescript
export class CanvasSession {
  readonly id: string;
  private components: CanvasComponent[] = [];
  private ws: Set<WebSocket> = new Set();

  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  update(components: CanvasComponent[]): void;    // From agent tool
  broadcast(message: object): void;               // To all connected clients
  getState(): CanvasComponent[];                   // Current component tree
}
```

**Component types:**

```typescript
export type CanvasComponent =
  | { type: "text"; id: string; content: string }
  | { type: "markdown"; id: string; content: string }
  | { type: "form"; id: string; fields: FormField[] }
  | { type: "chart"; id: string; chartType: "bar" | "line" | "pie"; data: ChartData }
  | { type: "image"; id: string; url: string; alt?: string }
  | { type: "table"; id: string; headers: string[]; rows: string[][] }
  | { type: "code"; id: string; language: string; content: string }
  | { type: "button"; id: string; label: string; action: string }
  | { type: "progress"; id: string; value: number; max: number; label?: string };

export interface FormField {
  name: string;
  type: "text" | "number" | "select" | "checkbox" | "textarea" | "slider";
  label: string;
  options?: string[];        // For select
  min?: number; max?: number; // For slider/number
  required?: boolean;
  value?: unknown;           // Default value
}

export interface ChartData {
  labels: string[];
  datasets: Array<{ label: string; data: number[]; color?: string }>;
}
```

**Canvas HTML (self-contained):**

Single HTML file with embedded CSS and JS. No build tools. Uses:
- Vanilla JS for component rendering
- CSS Grid/Flexbox for layout
- Chart.js (CDN) for charts
- Marked.js (CDN) for markdown
- highlight.js (CDN) for code blocks

The HTML connects to the WebSocket and renders components as they arrive. User interactions post events back through the WebSocket.

**Agent tool (canvas_update):**

```typescript
canvas_update: tool({
  description: "Update the visual canvas with structured UI components",
  args: {
    sessionId: tool.schema.string().optional().describe("Canvas session ID"),
    action: tool.schema.enum(["render", "append", "clear", "remove"]),
    components: tool.schema.array(tool.schema.any()).optional(),
    componentId: tool.schema.string().optional(),
  },
  async execute(args) {
    return JSON.stringify(await irisPost("/canvas/update", args));
  },
}),
```

**WebChatAdapter (new channel):**

The canvas is also a chat channel. Messages typed in the web UI go through the normal Iris flow:

```typescript
export class WebChatAdapter implements ChannelAdapter {
  readonly id = "webchat";
  readonly label = "WebChat";
  readonly capabilities: ChannelCapabilities = {
    text: true, image: true, video: false, audio: false,
    document: false, reaction: true, typing: true,
    edit: true, delete: true, reply: true, thread: false,
    maxTextLength: 100_000,
  };

  // Receives messages from CanvasServer WebSocket
  // Sends responses back through WebSocket
}
```

**Wiring:**

The CanvasServer is started alongside the health server and tool server in lifecycle.ts. It shares the CanvasSession map with the WebChatAdapter so messages and canvas updates flow through the same sessions.

**Config:**

```typescript
export interface IrisConfig {
  // ... existing ...
  readonly canvas?: CanvasConfig;
}

export interface CanvasConfig {
  readonly enabled: boolean;
  readonly port: number;           // Default 19879
  readonly hostname: string;       // Default 127.0.0.1
}
```

---

## Implementation Order

Build in this sequence to respect dependencies:

| Phase | Feature | Depends on | New files | Modified files |
|-------|---------|-----------|-----------|----------------|
| 1 | Plugin SDK | nothing | 4 src files | lifecycle.ts, config |
| 2 | Security Scanner | nothing | 3 src files | — |
| 3 | Plugin SDK + Scanner integration | 1, 2 | — | loader.ts |
| 4 | Streaming + Coalescing | nothing | 1 src file | event-handler.ts, message-router.ts, config |
| 5 | Usage/Cost Tracking | nothing | 2 src files | vault/db.ts, event-handler.ts, lifecycle.ts |
| 6 | Auto-Reply Templating | nothing | 2 src files | message-router.ts, config |
| 7 | Skill Creator | nothing | — | tool-server.ts, iris.ts |
| 8 | Agent Creator | nothing | — | tool-server.ts, iris.ts |
| 9 | Canvas + A2UI | Plugin SDK (for channel registration) | 5+ src files | lifecycle.ts, config, iris.ts |
| 10 | Plugin manifest for OpenCode | 1 | — | iris.ts |

Phases 2, 4, 5, 6, 7, 8 are independent and can be parallelized.

---

## Files Changed Summary

**New files (~20):**

```
src/plugins/types.ts
src/plugins/registry.ts
src/plugins/loader.ts
src/plugins/hook-bus.ts
src/security/scanner.ts
src/security/scan-rules.ts
src/security/scan-types.ts
src/bridge/stream-coalescer.ts
src/usage/tracker.ts
src/usage/types.ts
src/auto-reply/engine.ts
src/auto-reply/types.ts
src/channels/webchat/index.ts
src/channels/webchat/normalize.ts
src/canvas/server.ts
src/canvas/session.ts
src/canvas/components.ts
src/canvas/renderer.ts (HTML template)
src/cli/commands/scan.ts
```

**Modified files (~8):**

```
src/gateway/lifecycle.ts      — wire everything
src/bridge/event-handler.ts   — partial events, usage events
src/bridge/message-router.ts  — streaming, auto-reply
src/bridge/tool-server.ts     — plugin tools, skills, agents, canvas, usage endpoints
src/config/types.ts           — new config sections
src/config/schema.ts          — new Zod schemas
src/vault/db.ts               — usage_log table
.opencode/plugin/iris.ts      — new tools, manifest loading
```

**Test files (~12-15 new test files).**
