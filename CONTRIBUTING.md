# CONTRIBUTING.md

Read this before touching the code. All of it.

---

## The Non-Negotiables

These are not suggestions. They are rules. Violating them gets your PR rejected, regardless of how clever the implementation is.

### 1. No PR merged with failing tests. Ever.

`pnpm test` must exit 0. No exceptions. No "I'll fix the tests in the next PR." No "it's a flaky test." Fix it or delete it. But it will not be merged red.

```bash
pnpm test  # This must exit 0 before you open a PR
```

### 2. No file over 500 lines.

If you're writing a file that exceeds 500 lines, you haven't decomposed the problem correctly. Stop. Think about separation of concerns. Split the file. Come back with smaller, focused modules.

The current codebase has violations — they're tracked as P0/P1 issues. We're fixing them. Don't add new ones.

```bash
# Check before committing:
find src .opencode/plugin -name "*.ts" | xargs wc -l | sort -n | tail -20
```

### 3. Conventional commits. Always.

semantic-release runs on every push to main. It reads your commits to determine version bumps and generate changelogs. Break the format, break the release pipeline.

```
feat(intelligence): add cross-channel activity resolver
fix(whatsapp): handle silent connection drop in reconnect loop
refactor(bridge): split tool-server into domain routers
docs(api): add tool-api.md endpoint documentation
test(pipeline): fix sendAndWait mock in integration tests
chore(deps): update baileys to 6.7.0
```

Format: `type(scope): description`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`

Breaking changes: add `!` after type or `BREAKING CHANGE:` in body.

### 4. Every new feature needs tests. Coverage stays at or above 75%.

Ship tests with your feature. Not in a follow-up PR. Not "when I have time." With the feature. If you can't write tests for it, you don't understand it well enough to ship it.

```bash
pnpm test --coverage  # Check coverage before pushing
```

### 5. No model identifiers in source code. Config only.

The git log is full of `fix(model): switch to X`. This ends now. Model identifiers belong in `iris.config.json` under the `models` section. The application reads from config at runtime.

If your PR contains a model name string anywhere in `src/` or `.opencode/plugin/`, it gets rejected.

### 6. "Known failures" is not a category.

If a test is failing, you have two choices:
- Fix it
- Delete it (with justification in commit message)

Documenting a test failure in README as "known" is not a third option. It normalizes brokenness. It erodes trust in the test suite. Don't do it.

---

## Branch Naming

```
feature/short-description     # New features
fix/issue-N-short-description # Bug fixes (include issue number)
refactor/component-name       # Refactoring
docs/what-you-documented      # Documentation only
test/what-you-tested          # Tests only
```

Examples:
```
fix/issue-4-sendandwait-mock
feature/prometheus-metrics
refactor/tool-server-routers
```

---

## PR Process

### Before Opening a PR

1. `pnpm test` exits 0. Non-negotiable.
2. `pnpm build` succeeds. Non-negotiable.
3. No files over 500 lines in your diff. Check it.
4. Commit messages are conventional. Every single one.
5. If adding a feature: coverage hasn't dropped below 75%.

### What Reviewers Check

- **Correctness:** Does it actually solve the problem it claims to solve?
- **Tests:** Are there tests? Do they cover the edge cases?
- **Size:** Are any files approaching or over 500 lines?
- **Architecture:** Does it follow the layering rules in VISION.md?
- **Config:** Any model identifiers snuck in?
- **Commit messages:** Are they conventional?

### What Gets Rejected Immediately

No discussion, no feedback loop — just rejected:
- Failing tests
- Files over 500 lines introduced in the diff
- Model identifiers in source code
- Non-conventional commit messages on main
- PRs without tests for new features
- PRs that add "known failures" to documentation

---

## Architecture Principles

This is the short version. Read [VISION.md](./VISION.md) for the full picture.

**Single Responsibility:** One file, one job. Not one job plus helpers.

**Model Selection = Config:** `iris.config.json` owns model names. Code doesn't.

**Bridge Architecture:** Gateway process and plugin process communicate via HTTP on port 19877 only. No shared imports across the process boundary.

**Domain Ownership:** Each subsystem owns its data store. Shared database ≠ shared store class.

**Dependency Direction:**
```
channels/ → gateway core
intelligence/ → gateway core
bridge/ → gateway core + intelligence + channels
gateway/ → everything (composition root)
plugin/ → nothing (reads via HTTP only)
```

No circular dependencies. Ever.

---

## Development Setup

```bash
# Clone and install
git clone https://github.com/yoda-digital/iris-gateway
cd iris-gateway
pnpm install

# Run tests
pnpm test

# Run with coverage
pnpm test --coverage

# Build
pnpm build

# Start gateway (requires iris.config.json)
pnpm start
```

---

*This file is law. If you think something here should change, open an issue. Don't just ignore it.*

## Model Configuration — Never in Code

Model identifiers (LLM model names/IDs) are configured in **`.opencode/opencode.json`** only.

### Rules

- **Never** hardcode model identifiers in TypeScript files
- **Never** change models via a code commit — edit config and restart
- The single source of truth for model selection: `.opencode/opencode.json` keys `"model"` and `"small_model"`

### How to Switch Models

1. Edit `.opencode/opencode.json`:
   ```json
   {
     "model": "openrouter/your-new-model",
     "small_model": "openrouter/your-small-model"
   }
   ```
2. Restart the gateway — no code change, no commit needed.

### Reference Config

See `iris.config.example.json` → `"models"` section for the canonical list of model roles and their current assignments.

### Why This Matters

The git log shows 8+ commits that are just `fix(model): switch to X`. These clutter history, make bisects harder, and mix infrastructure concerns with code changes. Config belongs in config files, not in commits.

## Publishing to npm

Releases are automated via `semantic-release`. To enable publishing:

1. Generate an npm access token with **Automation** type at [npmjs.com](https://www.npmjs.com/settings)
2. Add it as `NPM_TOKEN` in GitHub repo Settings → Secrets and variables → Actions

Once set, every merge to `main` that triggers a release will publish automatically.
