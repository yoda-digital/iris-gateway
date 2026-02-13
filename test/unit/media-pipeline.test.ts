import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { fetchMediaFromUrl } from "../../src/media/fetch.js";
import { compressImage, convertToWebP, generateThumbnail } from "../../src/media/compress.js";
import {
  parseImageMetadata,
  parseMediaMetadata,
  shouldCompress,
} from "../../src/media/parse.js";
import { MediaServer } from "../../src/media/server.js";
import { MediaStore } from "../../src/media/store.js";

/* ---------- helpers ---------- */

async function makeTestPng(width = 100, height = 100): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

/* ============================================================
   fetch.ts
   ============================================================ */

describe("fetchMediaFromUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns buffer and mimeType for a successful response", async () => {
    const body = Buffer.from("fake-image-bytes");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "image/png",
        "content-length": String(body.length),
      }),
      arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    }) as any;

    const result = await fetchMediaFromUrl("https://example.com/photo.png");
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBe(body.length);
    expect(result.mimeType).toBe("image/png");
  });

  it("throws on non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }) as any;

    await expect(fetchMediaFromUrl("https://example.com/missing")).rejects.toThrow(
      "Failed to fetch media: 404 Not Found",
    );
  });

  it("throws when content-length exceeds maxSizeBytes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-length": "999999",
      }),
    }) as any;

    await expect(
      fetchMediaFromUrl("https://example.com/big", { maxSizeBytes: 1024 }),
    ).rejects.toThrow(/Media too large/);
  });

  it("extracts filename from Content-Disposition header", async () => {
    const body = Buffer.from("data");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="report.pdf"',
        "content-length": String(body.length),
      }),
      arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    }) as any;

    const result = await fetchMediaFromUrl("https://example.com/download");
    expect(result.filename).toBe("report.pdf");
  });

  it("extracts filename from URL path when no Content-Disposition", async () => {
    const body = Buffer.from("data");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(body.length),
      }),
      arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    }) as any;

    const result = await fetchMediaFromUrl("https://example.com/images/sunset.jpg");
    expect(result.filename).toBe("sunset.jpg");
  });
});

/* ============================================================
   compress.ts
   ============================================================ */

describe("compressImage", () => {
  it("reduces a large image", async () => {
    const largePng = await makeTestPng(4000, 3000);
    const compressed = await compressImage(largePng);
    const meta = await sharp(compressed).metadata();

    // Should be resized to fit within 2048x2048 (default)
    expect(meta.width).toBeLessThanOrEqual(2048);
    expect(meta.height).toBeLessThanOrEqual(2048);
    // Default format is jpeg
    expect(meta.format).toBe("jpeg");
  });

  it("respects format option (webp)", async () => {
    const png = await makeTestPng(200, 200);
    const result = await compressImage(png, { format: "webp", quality: 60 });
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("webp");
  });
});

describe("convertToWebP", () => {
  it("converts PNG to WebP", async () => {
    const png = await makeTestPng(150, 150);
    const webp = await convertToWebP(png, 75);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(150);
  });
});

describe("generateThumbnail", () => {
  it("creates a small image", async () => {
    const png = await makeTestPng(800, 600);
    const thumb = await generateThumbnail(png, 160, 160);
    const meta = await sharp(thumb).metadata();

    expect(meta.width).toBe(160);
    expect(meta.height).toBe(160);
    expect(meta.format).toBe("jpeg");
  });
});

/* ============================================================
   parse.ts
   ============================================================ */

describe("parseImageMetadata", () => {
  it("returns correct dimensions and format", async () => {
    const png = await makeTestPng(320, 240);
    const meta = await parseImageMetadata(png);

    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.format).toBe("png");
    expect(meta.size).toBe(png.length);
    expect(typeof meta.hasAlpha).toBe("boolean");
  });
});

describe("parseMediaMetadata", () => {
  it("detects image type and includes image metadata", async () => {
    const png = await makeTestPng(50, 50);
    const meta = await parseMediaMetadata(png, "image/png");

    expect(meta.type).toBe("image");
    expect(meta.mimeType).toBe("image/png");
    expect(meta.size).toBe(png.length);
    expect(meta.image).toBeDefined();
    expect(meta.image!.width).toBe(50);
    expect(meta.image!.height).toBe(50);
  });

  it("detects audio type and has no image field", async () => {
    const fakeAudio = Buffer.alloc(256, 0);
    const meta = await parseMediaMetadata(fakeAudio, "audio/mpeg");

    expect(meta.type).toBe("audio");
    expect(meta.mimeType).toBe("audio/mpeg");
    expect(meta.size).toBe(256);
    expect(meta.image).toBeUndefined();
  });
});

describe("shouldCompress", () => {
  it("returns true for oversized buffer", async () => {
    const png = await makeTestPng(10, 10);
    // Set maxSizeBytes to something smaller than the buffer
    const result = await shouldCompress(png, 1, 99999);
    expect(result).toBe(true);
  });

  it("returns false for small image within limits", async () => {
    const png = await makeTestPng(50, 50);
    const result = await shouldCompress(png, 10 * 1024 * 1024, 4096);
    expect(result).toBe(false);
  });
});

/* ============================================================
   server.ts
   ============================================================ */

describe("MediaServer", () => {
  let tempDir: string;
  let store: MediaStore;
  let server: MediaServer;
  let port: number;
  let base: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-media-server-test-"));
    store = new MediaStore(tempDir);
    port = 19700 + Math.floor(Math.random() * 200);
    server = new MediaServer(store, mockLogger(), port, "127.0.0.1");
    await server.start();
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    store.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 404 for unknown media id", async () => {
    const res = await fetch(`${base}/media/nonexistent-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns file content for a valid entry", async () => {
    const content = Buffer.from("hello media");
    const entry = await store.save(content, {
      filename: "test.txt",
      mimeType: "text/plain",
    });

    const res = await fetch(`${base}/media/${entry.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");

    const text = await res.text();
    expect(text).toBe("hello media");
  });

  it("returns metadata JSON from /media/:id/info", async () => {
    const content = Buffer.from("info-test");
    const entry = await store.save(content, {
      filename: "doc.txt",
      mimeType: "text/plain",
    });

    const res = await fetch(`${base}/media/${entry.id}/info`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(entry.id);
    expect(body.filename).toBeDefined();
    expect(body.size).toBe(content.length);
    expect(body.mimeType).toBeDefined();
  });

  it("getUrl() returns correct URL format", () => {
    const url = server.getUrl("abc-123");
    expect(url).toBe(`http://127.0.0.1:${port}/media/abc-123`);
  });
});
