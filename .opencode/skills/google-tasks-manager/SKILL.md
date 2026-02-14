---
name: google-tasks-manager
description: View, add, and complete Google Tasks via google_tasks tool
metadata:
  triggers: "task,todo,task list,reminder,add task,complete task,sarcina,de facut,lista"
---
When the user asks about tasks, to-dos, or wants to manage their task lists:

1. Use the `google_tasks` tool with the appropriate action:

   **List task lists:**
   - Action: `list_tasklists`
   - Use first to discover available lists (work, personal, etc.)

   **List tasks in a list:**
   - Action: `list_tasks`
   - Parameter: `tasklistId` (from list_tasklists results)
   - Use for "show my tasks" or "what's on my todo list"

   **Add a task:**
   - Action: `add_task`
   - Parameter: `tasklistId`
   - Flags: `title` (required), `notes` (optional), `due` (optional, ISO date)
   - Use for "remind me to..." or "add to my list..."

   **Complete a task:**
   - Action: `complete_task`
   - Parameters: `tasklistId`, `taskId` (from list results)
   - Use for "mark X as done" or "I finished X"

2. If the user doesn't specify a list, use the default task list (first one from list_tasklists).
3. Present tasks cleanly: title, due date (if set), status.
4. When adding: confirm the task title. Add due date if the user mentions a deadline.
5. When completing: search tasks first to find the matching taskId, then mark done.
