# ---- Build stage ----
FROM node:22-slim AS build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy source code and TypeScript config
COPY src/ src/
COPY tsconfig.json ./

# Build TypeScript
RUN pnpm build

# Prune devDependencies for the runtime image
RUN pnpm prune --prod

# ---- Runtime stage ----
FROM node:22-slim AS runtime

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system iris && useradd --system --gid iris --create-home iris

WORKDIR /app

# Copy built artifacts and production dependencies from build stage
COPY --from=build --chown=iris:iris /app/dist/ dist/
COPY --from=build --chown=iris:iris /app/node_modules/ node_modules/
COPY --from=build --chown=iris:iris /app/package.json package.json

# Create state directory
RUN mkdir -p /home/iris/.iris && chown -R iris:iris /home/iris/.iris

# Switch to non-root user
USER iris

# Expose gateway ports: health/API, tool-server, media-server
EXPOSE 19876 19877 19878

CMD ["node", "dist/index.js", "gateway", "run"]
