export type ScanSeverity = "critical" | "warn" | "info";

export interface ScanRule {
  readonly id: string;
  readonly severity: ScanSeverity;
  readonly description: string;
  readonly type: "line" | "source";
  readonly pattern: RegExp;
  readonly context?: RegExp;
  readonly contextType?: "import" | "source";
}

export interface ScanFinding {
  readonly ruleId: string;
  readonly severity: ScanSeverity;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly evidence: string;
}

export interface ScanResult {
  readonly safe: boolean;
  readonly scannedFiles: number;
  readonly findings: ScanFinding[];
  readonly critical: number;
  readonly warn: number;
  readonly info: number;
}
