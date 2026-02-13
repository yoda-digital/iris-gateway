export const PLATFORM_LIMITS: Record<string, number> = {
  telegram: 4096,
  discord: 2000,
  whatsapp: 65536,
  slack: 40000,
};

export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, maxLength);
    let splitAt = -1;

    // Try paragraph boundary
    const paraIdx = slice.lastIndexOf("\n\n");
    if (paraIdx > maxLength * 0.3) {
      splitAt = paraIdx + 2;
    }

    // Try sentence boundary
    if (splitAt === -1) {
      const sentenceMatch = slice.match(/[.!?]\s+(?=[A-Z])/g);
      if (sentenceMatch) {
        const lastSentenceEnd = slice.lastIndexOf(
          sentenceMatch[sentenceMatch.length - 1],
        );
        if (lastSentenceEnd > maxLength * 0.3) {
          splitAt =
            lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
        }
      }
    }

    // Try newline boundary
    if (splitAt === -1) {
      const newlineIdx = slice.lastIndexOf("\n");
      if (newlineIdx > maxLength * 0.3) {
        splitAt = newlineIdx + 1;
      }
    }

    // Try word boundary
    if (splitAt === -1) {
      const spaceIdx = slice.lastIndexOf(" ");
      if (spaceIdx > maxLength * 0.3) {
        splitAt = spaceIdx + 1;
      }
    }

    // Hard cut as last resort
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}
