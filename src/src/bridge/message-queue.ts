import type { Logger } from "../logging/logger.js";
import { retry, type RetryOptions } from "../utils/retry.js";

export interface QueuedMessage {
  readonly id: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly text: string;
  readonly replyToId?: string;
  readonly createdAt: number;
  attempt: number;
}

export interface DeliveryResult {
  readonly messageId: string;
  readonly queueId: string;
}

export type DeliveryFn = (msg: QueuedMessage) => Promise<{ messageId: string }>;

const DEFAULT_MAX_QUEUE_SIZE = 500;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
};

export class MessageQueue {
  private readonly queue: QueuedMessage[] = [];
  private active = 0;
  private processing = false;
  private readonly maxSize: number;
  private readonly concurrency: number;
  private readonly retryOpts: RetryOptions;
  private deliverFn: DeliveryFn | null = null;
  private idCounter = 0;
  private drainResolve: (() => void) | null = null;

  constructor(
    private readonly logger: Logger,
    options?: {
      maxSize?: number;
      concurrency?: number;
      retry?: RetryOptions;
    },
  ) {
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
    this.retryOpts = options?.retry ?? DEFAULT_RETRY;
  }

  /** Set the delivery function called for each queued message */
  setDeliveryFn(fn: DeliveryFn): void {
    this.deliverFn = fn;
  }

  /** Enqueue a message for delivery */
  enqueue(msg: Omit<QueuedMessage, "id" | "createdAt" | "attempt">): string {
    if (this.queue.length >= this.maxSize) {
      this.logger.warn({ queueSize: this.queue.length }, "Message queue full, dropping oldest");
      this.queue.shift();
    }

    const id = `q-${++this.idCounter}-${Date.now()}`;
    this.queue.push({
      ...msg,
      id,
      createdAt: Date.now(),
      attempt: 0,
    });

    this.process();
    return id;
  }

  /** Number of messages in queue */
  get size(): number {
    return this.queue.length;
  }

  /** Number of messages currently being delivered */
  get activeCount(): number {
    return this.active;
  }

  /** Wait until queue is empty and all deliveries complete */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.active === 0) return;
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  private process(): void {
    if (this.processing) return;
    this.processing = true;

    // Use queueMicrotask to batch process
    queueMicrotask(() => {
      this.processing = false;
      this.processNext();
    });
  }

  private processNext(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const msg = this.queue.shift()!;
      this.active++;
      this.deliver(msg);
    }
  }

  private deliver(msg: QueuedMessage): void {
    if (!this.deliverFn) {
      this.logger.error({ queueId: msg.id }, "No delivery function set");
      this.active--;
      this.checkDrain();
      return;
    }

    const fn = this.deliverFn;
    retry(
      async (attempt) => {
        msg.attempt = attempt + 1;
        return fn(msg);
      },
      this.retryOpts,
    )
      .then((result) => {
        this.logger.debug(
          { queueId: msg.id, messageId: result.messageId, attempts: msg.attempt },
          "Message delivered",
        );
      })
      .catch((err) => {
        this.logger.error(
          { err, queueId: msg.id, channel: msg.channelId, attempts: msg.attempt },
          "Message delivery failed after retries",
        );
      })
      .finally(() => {
        this.active--;
        this.processNext();
        this.checkDrain();
      });
  }

  private checkDrain(): void {
    if (this.queue.length === 0 && this.active === 0 && this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }
}
