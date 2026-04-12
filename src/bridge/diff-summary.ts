import type { SessionDiff } from "./opencode-client.js";

const MAX_FILES_SHOWN = 5;
const SEPARATOR = "────────────────────────────";

export function formatDiffSummary(diff: SessionDiff): string {
  const count = diff.files.length;
  const lines: string[] = [
    SEPARATOR,
    `📝 Changes: ${count} file${count === 1 ? "" : "s"}`,
  ];
  for (const file of diff.files.slice(0, MAX_FILES_SHOWN)) {
    const add = String(file.additions).padStart(4);
    const del = String(file.deletions).padStart(4);
    lines.push(`  +${add} / -${del}  ${file.path}`);
  }
  if (count > MAX_FILES_SHOWN) {
    lines.push(`  … and ${count - MAX_FILES_SHOWN} more`);
  }
  return lines.join("\n");
}
