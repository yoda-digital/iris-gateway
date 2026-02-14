/**
 * Deterministic keyword-based intent category classifier.
 * Zero LLM cost — pure string matching against known patterns.
 *
 * Categories: task, work, health, hobby, social, reminder, general
 */

const CATEGORY_KEYWORDS: ReadonlyArray<[string, readonly string[]]> = [
  ["task", ["todo", "task", "deadline", "submit", "deliver", "finish", "complete", "homework", "assignment", "project"]],
  ["work", ["meeting", "work", "office", "boss", "colleague", "client", "salary", "report", "presentation", "email"]],
  ["health", ["doctor", "appointment", "medicine", "gym", "exercise", "run", "sleep", "water", "meditat", "health", "pill", "vitamin"]],
  ["hobby", ["read", "book", "game", "play", "cook", "garden", "draw", "paint", "music", "guitar", "piano", "photo"]],
  ["social", ["call", "meet", "visit", "party", "birthday", "friend", "family", "dinner", "lunch", "coffee"]],
  ["reminder", ["remind", "don't forget", "remember", "alarm", "wake", "timer", "schedule"]],
];

/**
 * Classify a proactive intent into a category based on its `what` field.
 * Returns "general" if no keywords match.
 */
export function categorizeIntent(what: string): string {
  const lower = what.toLowerCase();

  let bestCategory = "general";
  let bestScore = 0;

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}
