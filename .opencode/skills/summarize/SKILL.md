---
name: summarize
description: Summarize conversation and extract key facts to vault
---
When asked to summarize the current conversation:

1. Review the conversation so far
2. Extract key facts and insights:
   - User preferences mentioned
   - Decisions made
   - Action items discussed
   - Interesting facts shared
3. For each extracted fact, use `vault_remember`:
   - type: "fact" for objective information
   - type: "preference" for user preferences
   - type: "insight" for derived conclusions
   - type: "event" for things that happened
4. Provide a concise summary to the user
5. Confirm what was stored: "I've noted [N] things for future reference."
