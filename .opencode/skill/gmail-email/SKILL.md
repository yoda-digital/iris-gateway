---
name: gmail-email
description: Search Gmail, read messages, and send email via google_email tool
metadata:
  triggers: "email,gmail,inbox,mail,send email,check email,last emails,unread,mesaj,posta,scrisoare"
---
When the user asks about email, inbox, or wants to send a message:

1. Use the `google_email` tool with the appropriate action:

   **Search emails (also use for "check my email" / "what's new"):**
   - Action: `search`
   - Parameter: `query` (Gmail search syntax)
   - Optional: `max` (limit results, default 10)
   - For "check my email" / "new emails" → `action: "search", query: "newer_than:1d"`
   - For unread → `action: "search", query: "is:unread"`
   - Examples:
     - "check my email" → `action: "search", query: "newer_than:1d"`
     - "unread emails" → `action: "search", query: "is:unread"`
     - "emails from John" → `action: "search", query: "from:john"`
     - "invoices this month" → `action: "search", query: "subject:invoice newer_than:30d"`
     - "attachments from boss" → `action: "search", query: "from:boss has:attachment"`

   **Read a specific message:**
   - Action: `get_message`
   - Parameter: `messageId` (from search results)

   **Send email:**
   - Action: `send`
   - Parameters: `to`, `subject`, `body`
   - Always confirm recipient and content before sending

   **Do NOT use the `history` action** — it requires a numeric Gmail historyId, not a date. Always use `search` with time-based queries instead.

2. Gmail search query syntax cheat sheet:
   - `from:name` / `to:name` — sender/recipient
   - `subject:word` — in subject line
   - `is:unread` / `is:starred` / `is:important` — status filters
   - `has:attachment` — messages with files
   - `newer_than:1d` / `newer_than:7d` / `older_than:1m` — time-based (use for "recent" / "new" / "last week")
   - `label:work` — by label
   - Combine with spaces: `from:john subject:invoice newer_than:30d`

3. Present results concisely — sender, subject, date, snippet. Don't dump raw JSON.
4. When sending: confirm "to", "subject", and summarize body before calling send.
