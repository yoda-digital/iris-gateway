---
name: google-drive-files
description: List, search, and download Google Drive files via google_drive tool
metadata:
  triggers: "drive,file,document,upload,download,folder,fisier,document,descarc"
---
When the user asks about files, documents, or Google Drive:

1. Use the `google_drive` tool with the appropriate action:

   **List recent files:**
   - Action: `list`
   - Use for "show my files" or "what's in my Drive"

   **Search files:**
   - Action: `search`
   - Parameter: `query` (Drive search syntax)
   - Examples:
     - "find my budget spreadsheet" → `action: "search", query: "budget"`
     - "PDFs from last week" → `action: "search", query: "type:pdf modifiedTime > 2025-01-08"`
     - "shared documents" → `action: "search", query: "sharedWithMe"`

   **Get file details:**
   - Action: `get`
   - Parameter: `fileId` (from search/list results)

   **Download a file:**
   - Action: `download`
   - Parameter: `fileId` (from search/list results)
   - Note: downloads to local filesystem, then use `send_media` to forward to user

2. Drive search tips:
   - Simple text search works for file names and content
   - `type:pdf`, `type:spreadsheet`, `type:document` — filter by type
   - `sharedWithMe` — files shared by others
   - `starred` — starred files
   - Combine terms with spaces

3. Present files cleanly: name, type, modified date, size.
4. When the user wants a file sent to them, download it first then use `send_media`.
