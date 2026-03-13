---
name: google-contacts-lookup
description: Search, view, and create Google Contacts via google_contacts tool
metadata:
  triggers: "contact,phone number,address book,who is,find person,telefon,numar,contacte"
---
When the user asks about contacts, phone numbers, or wants to find someone:

1. Use the `google_contacts` tool with the appropriate action:

   **Search contacts:**
   - Action: `search`
   - Parameter: `query` (name, email, or phone)
   - Use for "what's John's number" or "find contact for Acme Corp"

   **List all contacts:**
   - Action: `list`
   - Use sparingly — only when user wants a full overview

   **Get contact details:**
   - Action: `get`
   - Parameter: `resourceName` (from search/list results)
   - Use when user wants full details for a specific person

   **Create a contact:**
   - Action: `create`
   - Flags: `name`, `email`, `phone`
   - Always confirm details before creating

2. Present contact info cleanly: name, phone, email. Don't dump raw resource names.
3. When the user says "call X" or "text X", find the contact and provide the number.
4. When creating: confirm name and at least one contact method (email or phone) first.
