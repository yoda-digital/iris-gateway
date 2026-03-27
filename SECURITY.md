# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.14.x  | Yes       |
| < 1.14  | No        |

We patch security issues in the latest minor release only.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email: **security@yoda.digital**

Include:
- Description of the vulnerability
- Steps to reproduce
- Which component is affected (channel adapter, tool executor, vault, etc.)
- Your assessment of severity

We'll acknowledge within 48 hours and provide a fix timeline within 7 days.

## Security Architecture

iris-gateway handles messaging across multiple channels. Key security boundaries:

- **Master Policy** (`policy.json`): structural ceiling for tool access and agent permissions. Immutable at runtime — config changes require restart.
- **Tool Access Control**: per-tool allow/deny lists. Tools like `exec` are sandboxed by default.
- **Vault Encryption**: SQLite database stores conversation history. File-level permissions enforced.
- **Channel Isolation**: each channel adapter runs with its own credential scope. No cross-channel token leakage.
- **No Paid Model Lock-in**: free-tier models only by default. No API keys required for base functionality.

## Scope

In scope:
- Remote code execution via tool executor
- Authentication bypass on any channel
- Cross-channel data leakage
- Vault data exposure
- Dependency vulnerabilities with known exploits

Out of scope:
- Denial of service (rate limiting is the user's responsibility)
- Social engineering of the AI model
- Issues in third-party channel APIs (Telegram, WhatsApp, etc.)
