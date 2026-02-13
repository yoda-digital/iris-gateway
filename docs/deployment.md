# Deployment Guide

This guide covers deploying Iris in production environments, including Docker, manual VPS deployment, reverse proxy configuration, and monitoring.

## Docker Deployment

### Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --production

# Copy compiled output and config
COPY --from=builder /app/dist/ ./dist/
COPY iris.config.json ./

# State directory for persistent data (sessions, allowlists, pairing codes)
VOLUME /root/.iris

EXPOSE 19876

CMD ["node", "dist/index.js", "gateway", "run"]
```

### Docker Compose

Create a `docker-compose.yml`:

```yaml
version: "3.8"

services:
  iris:
    build: .
    container_name: iris-gateway
    restart: unless-stopped
    ports:
      - "19876:19876"
    env_file:
      - .env
    volumes:
      - iris-state:/root/.iris
      - ./iris.config.json:/app/iris.config.json:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:19876/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  iris-state:
```

### Build and Run

```bash
# Build the image
docker compose build

# Start in the background
docker compose up -d

# View logs
docker compose logs -f iris

# Stop
docker compose down
```

### Passing Secrets

There are two approaches for providing secrets to the container:

**Option A: Environment file** (recommended for development)

Create a `.env` file with your tokens and pass it via `env_file` in `docker-compose.yml` or `--env-file` with `docker run`.

**Option B: Docker secrets or external secret manager** (recommended for production)

Mount secrets as files or use your orchestrator's secret management (Kubernetes Secrets, Docker Swarm Secrets, AWS Secrets Manager, etc.). Adjust `iris.config.json` to reference the appropriate environment variables.

## Manual Deployment on VPS

### 1. System Requirements

- Ubuntu 22.04+ or Debian 12+ (any Linux with Node.js 22 support)
- Node.js >= 22 (use [NodeSource](https://github.com/nodesource/distributions) or [nvm](https://github.com/nvm-sh/nvm))
- At least 512 MB RAM
- Outbound internet access for messaging platform APIs

### 2. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node --version  # Should print v22.x.x
```

### 3. Clone and Build

```bash
cd /opt
git clone <repo-url> iris
cd iris
npm ci
npm run build
```

### 4. Configure

```bash
cp iris.config.example.json iris.config.json
cp .env.example .env
# Edit .env with your tokens
# Edit iris.config.json to enable desired channels
```

### 5. Create a systemd Service

Create `/etc/systemd/system/iris.service`:

```ini
[Unit]
Description=Iris AI Messaging Gateway
After=network.target

[Service]
Type=simple
User=iris
Group=iris
WorkingDirectory=/opt/iris
ExecStart=/usr/bin/node --env-file=/opt/iris/.env dist/index.js gateway run
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/iris/.iris

# Environment
Environment=NODE_ENV=production
Environment=IRIS_STATE_DIR=/home/iris/.iris

[Install]
WantedBy=multi-user.target
```

### 6. Create a Dedicated User

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin iris
sudo mkdir -p /home/iris/.iris
sudo chown iris:iris /home/iris/.iris
```

### 7. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable iris
sudo systemctl start iris

# Check status
sudo systemctl status iris

# View logs
sudo journalctl -u iris -f
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | If Telegram enabled | Bot token from @BotFather |
| `DISCORD_BOT_TOKEN` | If Discord enabled | Bot token from Discord Developer Portal |
| `SLACK_APP_TOKEN` | If Slack enabled | App-level token (starts with `xapp-`) from Slack App Dashboard |
| `SLACK_BOT_TOKEN` | If Slack enabled | Bot user OAuth token (starts with `xoxb-`) from Slack App Dashboard |
| `OPENROUTER_API_KEY` | If using OpenRouter | API key for OpenRouter (for free/paid AI models) |
| `IRIS_STATE_DIR` | No | Override state directory (default: `~/.iris`) |
| `IRIS_CONFIG_PATH` | No | Override config file path (default: `./iris.config.json`) |

The state directory (`~/.iris` by default) stores:

- Session mappings (channel chats to OpenCode sessions)
- Allowlist entries (approved users per channel)
- Pairing codes (pending approval requests)
- Cron job state

## Reverse Proxy Setup

If you want to expose the health/metrics endpoints externally (for monitoring dashboards, load balancers, etc.), use a reverse proxy. The gateway listens on `127.0.0.1:19876` by default.

### nginx Example

```nginx
upstream iris_gateway {
    server 127.0.0.1:19876;
}

