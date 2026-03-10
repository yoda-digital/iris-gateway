# Multi-Instance Deployment

iris-gateway supports running multiple instances against the same SQLite database via WAL mode + advisory leader election.

## How It Works

### Instance Identity

Each instance gets a unique ID at startup:

> ⚠️ **`IRIS_INSTANCE_ID` must be unique across all running instances.** Two instances sharing the same ID will both believe they are the leader, causing split-brain. When using auto-generated UUIDs (default), uniqueness is guaranteed. When setting explicit IDs, you are responsible for ensuring no two instances share the same value.

```bash
# Auto-generated UUID (default)
pnpm start

# Explicit ID (recommended for debugging)
IRIS_INSTANCE_ID=node-1 pnpm start
IRIS_INSTANCE_ID=node-2 pnpm start
```

### Leader Election

A single-row `instance_locks` table acts as a distributed mutex:

- Lock TTL: 10 seconds
- Renewal interval: 4 seconds (2.5× safety margin)
- Stale lock takeover: automatic on TTL expiry

**Singleton operations** (proactive engine, intelligence sweep) only run on the leader. All other operations (message routing, tool calls, channel adapters) run on every instance.

### Session Affinity

Session affinity is advisory — consumers may use the `instance.id` field from the `/health` endpoint to route requests. No hard affinity is enforced at the gateway level; SQLite WAL handles concurrent writes safely.

## Health Endpoint

`GET /health` now includes instance metadata:

```json
{
  "instance": {
    "id": "node-1",
    "leader": true,
    "activeInstances": ["node-1", "node-2"]
  }
}
```

## SQLite Concurrency Notes

WAL mode (already enabled) allows:
- 1 concurrent writer + N concurrent readers
- No write conflicts under normal load

For very high write throughput (>100 concurrent tool calls per second), consider upgrading to [libSQL/Turso](https://turso.tech) for multi-writer support. The coordinator interface is designed to be swappable.

## Docker Compose Example

```yaml
services:
  iris-1:
    image: iris-gateway
    environment:
      IRIS_INSTANCE_ID: iris-1
    volumes:
      - ./data:/data
    ports:
      - "19876:19876"

  iris-2:
    image: iris-gateway
    environment:
      IRIS_INSTANCE_ID: iris-2
    volumes:
      - ./data:/data  # same data dir = same SQLite file
    ports:
      - "19878:19876"
```

## Limitations

- Leader election requires both instances to share the **same SQLite file** via a **local shared volume only**
- ⚠️ **SQLite over NFS is NOT supported** — file locking over network filesystems (NFS, CIFS, SMB) is unreliable and will cause data corruption. Use only local bind mounts (e.g. Docker `--mount type=bind`) on the same host
- Ephemeral containers that recreate the volume will not coordinate correctly — use persistent volumes
- No cross-host network coordination (by design — SQLite only)
