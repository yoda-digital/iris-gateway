---
name: status
description: Show Iris gateway status
---
When the /status command is invoked:
1. Use the list_channels tool to get active channel information
2. Format a concise status report showing:
   - Which channels are connected
   - How long the gateway has been running
   - Current session count
3. Keep it brief — this is a quick check
