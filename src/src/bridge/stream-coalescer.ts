export interface CoalescerConfig {
  readonly enabled: boolean;
  readonly minChars: number;
  readonly maxChars: number;
  readonly idleMs: number;
  readonly breakOn: "paragraph" | "sentence" | "word";
  readonly editInPlace: boolean;
}

export const DEFAULT_COALESCER_CONFIG: CoalescerConfig = {
  enabled: false,
  minChars: 300,
  maxChars: 4096,
  idleMs: 800,
  breakOn: "paragraph",
  editInPlace: false,
};

export class StreamCoalescer {
  private buffer = "";
  private fullText = "";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hasFlushedOnce = false;

  constructor(
    private readonly config: CoalescerConfig,
    private readonly onFlush: (text: string, isEdit: boolean) => void,
  ) {}

  append(delta: string): void {
    this.buffer += delta;
    this.fullText += delta;
    this.resetIdleTimer();

    // Flush if buffer exceeds maxChars
    while (this.buffer.length >= this.config.maxChars) {
      const breakIdx = this.findBreakPoint(this.buffer, this.config.maxChars);
      const chunk = this.buffer.slice(0, breakIdx);
      this.buffer = this.buffer.slice(breakIdx);
      this.doFlush(chunk);
    }
  }

  end(): void {
    this.clearIdleTimer();
    if (this.buffer.length > 0) {
      this.doFlush(this.buffer);
      this.buffer = "";
    }
  }

  dispose(): void {
    this.clearIdleTimer();
  }

  private doFlush(text: string): void {
    if (!text) return;
    const isEdit = this.config.editInPlace && this.hasFlushedOnce;
    const output = isEdit ? this.fullText : text;
    this.hasFlushedOnce = true;
    this.onFlush(output, isEdit);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.buffer.length >= this.config.minChars) {
        this.doFlush(this.buffer);
        this.buffer = "";
      }
    }, this.config.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private findBreakPoint(text: string, maxLen: number): number {
    const chunk = text.slice(0, maxLen);
    if (this.config.breakOn === "paragraph") {
      const idx = chunk.lastIndexOf("\n\n");
      if (idx > 0) return idx + 2;
    }
    if (this.config.breakOn === "paragraph" || this.config.breakOn === "sentence") {
      const match = chunk.match(/^([\s\S]*[.!?])\s/);
      if (match) return match[1].length + 1;
    }
    // Word boundary
    const idx = chunk.lastIndexOf(" ");
    return idx > 0 ? idx + 1 : maxLen;
  }
}
