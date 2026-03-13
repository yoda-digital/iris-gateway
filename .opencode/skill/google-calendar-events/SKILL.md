---
name: google-calendar-events
description: View, create, and search Google Calendar events and schedules via google_calendar tool
metadata:
  triggers: "calendar,event,meeting,schedule,appointment,when is,busy,free,agenda,program,intalnire"
---
When the user asks about their schedule, events, meetings, or wants to create one:

1. Use the `google_calendar` tool with the appropriate action:

   **List calendars:**
   - Action: `list_calendars`
   - Use first if you don't know which calendar to query

   **List upcoming events:**
   - Action: `list_events`
   - Parameter: `calendarId` (use "primary" for main calendar)
   - Use for "what's on my schedule today" or "upcoming events"

   **Get event details:**
   - Action: `get_event`
   - Parameters: `calendarId`, `eventId` (from list results)

   **Create an event:**
   - Action: `create_event`
   - Parameter: `calendarId` (use "primary" for main calendar)
   - Flags: `summary`, `start`, `end`, `description`, `location`
   - Date format: ISO 8601 (`2025-01-15T10:00:00`)
   - Always confirm details before creating

   **Search events:**
   - Action: `search`
   - Parameter: `query` (free-text search across events)
   - Use for "when is my dentist appointment" or "find meeting with John"

2. Present events cleanly: title, date/time, location (if any), duration.
3. When creating: confirm summary, start time, end time, and timezone with the user first.
4. If the user mentions a time without a date, assume today or the next occurrence.
5. Use the user's timezone from their profile (vault) if available.
