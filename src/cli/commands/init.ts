import { Command } from "clipanion";
import * as p from "@clack/prompts";
import { writeFile, readFile, access } from "node:fs/promises";
import { execSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import * as os from "node:os";

// ─── helpers ─────────────────────────────────────────────────────────────────

function detectOpenCode(): string | null {
  for (const bin of ["opencode", "opencode-ai"]) {
    try {
      const result = spawnSync("which", [bin], { encoding: "utf-8" });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Timeout for token validation API calls in the init wizard. */
const TOKEN_VALIDATION_TIMEOUT_MS = 8_000;

/** fetch() wrapper with AbortController timeout. Returns null on timeout or network error. */
async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = TOKEN_VALIDATION_TIMEOUT_MS): Promise<Response | null> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function validateTelegramToken(token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`);
    if (!res) return false;
    const json = (await res.json()) as { ok: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

async function validateDiscordToken(token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    return res?.ok === true;
  } catch {
    return false;
  }
}

async function validateSlackAppToken(token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res) return false;
    const json = (await res.json()) as { ok: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

// ─── command ─────────────────────────────────────────────────────────────────

export class InitCommand extends Command {
  static override paths = [["init"]];

  static override usage = Command.Usage({
    description: "Interactive setup wizard — get from zero to running in under 10 minutes",
    examples: [["Run the setup wizard", "iris init"]],
  });

  async execute(): Promise<number> {
    p.intro("🌸  Iris Setup Wizard");

    // ── 1. channels ──────────────────────────────────────────────────────────

    const channelsResult = await p.multiselect<string>({
      message: "Which channels do you want to enable?",
      options: [
        { value: "telegram", label: "Telegram", hint: "requires bot token from @BotFather" },
        { value: "whatsapp", label: "WhatsApp", hint: "QR-code pairing, no token needed" },
        { value: "discord", label: "Discord", hint: "requires bot token from Discord Dev Portal" },
        { value: "slack", label: "Slack", hint: "requires App-Level & Bot tokens" },
      ],
      required: true,
    });

    if (p.isCancel(channelsResult)) {
      p.cancel("Setup cancelled.");
      return 1;
    }

    const channels = channelsResult as string[];

    // ── 2. per-channel tokens ─────────────────────────────────────────────────

    const env: Record<string, string> = {};
    const channelConfig: Record<string, unknown> = {};

    if (channels.includes("telegram")) {
      const token = await p.text({
        message: "Enter your Telegram bot token:",
        placeholder: "123456:ABC-DEF…  (get one from @BotFather)",
        validate: (v) => (v.trim() === "" ? "Token cannot be empty" : undefined),
      });
      if (p.isCancel(token)) { p.cancel("Setup cancelled."); return 1; }

      const spin = p.spinner();
      spin.start("Validating Telegram token…");
      const ok = await validateTelegramToken(token as string);
      // Design: token is saved even when validation fails (network may be down during setup,
      // or the token may be valid but the API is temporarily unreachable). The user can correct
      // the token later in iris.config.json / .env without re-running the wizard.
      spin.stop(ok ? "✓ Token valid" : "⚠ Could not validate — saved anyway");

      env["TELEGRAM_BOT_TOKEN"] = token as string;
      channelConfig["telegram"] = {
        type: "telegram",
        enabled: true,
        token: "${env:TELEGRAM_BOT_TOKEN}",
      };
    }

    if (channels.includes("whatsapp")) {
      channelConfig["whatsapp"] = { type: "whatsapp", enabled: true };
      p.note("WhatsApp uses QR-code pairing on first run — no token needed.", "WhatsApp");
    }

    if (channels.includes("discord")) {
      const token = await p.text({
        message: "Enter your Discord bot token:",
        placeholder: "MTI3… (Discord Developer Portal → Bot → Token)",
        validate: (v) => (v.trim() === "" ? "Token cannot be empty" : undefined),
      });
      if (p.isCancel(token)) { p.cancel("Setup cancelled."); return 1; }

      const spin = p.spinner();
      spin.start("Validating Discord token…");
      const ok = await validateDiscordToken(token as string);
      // Same design as Telegram: save regardless of validation outcome (network resilience).
      spin.stop(ok ? "✓ Token valid" : "⚠ Could not validate — saved anyway");

      env["DISCORD_BOT_TOKEN"] = token as string;
      channelConfig["discord"] = {
        type: "discord",
        enabled: true,
        token: "${env:DISCORD_BOT_TOKEN}",
      };
    }

    if (channels.includes("slack")) {
      const appToken = await p.text({
        message: "Enter your Slack App-Level token (xapp-…):",
        validate: (v) => (v.trim() === "" ? "Token cannot be empty" : undefined),
      });
      if (p.isCancel(appToken)) { p.cancel("Setup cancelled."); return 1; }

      const botToken = await p.text({
        message: "Enter your Slack Bot token (xoxb-…):",
        validate: (v) => (v.trim() === "" ? "Token cannot be empty" : undefined),
      });
      if (p.isCancel(botToken)) { p.cancel("Setup cancelled."); return 1; }

      const spin = p.spinner();
      spin.start("Validating Slack App token…");
      const ok = await validateSlackAppToken(appToken as string);
      // Same design as Telegram: save regardless of validation outcome (network resilience).
      spin.stop(ok ? "✓ App token valid" : "⚠ Could not validate — saved anyway");

      env["SLACK_APP_TOKEN"] = appToken as string;
      env["SLACK_BOT_TOKEN"] = botToken as string;
      channelConfig["slack"] = {
        type: "slack",
        enabled: true,
        appToken: "${env:SLACK_APP_TOKEN}",
        botToken: "${env:SLACK_BOT_TOKEN}",
      };
    }

    // ── 3. AI model ───────────────────────────────────────────────────────────

    const modelResult = await p.select<string>({
      message: "Which AI model do you want to use?",
      options: [
        {
          value: "openrouter/arcee-ai/arcee-spotlight:free",
          label: "Arcee Spotlight (free)",
          hint: "OpenRouter — no API key required",
        },
        {
          value: "openrouter/arcee-ai/trinity-large-preview:free",
          label: "Arcee Trinity Large (free)",
          hint: "OpenRouter — no API key required",
        },
        {
          value: "openrouter/arcee-ai/trinity-mini:free",
          label: "Arcee Trinity Mini (free)",
          hint: "OpenRouter — no API key required",
        },
        {
          value: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
          label: "Llama 3.3 70B Instruct (free)",
          hint: "OpenRouter — no API key required",
        },
        {
          value: "openrouter/mistralai/mistral-7b-instruct:free",
          label: "Mistral 7B Instruct (free)",
          hint: "OpenRouter — no API key required",
        },
        { value: "__custom__", label: "Custom", hint: "enter model identifier manually" },
      ],
    });

    if (p.isCancel(modelResult)) { p.cancel("Setup cancelled."); return 1; }

    let finalModel = modelResult as string;
    if (finalModel === "__custom__") {
      const customModel = await p.text({
        message: "Enter model identifier:",
        placeholder: "e.g. openrouter/meta-llama/llama-3-8b-instruct:free",
        validate: (v) => (v.trim() === "" ? "Cannot be empty" : undefined),
      });
      if (p.isCancel(customModel)) { p.cancel("Setup cancelled."); return 1; }
      finalModel = customModel as string;
    }

    if (finalModel.startsWith("openai/")) {
      const apiKey = await p.text({
        message: "Enter your OpenAI API key:",
        validate: (v) => (v.trim() === "" ? "Key cannot be empty" : undefined),
      });
      if (p.isCancel(apiKey)) { p.cancel("Setup cancelled."); return 1; }
      env["OPENAI_API_KEY"] = apiKey as string;
    } else if (finalModel.startsWith("anthropic/")) {
      const apiKey = await p.text({
        message: "Enter your Anthropic API key:",
        validate: (v) => (v.trim() === "" ? "Key cannot be empty" : undefined),
      });
      if (p.isCancel(apiKey)) { p.cancel("Setup cancelled."); return 1; }
      env["ANTHROPIC_API_KEY"] = apiKey as string;
    }

    // ── 4. OpenCode CLI ───────────────────────────────────────────────────────

    const ocPath = detectOpenCode();
    if (ocPath) {
      p.note(`Detected at ${ocPath}`, "OpenCode CLI ✓");
    } else {
      const installOc = await p.confirm({
        message: "OpenCode CLI not found. Install it now? (npm i -g opencode-ai)",
        initialValue: true,
      });
      if (p.isCancel(installOc)) { p.cancel("Setup cancelled."); return 1; }

      if (installOc) {
        const spin = p.spinner();
        spin.start("Installing OpenCode CLI…");
        try {
          execSync("npm install -g opencode-ai", { stdio: "pipe" });
          spin.stop("✓ OpenCode CLI installed");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const hint =
            msg.includes("EACCES") || msg.includes("permission")
              ? "Permission denied. Try: sudo npm i -g opencode-ai"
              : "Run manually: npm i -g opencode-ai";
          spin.stop(`⚠ Install failed — ${hint}`);
        }
      } else {
        p.note("Install later with: npm i -g opencode-ai", "Skipped");
      }
    }

    // ── 5. generate config ────────────────────────────────────────────────────

    const configPath = resolve(process.cwd(), "iris.config.json");
    const envPath = resolve(process.cwd(), ".env");

    let baseConfig: Record<string, unknown> = {};
    try {
      const examplePath = resolve(process.cwd(), "iris.config.example.json");
      await access(examplePath);
      baseConfig = JSON.parse(await readFile(examplePath, "utf-8")) as Record<string, unknown>;
    } catch {
      /* start fresh if no example file */
    }

    const config = {
      ...baseConfig,
      channels: channelConfig,
      models: {
        ...(typeof baseConfig.models === "object" && baseConfig.models !== null
          ? (baseConfig.models as Record<string, unknown>)
          : {}),
        primary: finalModel,
        small: finalModel,
      },
    };

    const spin2 = p.spinner();
    spin2.start("Writing config files…");

    await writeFile(configPath, JSON.stringify(config, null, 2) + os.EOL, "utf-8");

    const envLines = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join(os.EOL);
    if (envLines) {
      await writeFile(envPath, envLines + os.EOL, "utf-8");
    }

    spin2.stop("Done");

    // ── 6. summary ────────────────────────────────────────────────────────────

    p.note(
      [
        `✓ iris.config.json  →  ${configPath}`,
        envLines ? `✓ .env              →  ${envPath}` : "",
        "",
        "Next step:",
        "  iris gateway run",
      ]
        .filter(Boolean)
        .join("\n"),
      "Setup complete 🎉"
    );

    p.outro("You're ready. Run: iris gateway run");
    return 0;
  }
}
