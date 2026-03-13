---
name: web-search
description: Guide web search using Tavily MCP server
metadata:
  triggers: "search,look up,find online,google,search the web,cauta"
---
When asked to search the web:

1. Check if Tavily MCP server is available
2. If available:
   - Use the tavily search tool to find relevant results
   - Summarize the top results concisely
   - Cite sources when sharing information
3. If not available:
   - Explain: "Web search isn't currently configured. I can only use my built-in knowledge."
   - Offer to help with what you already know
4. Keep search result summaries under 500 characters
5. Always indicate when information comes from web search vs your knowledge