server {
    listen 443 ssl;
    server_name iris.example.com;

    ssl_certificate /etc/letsencrypt/live/iris.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/iris.example.com/privkey.pem;

    # Health and metrics endpoints
    location /health {
        proxy_pass http://iris_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ready {
        proxy_pass http://iris_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /metrics {
        proxy_pass http://iris_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Restrict metrics to internal networks
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
    }

    location /channels {
        proxy_pass http://iris_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Block everything else
    location / {
        return 404;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name iris.example.com;
    return 301 https://$host$request_uri;
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/iris /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Binding to All Interfaces

If you need the gateway to accept connections from outside localhost (for example, inside a Docker network), change the hostname in `iris.config.json`:

```json
{
  "gateway": {
    "port": 19876,
    "hostname": "0.0.0.0"
  }
}
```

## Monitoring

### Health Endpoint

**GET /health**

Returns overall gateway health status with system diagnostics.

```bash
curl http://127.0.0.1:19876/health
```

Response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 86400000,
  "uptimeHuman": "1d 0h",
  "channels": [
    {
      "id": "telegram",
      "label": "Telegram",
      "capabilities": {
        "media": true,
        "edit": true,
        "delete": true,
        "reaction": true
      }
    }
  ],
  "opencode": {
    "healthy": true
  },
  "system": {
    "memoryMB": {
      "rss": 85,
      "heapUsed": 42,
      "heapTotal": 64
    },
    "nodeVersion": "v22.0.0",
    "platform": "linux",
    "pid": 12345
  }
}
```

Status values:

- `ok` -- OpenCode is healthy and at least one channel is connected.
- `degraded` -- OpenCode is unreachable or no channels are connected.

### Readiness Endpoint

**GET /ready**

Returns whether the gateway is ready to process messages. Suitable for Kubernetes readiness probes or load balancer health checks.

```bash
curl http://127.0.0.1:19876/ready
```

Responds with HTTP 200 if ready, HTTP 503 if not:

```json
{
  "ready": true,
  "channels": 2
}
```

### Channels Endpoint

**GET /channels**

Lists all currently connected channel adapters and their capabilities.

```bash
curl http://127.0.0.1:19876/channels
```

### Metrics Endpoint

**GET /metrics**

Prometheus-compatible metrics in text format.

```bash
curl http://127.0.0.1:19876/metrics
```

Response:

```
# HELP iris_uptime_seconds Gateway uptime in seconds
# TYPE iris_uptime_seconds gauge
iris_uptime_seconds 3600
# HELP iris_channels_connected Number of connected channels
# TYPE iris_channels_connected gauge
iris_channels_connected 2
# HELP iris_memory_rss_bytes RSS memory in bytes
# TYPE iris_memory_rss_bytes gauge
iris_memory_rss_bytes 89128960
# HELP iris_memory_heap_used_bytes Heap used in bytes
# TYPE iris_memory_heap_used_bytes gauge
iris_memory_heap_used_bytes 44040192
```

### Prometheus Configuration

Add a scrape target to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: "iris"
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:19876"]
```

### Alerting Examples

Prometheus alerting rules:

```yaml
groups:
  - name: iris
    rules:
      - alert: IrisDown
        expr: up{job="iris"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Iris gateway is down"

      - alert: IrisNoChannels
        expr: iris_channels_connected == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "No messaging channels connected to Iris"

      - alert: IrisHighMemory
        expr: iris_memory_rss_bytes > 500 * 1024 * 1024
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Iris RSS memory usage exceeds 500 MB"
```

## Troubleshooting

### Gateway Fails to Start

**Symptom**: `Failed to start gateway` error on startup.

**Check**:

1. Run `iris doctor` to identify configuration or connectivity issues.
2. Validate your config: `iris config validate`.
3. Ensure all referenced environment variables are set: `${env:VAR}` in config will fail if the variable is missing.
4. Check that the state directory is writable (default: `~/.iris`).

### Channel Fails to Connect

**Symptom**: `Failed to start channel` or `Channel disconnected` in logs.

**Check**:

- **Telegram**: Verify `TELEGRAM_BOT_TOKEN` is correct. Test with `curl https://api.telegram.org/bot<TOKEN>/getMe`.
- **Discord**: Verify `DISCORD_BOT_TOKEN` is correct and the bot has the required intents (Message Content, Guild Messages) enabled in the Discord Developer Portal.
- **Slack**: Verify both `SLACK_APP_TOKEN` (starts with `xapp-`) and `SLACK_BOT_TOKEN` (starts with `xoxb-`) are set. Ensure Socket Mode is enabled in the Slack App Dashboard.
- **WhatsApp**: WhatsApp uses the Baileys library and requires a QR code scan on first connection. Check the logs for the QR code.

### OpenCode Not Reachable

**Symptom**: `/health` shows `"opencode": { "healthy": false }` or `iris doctor` reports `[FAIL] OpenCode not reachable`.

**Check**:

1. If `autoSpawn` is `true`, Iris will start its own OpenCode server. Ensure the `opencode.port` (default 4096) is available.
2. If `autoSpawn` is `false`, ensure an OpenCode server is running at the configured hostname and port.
3. Test connectivity: `curl http://127.0.0.1:4096/health`.

### Rate Limiting Issues

**Symptom**: Users report "Rate limited. Try again in Xs" responses.

**Fix**: Increase the limits in `iris.config.json`:

```json
{
  "security": {
    "rateLimitPerMinute": 60,
    "rateLimitPerHour": 600
  }
}
```

### Pairing Codes Not Working

**Symptom**: Users receive pairing codes but `iris pairing approve <code>` says "No pending pairing request found."

**Check**:

1. Pairing codes expire after `pairingCodeTtlMs` (default: 1 hour). Ask the user to send another message to get a fresh code.
2. Run `iris pairing list` to see all pending codes.
3. Ensure the state directory is the same for both the gateway process and the CLI commands (check `IRIS_STATE_DIR`).

### Log Configuration

Enable debug logging for more detail:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

Write logs to a file:

```json
{
  "logging": {
    "level": "info",
    "file": "/var/log/iris/gateway.log",
    "json": true
  }
}
```

For human-readable logs during development, pipe through `pino-pretty`:

```bash
npm run dev | npx pino-pretty
```
