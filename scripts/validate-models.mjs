#!/usr/bin/env node
/**
 * Iris Model Validation Suite
 * Tests each free OpenRouter model for:
 *   1. Basic connectivity (health check)
 *   2. Tool calling reliability (function call + structured output)
 *   3. Speed (TTFT + throughput)
 *   4. Multilingual capability (EN/RO/RU)
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node validate-models.mjs
 *   OPENROUTER_API_KEY=sk-or-... node validate-models.mjs --model openai/gpt-oss-120b:free
 */

const API_BASE = "https://openrouter.ai/api/v1";
const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error("ERROR: Set OPENROUTER_API_KEY environment variable");
  process.exit(1);
}

// ── Models to test ──
const MODELS = {
  "openai/gpt-oss-120b:free":        { role: "primary-chat",   expectTools: true  },
  "z-ai/glm-4.5-air:free":           { role: "cron-fallback",  expectTools: true  },
  "openrouter/aurora-alpha":          { role: "moderator",      expectTools: true  },
  "qwen/qwen3-coder:free":           { role: "reasoner",       expectTools: true  },
  "deepseek/deepseek-r1-0528:free":  { role: "compactor",      expectTools: false },
  "arcee-ai/trinity-large-preview:free": { role: "alt-primary", expectTools: true  },
  "arcee-ai/trinity-mini:free":      { role: "proactive",      expectTools: true  },
  "meta-llama/llama-3.3-70b-instruct:free": { role: "fallback", expectTools: true },
};

// ── Tool schema (mimics Iris send_message) ──
const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "send_message",
    description: "Send a text message to a user on a messaging channel",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name (telegram, whatsapp, discord, slack)" },
        chatId:  { type: "string", description: "Chat or user ID on the channel" },
        text:    { type: "string", description: "Message text to send" },
      },
      required: ["channel", "chatId", "text"],
    },
  },
};

// ── Test cases ──
const TESTS = {
  basic: {
    name: "Basic Response",
    messages: [{ role: "user", content: "Say 'hello' in exactly one word." }],
    tools: false,
    validate: (data) => {
      const text = extractText(data);
      return { pass: text.toLowerCase().includes("hello"), detail: text.substring(0, 100) };
    },
  },
  toolCall: {
    name: "Tool Calling",
    messages: [
      { role: "system", content: "You are a messaging assistant. Use the send_message tool to reply." },
      { role: "user", content: "Send 'Hi there!' to user 12345 on telegram." },
    ],
    tools: true,
    validate: (data) => {
      const calls = extractToolCalls(data);
      if (calls.length === 0) return { pass: false, detail: "No tool calls in response" };
      const call = calls[0];
      const hasChannel = call.arguments?.channel === "telegram";
      const hasChatId = call.arguments?.chatId === "12345" || call.arguments?.chatId === 12345;
      const hasText = typeof call.arguments?.text === "string" && call.arguments.text.length > 0;
      return {
        pass: hasChannel && hasChatId && hasText,
        detail: `channel=${call.arguments?.channel} chatId=${call.arguments?.chatId} text="${call.arguments?.text?.substring(0, 50)}"`,
      };
    },
  },
  multilingual_ro: {
    name: "Romanian",
    messages: [{ role: "user", content: "Răspunde-mi în română: Care este capitala Moldovei?" }],
    tools: false,
    validate: (data) => {
      const text = extractText(data).toLowerCase();
      return { pass: text.includes("chișinău") || text.includes("chisinau"), detail: text.substring(0, 150) };
    },
  },
  multilingual_ru: {
    name: "Russian",
    messages: [{ role: "user", content: "Ответь на русском: какая столица Молдовы?" }],
    tools: false,
    validate: (data) => {
      const text = extractText(data).toLowerCase();
      return { pass: text.includes("кишинёв") || text.includes("кишинев"), detail: text.substring(0, 150) };
    },
  },
};

// ── Helpers ──
function extractText(data) {
  if (!data?.choices?.[0]?.message?.content) return "";
  return data.choices[0].message.content;
}

function extractToolCalls(data) {
  const calls = data?.choices?.[0]?.message?.tool_calls ?? [];
  return calls.map((c) => {
    let args = c.function?.arguments ?? "{}";
    try { args = JSON.parse(args); } catch { /* keep as string */ }
    return { name: c.function?.name, arguments: args };
  });
}

