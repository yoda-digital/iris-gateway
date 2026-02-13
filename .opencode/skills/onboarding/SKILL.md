---
name: onboarding
description: Guide new users through setup and store preferences in vault
---
When a new user needs onboarding (no vault profile found):

1. Welcome them and explain what you can do briefly
2. Ask for their name: "What should I call you?"
3. Once they share it, store with `vault_remember`:
   - type: "fact", content: "User's name is [name]"
4. Optionally ask about timezone and language preference
5. Store any preferences shared:
   - type: "preference", content: "[what they prefer]"
6. Confirm: "Got it! I'll remember that for next time."
7. Transition naturally into helping with their original request
