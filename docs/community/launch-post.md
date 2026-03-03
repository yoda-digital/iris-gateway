# Reddit r/selfhosted Launch Post

**Title:** Iris – self-hosted AI assistant gateway for Telegram/WhatsApp/Discord (free models, intelligence layer)

---

I've been building this for a while and finally feel good enough about it to share. Iris is a self-hosted AI gateway that connects to your messaging apps (Telegram, WhatsApp, Discord, Slack) and gives you a persistent AI assistant that actually learns who you are over time.

The pitch: you run it on your own machine, it uses free AI models from OpenRouter (Arcee Trinity large+mini work well for both chat and tool calling on the free tier), and it builds a growing memory of your preferences, goals, and ongoing projects — without you ever explicitly "teaching" it anything. You just talk to it like you would any assistant.

## What makes it different

**Free models, actually.** Most self-hosted AI setups still need you to pay for GPT-4 or Claude. Iris works on OpenRouter's free tier. Arcee Trinity handles tool calling well enough for most tasks. You can swap in any OpenRouter model via config.

**Intelligence layer** — this is the part that surprised me when I built it. There are seven deterministic subsystems (no LLM cost) that run in the background:
- It detects your language and timezone from the first message, without you saying anything
- It tracks "memory arcs" — ongoing situations in your life that it threads across conversations
- Goal tracking with a state machine — you mention a project once, it stores it, follows up later
- Engagement tracking per category (work/health/hobby/etc.) — it learns when and how to nudge you
- Self-tuning heartbeat with trend detection — it knows when it's degrading before you do

All of this is SQLite + Node.js, zero LLM calls. The AI just gets the assembled context injected into every system prompt.

**40+ built-in tools** — calendar (via gog), Gmail, contacts, tasks, Drive. Plus web search, memory search, send media, manage skills/agents, canvas UI. Extensible via plugins.

## Quick start

```bash
git clone https://github.com/yoda-digital/iris-gateway.git iris && cd iris
pnpm install
cp iris.config.example.json iris.config.json
echo "TELEGRAM_BOT_TOKEN=your_token" > .env
pnpm run build && pnpm start
curl http://127.0.0.1:19876/health
```

Or with Docker:

```bash
cp iris.config.example.json iris.config.json
echo "TELEGRAM_BOT_TOKEN=your_token" > .env
docker-compose up -d
```

Get a Telegram bot token from @BotFather. Get a free OpenRouter key at openrouter.ai/keys. That's genuinely it.

## What I use it for

Mostly as a personal assistant that I can reach from any device without opening a browser. I ask it things from my phone, it remembers context, it follows up on things I mentioned days ago. I also use it for server alerts — cron jobs send it messages, it summarizes them intelligently rather than dumping raw text at me.

531 tests across 73 test files. It's been running on my server for a few months without issues.

## Contribute

Repo: https://github.com/yoda-digital/iris-gateway

If you try it and hit issues, open a bug. If you add a channel adapter or CLI tool integration, PRs are welcome. The plugin SDK is documented — adding a new tool is maybe 30 lines. CONTRIBUTING.md has the details.

Happy to answer questions here.