async function callModel(model, messages, useTools, timeoutMs = 60000) {
  const body = {
    model,
    messages,
    max_tokens: 512,
    temperature: 0.1,
  };
  if (useTools) {
    body.tools = [TOOL_SCHEMA];
    body.tool_choice = "auto";
  }

  const start = performance.now();
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "HTTP-Referer": "https://iris-gateway.yoda.digital",
        "X-Title": "Iris Model Validation",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const elapsed = performance.now() - start;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, elapsed, error: `HTTP ${res.status}: ${errText.substring(0, 200)}` };
    }

    const data = await res.json();
    const usage = data.usage ?? {};
    return {
      ok: true,
      elapsed,
      data,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      tokPerSec: usage.completion_tokens ? (usage.completion_tokens / (elapsed / 1000)).toFixed(1) : "?",
    };
  } catch (err) {
    return { ok: false, elapsed: performance.now() - start, error: err.message };
  }
}

// ── Runner ──
async function runTests(filterModel) {
  const models = filterModel
    ? { [filterModel]: MODELS[filterModel] ?? { role: "custom", expectTools: true } }
    : MODELS;

  const results = [];

  for (const [modelId, meta] of Object.entries(models)) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`MODEL: ${modelId}`);
    console.log(`ROLE:  ${meta.role}`);
    console.log(`${"─".repeat(70)}`);

    const modelResults = { model: modelId, role: meta.role, tests: {} };

    for (const [testId, test] of Object.entries(TESTS)) {
      // Skip tool calling test for models that don't support it
      if (testId === "toolCall" && !meta.expectTools) {
        console.log(`  [SKIP] ${test.name} (model not expected to support tools)`);
        modelResults.tests[testId] = { skip: true };
        continue;
      }

      process.stdout.write(`  [....] ${test.name} `);
      const result = await callModel(modelId, test.messages, test.tools);

      if (!result.ok) {
        console.log(`\r  [FAIL] ${test.name} — ${result.error}`);
        modelResults.tests[testId] = { pass: false, error: result.error, elapsed: result.elapsed };
        continue;
      }

      const validation = test.validate(result.data);
      const status = validation.pass ? "PASS" : "FAIL";
      const speed = `${Math.round(result.elapsed)}ms (${result.tokPerSec} tok/s)`;

      console.log(`\r  [${status}] ${test.name} — ${speed}`);
      if (!validation.pass || process.argv.includes("--verbose")) {
        console.log(`         ${validation.detail}`);
      }

      modelResults.tests[testId] = {
        pass: validation.pass,
        elapsed: Math.round(result.elapsed),
        tokPerSec: result.tokPerSec,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        detail: validation.detail,
      };

      // Rate limit courtesy — 500ms between calls
      await new Promise((r) => setTimeout(r, 500));
    }

    results.push(modelResults);
  }

  // ── Summary ──
  console.log(`\n${"═".repeat(70)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(70)}`);

  const header = "Model".padEnd(42) + "Basic".padEnd(8) + "Tools".padEnd(8) + "RO".padEnd(8) + "RU".padEnd(8) + "Avg ms";
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const cols = [r.model.padEnd(42)];
    let totalMs = 0;
    let count = 0;
    for (const testId of ["basic", "toolCall", "multilingual_ro", "multilingual_ru"]) {
      const t = r.tests[testId];
      if (t?.skip) { cols.push("SKIP".padEnd(8)); continue; }
      if (t?.pass === true)  { cols.push("✓".padEnd(8)); }
      else if (t?.pass === false) { cols.push("✗".padEnd(8)); }
      else { cols.push("?".padEnd(8)); }
      if (t?.elapsed) { totalMs += t.elapsed; count++; }
    }
    cols.push(count > 0 ? `${Math.round(totalMs / count)}` : "?");
    console.log(cols.join(""));
  }

  // Write JSON report
  const reportPath = "model-validation-report.json";
  const fs = await import("fs");
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nDetailed report: ${reportPath}`);
}

// ── Entry ──
const filterArg = process.argv.find((a) => a.startsWith("--model="));
const filterModel = filterArg ? filterArg.split("=")[1] : null;
runTests(filterModel).catch(console.error);
