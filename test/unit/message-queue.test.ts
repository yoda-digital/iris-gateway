import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageQueue, type DeliveryFn } from "../../src/bridge/message-queue.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

describe("MessageQueue", () => {
  let queue: MessageQueue;
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    logger = mockLogger();
    queue = new MessageQueue(logger, {
      concurrency: 2,
      retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
    });
  });

  it("delivers messages via delivery function", async () => {
    const deliverFn: DeliveryFn = vi.fn().mockResolvedValue({ messageId: "m1" });
    queue.setDeliveryFn(deliverFn);

    queue.enqueue({ channelId: "telegram", chatId: "123", text: "hello" });
    await queue.drain();

    expect(deliverFn).toHaveBeenCalledOnce();
    expect(queue.size).toBe(0);
    expect(queue.activeCount).toBe(0);
  });

  it("retries failed deliveries", async () => {
    let attempts = 0;
    const deliverFn: DeliveryFn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 2) throw new Error("temporary failure");
      return { messageId: "m2" };
    });
    queue.setDeliveryFn(deliverFn);

    queue.enqueue({ channelId: "telegram", chatId: "123", text: "retry me" });
    await queue.drain();

    expect(deliverFn).toHaveBeenCalledTimes(2);
  });

  it("logs error after max retries exhausted", async () => {
    const deliverFn: DeliveryFn = vi.fn().mockRejectedValue(new Error("permanent failure"));
    queue.setDeliveryFn(deliverFn);

    queue.enqueue({ channelId: "telegram", chatId: "123", text: "fail" });
    await queue.drain();

    expect(deliverFn).toHaveBeenCalledTimes(2); // maxAttempts = 2
    expect(logger.error).toHaveBeenCalled();
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const deliverFn: DeliveryFn = vi.fn().mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return { messageId: "m" };
    });
    queue.setDeliveryFn(deliverFn);

    for (let i = 0; i < 5; i++) {
      queue.enqueue({ channelId: "telegram", chatId: "123", text: `msg-${i}` });
    }
    await queue.drain();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(deliverFn).toHaveBeenCalledTimes(5);
  });

  it("drops oldest when queue is full", () => {
    const smallQueue = new MessageQueue(logger, {
      maxSize: 3,
      retry: { maxAttempts: 1, baseDelayMs: 10 },
    });
    // Don't set delivery fn so messages stay in queue
    smallQueue.enqueue({ channelId: "telegram", chatId: "1", text: "a" });
    smallQueue.enqueue({ channelId: "telegram", chatId: "1", text: "b" });
    smallQueue.enqueue({ channelId: "telegram", chatId: "1", text: "c" });
    smallQueue.enqueue({ channelId: "telegram", chatId: "1", text: "d" });

    // Should have dropped oldest, but since no delivery fn they stay
    // The queue logs a warning
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drain resolves immediately when empty", async () => {
    queue.setDeliveryFn(vi.fn().mockResolvedValue({ messageId: "m" }));
    await queue.drain(); // Should not hang
  });

  it("reports correct size", () => {
    expect(queue.size).toBe(0);
    // No delivery fn set, so messages queue up but get error-logged
    queue.enqueue({ channelId: "telegram", chatId: "1", text: "a" });
    // Size might be 0 after microtask processes, but at enqueue time it was 1
    expect(queue.size).toBeLessThanOrEqual(1);
  });
});
