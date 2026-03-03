# Plugin Tool API Reference

This document describes all HTTP endpoints exposed by the Iris tool server (default port `19877`).

All endpoints accept/return `application/json`. POST bodies are JSON objects.

## Domains

- [Channels](#channels) — send messages, media, channel actions
- [Vault](#vault) — persistent memory store
- [Governance](#governance) — rules, audit, usage tracking
- [Policy](#policy) — master policy engine
- [Intelligence](#intelligence) — goals, arcs, proactive intents
- [System](#system) — canvas, heartbeat, onboarding
- [Skills & Agents](#skills--agents) — dynamic skill/agent CRUD
- [CLI Tools](#cli-tools) — registered CLI tool execution

---

## Channels

### `POST /tool/send-message`
Send a text message to a channel.

**Request:**
```json
{
  "channel": "telegram",
  "to": "482509234",
  "text": "Hello!",
  "replyToId": "optional-message-id"
}
```
**Response:** Channel adapter send result.

---

### `POST /tool/send-media`
Send media (image, video, audio, document).

**Request:**
```json
{
  "channel": "telegram",
  "to": "482509234",
  "type": "image",
  "url": "https://example.com/photo.jpg",
  "mimeType": "image/jpeg",
  "filename": "photo.jpg",
  "caption": "Optional caption"
}
```

---

### `POST /tool/channel-action`
Typing indicator, reaction, edit, or delete.

**Request:**
```json
{
  "channel": "telegram",
  "action": "react",
  "chatId": "482509234",
  "messageId": "msg-123",
  "emoji": "👍",
  "text": "optional for edit"
}
```
`action` values: `typing` | `react` | `edit` | `delete`

---

### `POST /tool/user-info`
Query user context on a channel.

**Request:** `{ "channel": "telegram", "userId": "482509234" }`

**Response:** `{ "channel", "userId", "capabilities" }`

---

### `GET /tool/list-channels`
List all active channels.

**Response:** `{ "channels": [{ "id", "label", "capabilities" }] }`

---

### `POST /tool/plugin/:name`
Execute a plugin-registered tool.

**Request:** Any JSON body (tool-specific).

---

### `GET /tool/plugin-manifest`
List all plugin-registered tools.

**Response:** `{ "tools": { "tool_name": { "description" } } }`

---

## Vault

### `POST /vault/search`
Semantic search over persistent memory.

**Request:**
```json
{
  "query": "user preferences",
  "senderId": "optional-filter",
  "type": "fact|preference|event|insight",
  "limit": 10
}
```
**Response:** `{ "results": [...] }`

---

### `POST /vault/store`
Store a memory entry.

**Request:**
```json
{
  "content": "User prefers dark mode",
  "type": "preference",
  "sessionId": "session-id",
  "senderId": "user-123",
  "channelId": "telegram",
  "confidence": 0.9,
  "expiresAt": 1700000000000
}
```
**Response:** `{ "id": "memory-uuid" }`

---

### `DELETE /vault/memory/:id`
Delete a memory by ID.

**Response:** `{ "deleted": true }`

---

### `POST /vault/context`
Get profile + memories for a session/sender.

**Request:** `{ "senderId": "user-123", "channelId": "telegram" }` or `{ "sessionID": "session-id" }`

**Response:** `{ "profile", "memories" }`

---

### `POST /vault/profile`
Upsert user profile fields.

**Request:**
```json
{
  "senderId": "user-123",
  "channelId": "telegram",
  "name": "Alice",
  "timezone": "Europe/Chisinau",
  "language": "ro"
}
```

---

## Governance

### `GET /governance/rules`
Get current governance rules and directives block.

**Response:** `{ "rules": [...], "directives": "..." }`

---

### `POST /governance/evaluate`
Evaluate a tool call against governance rules.

**Request:** `{ "tool": "send_message", "sessionID": "...", "args": {} }`

**Response:** `{ "allowed": true, "ruleId": "...", "reason": "..." }`

---

### `POST /audit/log`
Log a tool execution to the audit trail.

**Request:** `{ "sessionID", "tool", "args", "result", "durationMs" }`

---

### `POST /usage/record`
Record token/cost usage.

**Request:**
```json
{
  "sessionId": "...",
  "modelId": "gpt-4",
  "tokensInput": 100,
  "tokensOutput": 50,
  "costUsd": 0.001,
  "durationMs": 1200
}
```
**Response:** `{ "id": "usage-uuid" }`

---

### `POST /usage/summary`
Get aggregated usage stats.

**Request:** `{ "senderId": "optional", "since": 1700000000000, "until": 1700100000000 }`

---

## Policy

### `GET /policy/status`
Master policy configuration status.

**Response:** `{ "enabled": true, "config": {...} }`

---

### `POST /policy/check-tool`
Check if a tool is allowed by policy.

**Request:** `{ "tool": "bash" }`

**Response:** `{ "allowed": false, "reason": "tool in denied list" }`

---

### `POST /policy/check-permission`
Check if a permission is denied.

**Request:** `{ "permission": "edit" }`

**Response:** `{ "denied": true }`

---

### `GET /policy/audit`
Audit all agents and skills against policy.

**Response:** `{ "enabled": true, "compliant": false, "results": [...] }`

---

## Intelligence

### `POST /session/system-context`
Get assembled system prompt context (directives + user context + intelligence).

**Request:** `{ "sessionID": "session-id" }`

**Response:**
```json
{
  "directives": "...",
  "channelRules": "...",
  "userContext": "...",
  "intelligenceContext": "..."
}
```

---

### `POST /goals/create`
Create a goal for a user.

**Request:**
```json
{
  "sessionID": "session-id",
  "description": "Learn guitar",
  "successCriteria": "Can play 3 songs",
  "nextAction": "Buy guitar",
  "nextActionDue": 1700000000000,
  "priority": 75
}
```
**Response:** Goal object.

---

### `POST /goals/update`
Update progress on a goal.

**Request:** `{ "id": "goal-id", "progressNote": "Bought guitar!", "nextAction": "...", "nextActionDue": ... }`

---

### `POST /goals/complete` / `POST /goals/pause` / `POST /goals/resume` / `POST /goals/abandon`
Transition goal status. **Request:** `{ "id": "goal-id" }`

---

### `POST /goals/list`
List active/paused goals for a user.

**Request:** `{ "sessionID": "..." }` or `{ "senderId": "..." }`

**Response:** `{ "active": [...], "paused": [...] }`

---

### `POST /arcs/list`
List active narrative arcs.

**Request:** `{ "sessionID": "..." }`

**Response:** `{ "arcs": [...] }`

---

### `POST /arcs/resolve`
Resolve a narrative arc.

**Request:** `{ "id": "arc-id", "summary": "Resolved after 3 days" }`

---

### `POST /arcs/add-memory`
Add a memory to an arc.

**Request:** `{ "sessionID": "...", "content": "...", "memoryId": "...", "source": "conversation" }`

---

### `POST /proactive/intent`
Register a follow-up intent.

**Request:**
```json
{
  "sessionID": "...",
  "what": "Check if user completed task",
  "why": "They mentioned a deadline",
  "delayMs": 86400000,
  "confidence": 0.8,
  "category": "task"
}
```
**Response:** `{ "id": "intent-uuid" }`

---

### `POST /proactive/cancel`
Cancel a pending intent. **Request:** `{ "id": "intent-id" }`

---

### `GET /proactive/pending?limit=20`
List all pending intents and triggers.

---

### `GET /proactive/quota?senderId=...&channelId=...`
Check proactive message quota for a user.

---

### `POST /proactive/scan`
Scan for dormant users. **Request:** `{ "thresholdMs": 604800000 }`

---

### `POST /proactive/execute`
Manually trigger a pending intent. **Request:** `{ "id": "intent-id" }`

---

### `POST /proactive/engage`
Record user engagement with a proactive message. **Request:** `{ "senderId", "channelId" }`

---

## System

### `POST /canvas/update`
Update a Canvas UI session.

**Request:**
```json
{
  "sessionId": "default",
  "component": {
    "type": "markdown",
    "id": "status-card",
    "content": "# Hello"
  },
  "clear": false,
  "remove": "component-id-to-remove"
}
```

---

### `GET /heartbeat/status`
System health for all agents.

**Response:** `{ "enabled": true, "components": [{ "agentId", "component", "status" }] }`

---

### `POST /heartbeat/trigger`
Manually trigger a heartbeat check.

---

### `POST /onboarding/enrich`
Store a learned user attribute.

**Request:**
```json
{
  "sessionID": "...",
  "field": "name|language|timezone|interest|preference|note",
  "value": "Alice",
  "confidence": 0.95
}
```

---

## Skills & Agents

### `POST /skills/create`
Create a new skill. **Required:** `name`, `description`.

### `GET /skills/list`
List all skills with triggers and metadata.

### `POST /skills/delete`
Delete a skill. **Request:** `{ "name": "skill-name" }`

### `POST /skills/validate`
Validate a skill against spec. **Request:** `{ "name": "skill-name" }`

### `POST /skills/suggest`
Suggest skills matching text. **Request:** `{ "text": "user message text" }`

### `POST /agents/create`
Create a new agent. **Required:** `name`, `description`.

### `GET /agents/list`
List all agents with metadata.

### `POST /agents/delete`
Delete an agent. **Request:** `{ "name": "agent-name" }`

### `POST /agents/validate`
Validate an agent against spec. **Request:** `{ "name": "agent-name" }`

### `GET /rules/read`
Read AGENTS.md content.

### `POST /rules/update`
Replace AGENTS.md. **Request:** `{ "content": "..." }`

### `POST /rules/append`
Append section to AGENTS.md. **Request:** `{ "section": "## New Section\n..." }`

### `GET /tools/list`
List custom tools in `.opencode/tools/`.

### `POST /tools/create`
Scaffold a new custom tool. **Required:** `name`, `description`.

---

## CLI Tools

### `POST /cli/:toolName`
Execute a registered CLI tool.

**Request:**
```json
{
  "action": "subcommand-name",
  "arg1": "value1",
  "arg2": "value2"
}
```
**Response:** `{ "ok": true, "stdout": "...", "stderr": "...", "exitCode": 0 }`

Tools are registered via `iris.config.json` → `cli.tools`. See `docs/configuration.md` for setup.
