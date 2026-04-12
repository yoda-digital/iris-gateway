export interface DiffFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface SessionDiff {
  readonly files: DiffFile[];
}

const MAX_FILES = 5;

export function formatDiffSummary(diff: SessionDiff): string {
  const lines = [
    "────────────────────────────",
    `📝 Changes: ${diff.files.length} file${diff.files.length === 1 ? "" : "s"}`,
  ];
  for (const file of diff.files.slice(0, MAX_FILES)) {
    const add = `+${file.additions}`.padStart(4);
    const del = `-${file.deletions}`.padStart(4);
    lines.push(`  ${add} / ${del}  ${file.path}`);
  }
  if (diff.files.length > MAX_FILES) {
    lines.push(`  … and ${diff.files.length - MAX_FILES} more`);
  }
  return lines.join("\n");
}
