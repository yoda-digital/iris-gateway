import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../src/security/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests within limits", () => {
    const limiter = new RateLimiter({ perMinute: 5, perHour: 100 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user1").allowed).toBe(true);
      limiter.hit("user1");
    }
  });

  it("blocks after per-minute limit", () => {
    const limiter = new RateLimiter({ perMinute: 3, perHour: 100 });
    for (let i = 0; i < 3; i++) {
      limiter.hit("user1");
    }
    const result = limiter.check("user1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates keys", () => {
    const limiter = new RateLimiter({ perMinute: 2, perHour: 100 });
    limiter.hit("user1");
    limiter.hit("user1");
    expect(limiter.check("user1").allowed).toBe(false);
    expect(limiter.check("user2").allowed).toBe(true);
  });

  it("check without hit does not consume quota", () => {
    const limiter = new RateLimiter({ perMinute: 1, perHour: 100 });
    expect(limiter.check("user1").allowed).toBe(true);
    expect(limiter.check("user1").allowed).toBe(true);
    limiter.hit("user1");
    expect(limiter.check("user1").allowed).toBe(false);
  });
});
