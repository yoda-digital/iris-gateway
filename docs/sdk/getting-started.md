# Iris Gateway SDK — Getting Started

Build an external plugin that talks to Iris in under 30 minutes.

## What This Is

Iris runs a tool-server on port 19877. The SDK is a typed HTTP client for that API — use it from any Node.js service, script, or out-of-process plugin.

## Install

No package yet — copy `src/sdk/client.ts` into your project or import directly if you have access to the gateway repo:

```ts
import IrisClient from "@iris-gateway/src/sdk/client.js";
```

Or use fetch directly — the SDK is just a thin wrapper.

## Quick Start

```ts
import IrisClient from "./sdk/client.js";

const iris = new IrisClient({
  baseUrl: "http://localhost:19877",
  turnId: "my-plugin-turn-001",  // groups audit log entries
});

// Search vault
const { results } = await iris.vault.search({ query: "project goals", limit: 5 });
console.log(results[0]?.content);

// Store a fact
await iris.vault.store({
  sessionId: "my-session",
  content: "User prefers dark mode",
  type: "preference",
  source: "my-plugin",
});

// Send a message
await iris.channels.sendMessage({
  channel: "telegram",
  to: "482509234",
  text: "Hello from my plugin!",
});

// Check policy before tool use
const { allowed, reason } = await iris.governance.checkPolicy({
  tool: "vault.store",
  sessionId: "my-session",
  args: { content: "sensitive data" },
});
if (!allowed) throw new Error(`Blocked: ${reason}`);
```

## API Reference

### `iris.vault`

| Method | Description |
|--------|-------------|
| `search({ query, limit?, sessionId? })` | Semantic search over vault |
| `store({ sessionId, content, type?, source? })` | Store a fact/memory |
| `extract({ sessionID, context[] })` | Extract facts from context strings |
| `context({ sessionId, query? })` | Get assembled context for a session |
| `storeBatch({ entries[] })` | Store multiple facts at once |
| `deleteMemory(id)` | Delete a memory entry by ID |

### `iris.channels`

| Method | Description |
|--------|-------------|
| `sendMessage({ channel, to, text, replyToId? })` | Send a message via any channel |
| `listChannels()` | List configured channel IDs |

### `iris.governance`

| Method | Description |
|--------|-------------|
| `checkPolicy({ tool, sessionId?, args? })` | Check if a tool call is allowed |
| `logAudit({ tool, sessionId?, args?, result?, durationMs? })` | Manual audit log entry |
| `getPolicyStatus()` | Current policy engine state |

### `iris.intelligence`

| Method | Description |
|--------|-------------|
| `systemContext({ sessionId, senderId, channelId })` | Get system context for a session |
| `createGoal({ sessionId, channelId, senderId, content, category? })` | Create a new goal |
| `listGoals({ sessionId })` | List goals for a session |

### `iris.system`

| Method | Description |
|--------|-------------|
| `proactiveIntent({ sessionId, senderId, channelId, chatId, what, why? })` | Queue a proactive intent |
| `heartbeatStatus()` | Get agent heartbeat status |

## Execution Traces

Pass `turnId` in the constructor to group all your plugin's calls into a single trace:

```ts
const iris = new IrisClient({ turnId: "order-processing-job-42" });

await iris.vault.store(...);          // step 0
await iris.governance.checkPolicy(..); // step 1
await iris.channels.sendMessage(...);  // step 2

// Later: retrieve the trace
// { turn_id, steps: [{ tool, args, result, duration_ms, step_index }] }
```

## Auth

Port 19877 has no auth by default — bind it to localhost only. If exposed externally, use a reverse proxy with mTLS or token verification.

## Error Handling

All methods throw on non-2xx responses:

```ts
try {
  await iris.vault.store({ sessionId: "x", content: "..." });
} catch (err) {
  // err.message = "Iris SDK: POST /vault/store → 500 ..."
}
```
