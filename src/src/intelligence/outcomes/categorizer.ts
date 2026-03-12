/**
 * Intent category validator.
 * The AI passes the category directly — no keyword guessing needed.
 * Falls back to "general" if no category provided or invalid.
 */

const VALID_CATEGORIES = new Set([
  "task", "work", "health", "hobby", "social", "reminder", "general",
]);

/**
 * Validate and return a category for a proactive intent.
 * @param _what - The intent text (unused — kept for backward compat)
 * @param category - Category string from the AI (optional)
 */
export function categorizeIntent(_what: string, category?: string): string {
  if (category && VALID_CATEGORIES.has(category)) return category;
  return "general";
}
